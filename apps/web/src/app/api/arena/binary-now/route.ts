/**
 * GET /api/arena/binary-now?asset=BTC&windowEpoch=NNN&minTrades=0&limit=15
 *
 * Returns the full live state of one 5-min binary window:
 *   - the binary itself (question, conditionId, tokens, expiry, etc.)
 *   - MARKET quote (UP% / DOWN% / depth from live orderbook)
 *   - window time math (elapsed, remaining, optimal-bet window flags)
 *   - per-agent predictions (UP% with confidence + per-sub for multi)
 *   - staged capsules already bound to this binary
 *   - ms timestamps for the panel's latency badge
 *
 * Client (LiveBinaryPanel) polls this once a second.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  findBinaryWindow,
  stepWindow,
  fetchMarketQuote,
  windowTimeMath,
} from "@/lib/arena/binary-window";
import { predictAgent } from "@/lib/arena/agent-prediction";
import { parseGenome, genomeNickname } from "@/lib/arena/genome";

const ASSET_TO_PRODUCT: Record<string, string> = {
  BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD",
  XRP: "XRP-USD", DOGE: "DOGE-USD",
  BNB: "BNB-USDT", HYPE: "HYPE-USDT",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const tServerStart = Date.now();
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") ?? "BTC";
  const windowEpochParam = url.searchParams.get("windowEpoch");
  const windowEpoch = windowEpochParam ? Number(windowEpochParam) : null;
  const minTrades = Math.max(0, Number(url.searchParams.get("minTrades") ?? "0"));
  const limit = Math.min(50, Math.max(3, Number(url.searchParams.get("limit") ?? "15")));
  const agentSet = (url.searchParams.get("agent_set") ?? "top") as "top" | "archetypes" | "all";

  const binary = findBinaryWindow(asset, Number.isFinite(windowEpoch) ? windowEpoch : null);
  if (!binary) {
    return NextResponse.json({
      ok: false,
      error: `No ${asset} binary found near ${windowEpoch ? new Date(windowEpoch).toISOString() : "now"}.`,
      hint: "Ensure poly_binaries is being populated (worker:realtime or the binary catalogue fetcher).",
    }, { status: 404 });
  }

  // Step nav lookups — exposed so the client can prev/next without recomputing.
  const prev = stepWindow(binary, -1);
  const next = stepWindow(binary, +1);

  // MARKET quote — fetched live from polymarket
  const tQuoteStart = Date.now();
  const quote = await fetchMarketQuote(binary);
  const quoteFetchMs = Date.now() - tQuoteStart;

  // Window time math
  const time = windowTimeMath(binary, Date.now());

  // Three view modes:
  //   "top"        — top by lifetime PnL, EXCLUDING archetype-seeded agents
  //                  so naturally-evolved winners get visibility
  //   "archetypes" — only PRD-seeded agents, sorted by lifetime PnL DESC
  //                  (was sort-by-id, which buried winners)
  //   "all"        — union: PRD-seeded pinned first, then top-PnL fillers
  const ARCHETYPE_INTRODUCED_BY = ["archetype-prd-2026-05-29", "hermes-archetype-2026-05-29", "daniro-archetype-2026-05-29"];
  // min_pnl floor: filter out agents below this lifetime-PnL threshold.
  // Defaults to 0 (show everything alive). Negative values include underwater agents.
  const minPnlUsd = Number(url.searchParams.get("min_pnl") ?? "0");
  const tagPlaceholders = ARCHETYPE_INTRODUCED_BY.map(() => "?").join(",");
  let sql: string;
  let bind: Array<string | number>;
  if (agentSet === "archetypes") {
    // archetypes only — sorted by lifetime PnL so the best lead, with HAVING for min_pnl floor.
    sql = `WITH latest_caps AS (
             SELECT paper_agent_id, id, status, capital_allocated_usd,
                    ROW_NUMBER() OVER (PARTITION BY paper_agent_id ORDER BY updated_at DESC, id DESC) AS rn
               FROM capsules
              WHERE paper_agent_id IS NOT NULL
           )
           SELECT pa.id, pa.name, pa.generation, pa.is_elite,
                  pa.genome_json, pa.cash_usd_current,
                  pa.realized_pnl_usd, pa.unrealized_pnl_usd,
                  pa.trades_count, pa.wins_count, pa.entries_count,
                  (pa.cash_usd_current + pa.unrealized_pnl_usd
                    + IFNULL((SELECT SUM(json_extract(value, '$.size_usd'))
                                FROM json_each(pa.position_basket_json)), 0)
                    - pa.cash_usd_start) AS lifetime_pnl,
                  c.id AS capsule_id, c.status AS capsule_status, c.capital_allocated_usd AS capsule_capital
             FROM paper_agents pa
             LEFT JOIN latest_caps c ON c.paper_agent_id = pa.id AND c.rn = 1
            WHERE pa.alive = 1 AND pa.introduced_by IN (${tagPlaceholders})
            GROUP BY pa.id
           HAVING lifetime_pnl >= ?
            ORDER BY lifetime_pnl DESC
            LIMIT ?`;
    bind = [...ARCHETYPE_INTRODUCED_BY, minPnlUsd, limit];
  } else if (agentSet === "all") {
    // Union: PRD-seeded first, then top-PnL fillers (excluding those already
    // in the seeded set so we don't double-count).
    sql = `WITH latest_caps AS (
             SELECT paper_agent_id, id, status, capital_allocated_usd,
                    ROW_NUMBER() OVER (PARTITION BY paper_agent_id ORDER BY updated_at DESC, id DESC) AS rn
               FROM capsules
              WHERE paper_agent_id IS NOT NULL
           ),
           base AS (
             SELECT pa.id, pa.name, pa.generation, pa.is_elite, pa.introduced_by,
                    pa.genome_json, pa.cash_usd_current,
                    pa.realized_pnl_usd, pa.unrealized_pnl_usd,
                    pa.trades_count, pa.wins_count, pa.entries_count,
                    (pa.cash_usd_current + pa.unrealized_pnl_usd
                      + IFNULL((SELECT SUM(json_extract(value, '$.size_usd'))
                                  FROM json_each(pa.position_basket_json)), 0)
                      - pa.cash_usd_start) AS lifetime_pnl,
                    c.id AS capsule_id, c.status AS capsule_status, c.capital_allocated_usd AS capsule_capital
               FROM paper_agents pa
               LEFT JOIN latest_caps c ON c.paper_agent_id = pa.id AND c.rn = 1
              WHERE pa.alive = 1 AND pa.trades_count >= ?
           )
           SELECT id, name, generation, is_elite, genome_json, cash_usd_current,
                  realized_pnl_usd, unrealized_pnl_usd, trades_count, wins_count, entries_count,
                  lifetime_pnl, capsule_id, capsule_status, capsule_capital
             FROM base
            WHERE lifetime_pnl >= ?
            ORDER BY
              CASE WHEN introduced_by IN (${tagPlaceholders}) THEN 0 ELSE 1 END,
              lifetime_pnl DESC
            LIMIT ?`;
    bind = [minTrades, minPnlUsd, ...ARCHETYPE_INTRODUCED_BY, limit];
  } else {
    // top — naturally-evolved winners ONLY (excludes archetype-seeded tags so
    // they don't dominate the ranking just because they were hand-tuned).
    sql = `WITH latest_caps AS (
             SELECT paper_agent_id, id, status, capital_allocated_usd,
                    ROW_NUMBER() OVER (PARTITION BY paper_agent_id ORDER BY updated_at DESC, id DESC) AS rn
               FROM capsules
              WHERE paper_agent_id IS NOT NULL
           ), ranked AS (
             SELECT pa.id, pa.name, pa.generation, pa.is_elite,
                    pa.genome_json, pa.cash_usd_current,
                    pa.realized_pnl_usd, pa.unrealized_pnl_usd,
                    pa.trades_count, pa.wins_count, pa.entries_count,
                    (pa.cash_usd_current + pa.unrealized_pnl_usd
                      + IFNULL((SELECT SUM(json_extract(value, '$.size_usd'))
                                  FROM json_each(pa.position_basket_json)), 0)
                      - pa.cash_usd_start) AS lifetime_pnl,
                    c.id AS capsule_id, c.status AS capsule_status, c.capital_allocated_usd AS capsule_capital
               FROM paper_agents pa
               LEFT JOIN latest_caps c ON c.paper_agent_id = pa.id AND c.rn = 1
              WHERE pa.alive = 1 AND pa.trades_count >= ?
                AND (pa.introduced_by IS NULL OR pa.introduced_by NOT IN (${tagPlaceholders}))
           )
           SELECT * FROM ranked
            WHERE lifetime_pnl >= ?
            ORDER BY lifetime_pnl DESC
            LIMIT ?`;
    bind = [minTrades, ...ARCHETYPE_INTRODUCED_BY, minPnlUsd, limit];
  }
  const rows = db().prepare(sql).all(...bind) as Array<{
    id: number; name: string; generation: number; is_elite: 0 | 1;
    genome_json: string; cash_usd_current: number;
    realized_pnl_usd: number; unrealized_pnl_usd: number;
    trades_count: number; wins_count: number; entries_count: number;
    lifetime_pnl: number;
    capsule_id: string | null; capsule_status: string | null; capsule_capital: number | null;
  }>;

  type AgentEntry = {
    id: number; name: string; generation: number; is_elite: boolean;
    strategy_nick: string; strategy_kind: string;
    lifetime_pnl: number; trades_count: number; win_pct: number;
    capsule_id: string | null; capsule_status: string | null; capsule_capital: number | null;
    prediction: ReturnType<typeof predictAgent>;
  };
  const agents: AgentEntry[] = [];
  for (const r of rows) {
    let nick = "?"; let kind = "?";
    let prediction: ReturnType<typeof predictAgent> = {
      upProb: null, confidence: "none", rationale: "genome unparseable",
    };
    try {
      const g = parseGenome(r.genome_json);
      nick = genomeNickname(g);
      kind = g.kind;
      prediction = predictAgent(g, binary);
    } catch { /* skip */ }
    agents.push({
      id: r.id,
      name: r.name,
      generation: r.generation,
      is_elite: r.is_elite === 1,
      strategy_nick: nick,
      strategy_kind: kind,
      lifetime_pnl: r.lifetime_pnl,
      trades_count: r.trades_count,
      win_pct: r.trades_count > 0 ? Math.round((r.wins_count / r.trades_count) * 100) : 0,
      capsule_id: r.capsule_id,
      capsule_status: r.capsule_status,
      capsule_capital: r.capsule_capital,
      prediction,
    });
  }

  // BTC (or whatever asset) spot price series across the window — fed from
  // realtime_ticks (sub-minute) merged with coinbase_candles (1-min close).
  // We expand the lookback to start - 1min so the chart shows a tiny lead-in,
  // and to expiry + 30s so it doesn't truncate mid-tick. The "reference price"
  // (the literal "target to beat" the binary settles against) is the first
  // tick at-or-after the window's natural start.
  const productId = ASSET_TO_PRODUCT[asset];
  type SeriesPoint = { ts_ms: number; price: number };
  let btcSeries: SeriesPoint[] = [];
  let referencePrice: number | null = null;
  let referenceTsMs: number | null = null;
  if (productId) {
    const startMs = time.expiryEpochMs - binary.durationMin * 60_000;
    const seriesStartMs = startMs - 60_000;
    const seriesEndMs = time.expiryEpochMs + 30_000;
    // realtime_ticks — sub-minute live ticks if available
    const ticks = db().prepare(
      `SELECT ts_unix, price FROM realtime_ticks
        WHERE product_id = ? AND ts_unix BETWEEN ? AND ?
        ORDER BY ts_unix ASC`,
    ).all(productId, Math.floor(seriesStartMs / 1000), Math.floor(seriesEndMs / 1000)) as Array<{ ts_unix: number; price: number }>;
    // coinbase_candles — 1-min closes over the same span
    const candles = db().prepare(
      `SELECT start_unix, close FROM coinbase_candles
        WHERE product_id = ? AND granularity = 'ONE_MINUTE'
          AND start_unix BETWEEN ? AND ?
        ORDER BY start_unix ASC`,
    ).all(productId, Math.floor(seriesStartMs / 1000), Math.floor(seriesEndMs / 1000)) as Array<{ start_unix: number; close: number }>;
    // Merge: candles first (one point per minute boundary), then ticks (interleaved).
    const merged: SeriesPoint[] = [];
    for (const c of candles) merged.push({ ts_ms: c.start_unix * 1000, price: c.close });
    for (const t of ticks) merged.push({ ts_ms: t.ts_unix * 1000, price: t.price });
    merged.sort((a, b) => a.ts_ms - b.ts_ms);
    btcSeries = merged;
    // Reference price = the first point at or after window start
    const ref = merged.find((p) => p.ts_ms >= startMs);
    if (ref) { referencePrice = ref.price; referenceTsMs = ref.ts_ms; }
    else if (merged.length > 0) { const last = merged[merged.length - 1]; referencePrice = last.price; referenceTsMs = last.ts_ms; }
  }

  // Capsules already staged on this binary (allowed_symbols_json contains conditionId)
  const stagedRows = db().prepare(
    `SELECT id, name, status, capital_allocated_usd, paper_agent_id, allowed_symbols_json
       FROM capsules
      WHERE allowed_symbols_json LIKE '%' || ? || '%'
      ORDER BY created_at DESC
      LIMIT 50`,
  ).all(binary.conditionId) as Array<{ id: string; name: string; status: string; capital_allocated_usd: number; paper_agent_id: number | null; allowed_symbols_json: string | null }>;

  const serverElapsedMs = Date.now() - tServerStart;
  return NextResponse.json({
    ok: true,
    server_ts_ms: Date.now(),
    server_elapsed_ms: serverElapsedMs,
    quote_fetch_ms: quoteFetchMs,
    asset,
    agent_set: agentSet,
    min_pnl: minPnlUsd,
    binary: {
      upTokenId: binary.upTokenId,
      downTokenId: binary.downTokenId,
      conditionId: binary.conditionId,
      question: binary.question,
      asset: binary.asset,
      startIso: binary.startIso,
      expiryIso: binary.expiryIso,
      durationMin: binary.durationMin,
    },
    time,
    quote,
    nav: {
      prev_epoch_ms: prev ? Date.parse(prev.expiryIso.includes("T") ? prev.expiryIso : prev.expiryIso.replace(" ", "T") + "Z") : null,
      next_epoch_ms: next ? Date.parse(next.expiryIso.includes("T") ? next.expiryIso : next.expiryIso.replace(" ", "T") + "Z") : null,
      prev_question: prev?.question ?? null,
      next_question: next?.question ?? null,
    },
    agents,
    staged_capsules: stagedRows,
    series: {
      btc: btcSeries,
      reference_price: referencePrice,
      reference_ts_ms: referenceTsMs,
      product_id: productId ?? null,
      // Server-side MARKET implied UP% history from market_snapshots —
      // populates the MARKET line chart from before page open, not just
      // from when the panel started polling. Pulled for the UP token only;
      // implied UP = midpoint (since midpoint is the YES/UP price).
      // Window extended -10min back so the line has lead-in.
      market_up: (() => {
        const startMs = time.expiryEpochMs - binary.durationMin * 60_000;
        const seriesStartMs = startMs - 10 * 60_000;
        const seriesEndMs = time.expiryEpochMs + 30_000;
        const rows = db().prepare(
          `SELECT captured_at, midpoint
             FROM market_snapshots
            WHERE token_id = ?
              AND midpoint IS NOT NULL
              AND captured_at >= datetime(?, 'unixepoch')
              AND captured_at <= datetime(?, 'unixepoch')
            ORDER BY captured_at ASC
            LIMIT 500`,
        ).all(
          binary.upTokenId,
          Math.floor(seriesStartMs / 1000),
          Math.floor(seriesEndMs / 1000),
        ) as Array<{ captured_at: string; midpoint: number }>;
        return rows.map((r) => {
          const ts = r.captured_at.includes("T") ? r.captured_at : r.captured_at.replace(" ", "T") + "Z";
          return { ts_ms: Date.parse(ts), market_up: r.midpoint };
        });
      })(),
    },
  });
}
