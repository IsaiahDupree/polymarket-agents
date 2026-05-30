/**
 * /arena/high-pnl-agents — top agents by lifetime PnL, expanded per-row with
 * the full arsenal (data feeds, decision modules, genome params, constraints).
 *
 * Phase 1 + 2 of the high-PnL-agents-page plan:
 *   - Phase 1: ranking table with alive-only + min-trades filters
 *   - Phase 2: expandable "arsenal" block showing what every agent can see,
 *              think with, and act on. Multi-strategy agents expand to per-sub
 *              arsenals.
 *
 * Read-only — no DB writes, no live router calls. Capsule staging (Phase 3)
 * will live in /api/arena/stage-capsule + a form on this page.
 */
import Link from "next/link";
import { db } from "@/lib/db/client";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Sparkline } from "@/components/Sparkline";
import { equityCurvesForAgents } from "@/lib/arena/db";
import { parseGenome, genomeNickname, type Genome } from "@/lib/arena/genome";
import {
  buildArsenal,
  buildSubArsenals,
  listAllStrategies,
  type AgentArsenal,
  type ArsenalCapability,
  type GenomeParam,
} from "@/lib/arena/agent-arsenal";
import { LiveBinaryPanel } from "@/components/LiveBinaryPanel";
import { PolymarketDiagnosticPanel } from "@/components/PolymarketDiagnosticPanel";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ alive?: string; minTrades?: string; limit?: string }>;
};

type AgentRow = {
  id: number;
  name: string;
  generation: number;
  alive: 0 | 1;
  is_elite: 0 | 1;
  genome_json: string;
  introduced_by: string | null;
  cash_usd_start: number;
  cash_usd_current: number;
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  trades_count: number;
  entries_count: number;
  wins_count: number;
  open_principal: number;
  lifetime_pnl: number;
  capsule_id: string | null;
  capsule_status: string | null;
  capsule_capital: number | null;
};

function fmtUsd(n: number): string {
  return `${n < 0 ? "−$" : "$"}${Math.abs(n).toFixed(2)}`;
}

export default async function HighPnlAgentsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const aliveOnly = sp.alive !== "0"; // default ON
  const minTrades = Math.max(0, Number.isFinite(Number(sp.minTrades)) ? Number(sp.minTrades) : 0);
  const limit = Math.min(100, Math.max(5, Number.isFinite(Number(sp.limit)) ? Number(sp.limit) : 25));

  // Lifetime PnL = (cash_now + open_principal + unrealized) − cash_start.
  // open_principal pulled via json_each so an open position doesn't appear
  // as a loss equal to its own size. Same accounting as /arena's "all-time
  // top agents" card.
  // Pick exactly one capsule per paper_agent (the most-recently-updated)
  // so the LEFT JOIN can't multiply rows when an agent has been staged more
  // than once. Window function is SQLite ≥3.25 (we ship a modern bundle).
  const rows = db().prepare(
    `WITH latest_caps AS (
       SELECT paper_agent_id, id, status, capital_allocated_usd,
              ROW_NUMBER() OVER (PARTITION BY paper_agent_id ORDER BY updated_at DESC, id DESC) AS rn
         FROM capsules
        WHERE paper_agent_id IS NOT NULL
     )
     SELECT pa.id, pa.name, pa.generation, pa.alive, pa.is_elite,
            pa.genome_json, pa.introduced_by,
            pa.cash_usd_start, pa.cash_usd_current,
            pa.realized_pnl_usd, pa.unrealized_pnl_usd,
            pa.trades_count, pa.entries_count, pa.wins_count,
            IFNULL((SELECT SUM(json_extract(value, '$.size_usd'))
                      FROM json_each(pa.position_basket_json)), 0) AS open_principal,
            (pa.cash_usd_current + pa.unrealized_pnl_usd
              + IFNULL((SELECT SUM(json_extract(value, '$.size_usd'))
                          FROM json_each(pa.position_basket_json)), 0)
              - pa.cash_usd_start) AS lifetime_pnl,
            c.id AS capsule_id,
            c.status AS capsule_status,
            c.capital_allocated_usd AS capsule_capital
       FROM paper_agents pa
       LEFT JOIN latest_caps c ON c.paper_agent_id = pa.id AND c.rn = 1
      WHERE (? = 0 OR pa.alive = 1)
        AND pa.trades_count >= ?
      ORDER BY lifetime_pnl DESC, pa.realized_pnl_usd DESC, pa.entries_count DESC
      LIMIT ?`,
  ).all(aliveOnly ? 1 : 0, minTrades, limit) as AgentRow[];

  // Batched equity curves for sparklines — same pattern as /arena page.
  const curveIds = rows.map((r) => r.id);
  const equityCurves = equityCurvesForAgents(curveIds);

  // Survey of every strategy kind currently registered — surfaces "what can
  // an agent be armed with at all", even before any specific row is expanded.
  const allStrategies = listAllStrategies();
  const familyCounts = new Map<string, number>();
  for (const s of allStrategies) {
    familyCounts.set(s.family, (familyCounts.get(s.family) ?? 0) + 1);
  }

  const allowTradeLive = process.env.ALLOW_TRADE === "1";

  return (
    <>
      <AutoRefresh label="high-pnl-agents" />
      <div className="space-y-6" suppressHydrationWarning>
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">High-PnL agents</h1>
          <p className="text-zinc-400 text-sm">
            Top {limit} {aliveOnly ? "alive" : "all"} paper agents by lifetime PnL
            {minTrades > 0 ? ` (≥ ${minTrades} round-trips)` : ""}.
            Expand any row to see its full arsenal — data feeds, decision modules,
            constraints, and decoded genome parameters.
          </p>
          <p className="text-zinc-500 text-xs">
            ALLOW_TRADE = <span className={allowTradeLive ? "text-accent-red" : "text-accent-green"}>{allowTradeLive ? "1 (live)" : "0 (kill switch)"}</span>{" "}
            · automatic capsule promotion is gated by{" "}
            <code className="text-zinc-300">MIN_LIVE_CAPSULE_PNL_USD = ${process.env.MIN_LIVE_CAPSULE_PNL_USD ?? "96"}</code>{" "}
            · capsule staging UI lands in Phase 3.
          </p>
        </header>

        {/* Focused single-window live panel — replaces the generic matches grid.
            Shows the current BTC 5-min binary with MARKET UP/DOWN vs every
            top-PnL agent's prediction (with per-sub breakdown for composites)
            in one panel, refreshed every second with latency indicators and
            prev/next 5-min window navigation. */}
        <LiveBinaryPanel asset="BTC" />

        {/* Live diagnostic — proves Polymarket CLOB + Gamma endpoints are
            responding, with per-endpoint latencies + sample orderbook payloads
            for the current binary. Polls every 3s. */}
        <PolymarketDiagnosticPanel asset="BTC" />

        <form className="card" action="/arena/high-pnl-agents" method="get">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                name="alive"
                value="1"
                defaultChecked={aliveOnly}
                className="accent-accent-blue"
              />
              Alive only
            </label>
            <label className="flex flex-col text-xs text-zinc-400">
              Min round-trips
              <input
                type="number"
                name="minTrades"
                min={0}
                defaultValue={minTrades}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 mt-1 w-24 text-zinc-200"
              />
            </label>
            <label className="flex flex-col text-xs text-zinc-400">
              Limit
              <input
                type="number"
                name="limit"
                min={5}
                max={100}
                defaultValue={limit}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 mt-1 w-24 text-zinc-200"
              />
            </label>
            <button
              type="submit"
              className="bg-accent-blue text-zinc-100 text-xs px-3 py-1.5 rounded hover:bg-accent-blue/80"
            >
              Apply
            </button>
            <Link href="/arena/high-pnl-agents" className="text-xs text-zinc-500 hover:text-zinc-300">
              reset
            </Link>
          </div>
        </form>

        {/* Coinbase data menu — every CB feed the codebase can pull, grouped
            into "persisted to DB" vs "fetch-on-demand". Surfaces the full
            surface so the operator knows what new genome kinds could read. */}
        <CoinbaseDataMenu />

        {/* Strategy survey — every kind the codebase knows how to spawn.
            Renders before the ranked list so the operator sees "what could
            agents be armed with" even when the leaderboard is short. */}
        <section className="card border-zinc-700">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="card-title m-0">Strategy roster</h2>
            <span className="text-[10px] text-zinc-500">
              {allStrategies.length} registered kinds across {familyCounts.size} families
            </span>
          </div>
          <p className="text-xs text-zinc-400 mb-3">
            These are every strategy that can be encoded as an agent genome. New strategies
            (e.g. from docs/inspiration extraction in Phase 4) seed the next generation and
            compete for fitness alongside survivors.
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {allStrategies.map((s) => (
              <li key={s.kind} className="flex gap-2">
                <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${familyClass(s.family)}`}>
                  {s.family}
                </span>
                <code className="text-zinc-300">{s.kind}</code>
                <span className="text-zinc-500 truncate">— {s.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="card-title">Ranked agents ({rows.length})</h2>
          {rows.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No agents match the current filters.
              {aliveOnly && minTrades > 0 && (
                <> Try lowering the min round-trips, or untick "Alive only" to include retired agents.</>
              )}
            </p>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Agent</th>
                  <th>Gen</th>
                  <th>Strategy</th>
                  <th>Capsule</th>
                  <th className="text-right">Lifetime PnL</th>
                  <th className="text-right">Win%</th>
                  <th className="text-right" title="Round-trips (closed)">Trades</th>
                  <th className="text-right" title="Positions opened">Entries</th>
                  <th>Equity curve</th>
                  <th>Arsenal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  let genome: Genome | null = null;
                  let nick = "?";
                  let arsenal: AgentArsenal | null = null;
                  let subArsenals: AgentArsenal[] | null = null;
                  try {
                    genome = parseGenome(r.genome_json);
                    nick = genomeNickname(genome);
                    arsenal = buildArsenal(genome);
                    subArsenals = buildSubArsenals(genome);
                  } catch {
                    // genome may be corrupted on really old rows — skip arsenal
                  }
                  const curve = equityCurves.get(r.id) ?? [];
                  const up = curve.length > 1 ? curve[curve.length - 1] >= curve[0] : false;
                  const winPct = r.trades_count > 0 ? Math.round((r.wins_count / r.trades_count) * 100) : 0;
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="text-zinc-500 text-xs pt-3">{i + 1}</td>
                      <td className="pt-3">
                        <Link className="text-zinc-100 hover:text-accent-blue" href={`/arena/${r.id}`}>
                          {r.name}
                        </Link>
                        <Link
                          href={`/arena/agents/${r.id}/train`}
                          className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border border-accent-blue/40 text-accent-blue/80 hover:bg-accent-blue/10"
                          title="Backtest + parameter sweep this agent"
                        >
                          train
                        </Link>
                        {r.is_elite ? (
                          <span className="ml-1.5 text-[10px] px-1 rounded bg-accent-amber/20 text-accent-amber border border-accent-amber/40">
                            ELITE
                          </span>
                        ) : null}
                        {r.alive === 0 ? (
                          <span className="ml-1.5 text-[10px] px-1 rounded bg-zinc-700 text-zinc-300">retired</span>
                        ) : null}
                      </td>
                      <td className="text-zinc-400 text-xs pt-3">
                        <Link className="hover:text-accent-blue" href={`/arena/generations/${r.generation}`}>g{r.generation}</Link>
                      </td>
                      <td className="text-zinc-400 text-xs pt-3">{nick}</td>
                      <td className="text-xs pt-3">
                        {r.capsule_id ? (
                          <span
                            className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border ${capsuleStatusClass(r.capsule_status, allowTradeLive)}`}
                            title={`capsule ${r.capsule_id} · status=${r.capsule_status} · capital $${(r.capsule_capital ?? 0).toFixed(2)}`}
                          >
                            {r.capsule_status} · {fmtUsd(r.capsule_capital ?? 0)}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className={`text-right tabular-nums pt-3 ${r.lifetime_pnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                        {r.lifetime_pnl >= 0 ? "+" : ""}
                        {fmtUsd(r.lifetime_pnl)}
                      </td>
                      <td className="text-right tabular-nums text-zinc-400 pt-3">{winPct}%</td>
                      <td className="text-right tabular-nums text-zinc-400 pt-3">{r.trades_count}</td>
                      <td className="text-right tabular-nums text-zinc-400 pt-3">{r.entries_count}</td>
                      <td className="pt-3">
                        <Sparkline values={curve} width={100} height={20} stroke={up ? "#46d39a" : "#ff6e6e"} />
                      </td>
                      <td className="pt-2">
                        {arsenal ? (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-accent-blue hover:underline">
                              {arsenal.isComposite ? `${arsenal.subKinds.length} subs` : "expand"}
                            </summary>
                            <div className="mt-2">
                              <ArsenalBlock arsenal={arsenal} subArsenals={subArsenals} />
                            </div>
                          </details>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* LiveBinaryPanel goes ABOVE the ranking table at the top of the page
            in the next iteration; for now it's here so we keep the ranking
            visible above. */}

        <nav className="text-xs text-zinc-500 flex gap-4">
          <Link href="/arena" className="hover:text-zinc-300">← Arena</Link>
          <Link href="/arena/training-campaigns" className="hover:text-accent-blue text-accent-blue/80">→ Training Campaigns</Link>
          <Link href="/arena/cohorts" className="hover:text-accent-blue text-accent-blue/80">→ Cohorts</Link>
          <Link href="/agents" className="hover:text-zinc-300">→ Agents catalogue</Link>
          <Link href="/capsules" className="hover:text-zinc-300">→ Capsules</Link>
        </nav>
      </div>
    </>
  );
}

function CoinbaseDataMenu() {
  type Row = { name: string; detail: string; persisted: "yes" | "on-demand" | "live-stream" };
  const rows: Row[] = [
    { name: "1-min candles", detail: "coinbase_candles · written by worker:snapshot", persisted: "yes" },
    { name: "Top-of-book snapshots", detail: "coinbase_snapshots · midpoint + best bid/ask", persisted: "yes" },
    { name: "L2 orderbook (top 10 levels)", detail: "coinbase_l2_snapshots · written by snapshot:cb-depth", persisted: "yes" },
    { name: "Recent trades firehose", detail: "coinbase_trades · written by snapshot:cb-trades", persisted: "yes" },
    { name: "24h product stats", detail: "coinbase_product_stats · written by snapshot:cb-stats", persisted: "yes" },
    { name: "5m / 15m / 1h / 6h / 1d candles", detail: "cb.getProductCandles(granularity) · fetch when an agent's lookback exceeds 1m persistence", persisted: "on-demand" },
    { name: "L50 full orderbook", detail: "cb.getProductBook(limit=50) · deeper than persisted L10", persisted: "on-demand" },
    { name: "Best-bid-ask multi-symbol sweep", detail: "cb.getBestBidAsk · single call returns top-of-book for many products", persisted: "on-demand" },
    { name: "Product metadata", detail: "cb.getProduct(productId) · status, base/quote, increment sizes", persisted: "on-demand" },
    { name: "Live ticker stream", detail: "subscribeCoinbase({ channel: 'ticker' }) · sub-second last-trade prints", persisted: "live-stream" },
    { name: "Live L2 stream", detail: "subscribeCoinbase({ channel: 'level2' }) · book diffs as they happen", persisted: "live-stream" },
    { name: "Live market_trades stream", detail: "subscribeCoinbase({ channel: 'market_trades' }) · every trade as it prints", persisted: "live-stream" },
    { name: "Live candles stream", detail: "subscribeCoinbase({ channel: 'candles' }) · 1-min candle updates inside the minute", persisted: "live-stream" },
  ];
  const badgeClass = (p: Row["persisted"]) =>
    p === "yes" ? "bg-accent-green/15 text-accent-green border-accent-green/40"
    : p === "live-stream" ? "bg-accent-blue/15 text-accent-blue border-accent-blue/40"
    : "bg-accent-amber/15 text-accent-amber border-accent-amber/40";
  const badgeLabel = (p: Row["persisted"]) => p === "yes" ? "persisted" : p === "live-stream" ? "live ws" : "on-demand";
  return (
    <section className="card border-accent-amber/30">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="card-title m-0">Coinbase data menu</h2>
        <span className="text-[10px] text-zinc-500">
          {rows.filter((r) => r.persisted === "yes").length} persisted · {rows.filter((r) => r.persisted === "on-demand").length} on-demand · {rows.filter((r) => r.persisted === "live-stream").length} live ws
        </span>
      </div>
      <p className="text-xs text-zinc-400 mb-3">
        Every Coinbase Advanced Trade feed the codebase can read.{" "}
        <span className="text-accent-green">persisted</span> = continuously
        written to SQLite, available to any decision function via a simple
        SELECT. <span className="text-accent-amber">on-demand</span> = the HTTP
        client method exists; the decision function would fetch live (costs
        rate-limit budget). <span className="text-accent-blue">live ws</span> =
        WebSocket channel; subscribe from a worker.
      </p>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.name} className="flex items-baseline gap-2">
            <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${badgeClass(r.persisted)}`}>
              {badgeLabel(r.persisted)}
            </span>
            <span className="text-zinc-300">{r.name}</span>
            <span className="text-zinc-500 truncate">— {r.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}


function familyClass(family: AgentArsenal["strategyFamily"]): string {
  // Fallback to neutral styling for "unknown" / new strategy families so a
  // missing switch case doesn't surface as a render-time "Error in input stream"
  // (Next.js wraps undefined-return in JSX class slots that way).
  switch (family) {
    case "polymarket": return "bg-accent-blue/15 text-accent-blue border-accent-blue/40";
    case "coinbase": return "bg-accent-amber/15 text-accent-amber border-accent-amber/40";
    case "cross_venue": return "bg-purple-500/15 text-purple-300 border-purple-500/40";
    case "wallet_copy": return "bg-accent-green/15 text-accent-green border-accent-green/40";
    case "llm": return "bg-pink-500/15 text-pink-300 border-pink-500/40";
    case "composite": return "bg-zinc-500/15 text-zinc-300 border-zinc-500/40";
    case "baseline": return "bg-zinc-700/40 text-zinc-500 border-zinc-700/40";
    default: return "bg-zinc-700/40 text-zinc-400 border-zinc-700/40";
  }
}

function capsuleStatusClass(status: string | null, allowLive: boolean): string {
  if (!status) return "bg-zinc-700/40 text-zinc-500 border-zinc-700/40";
  if (status === "live") return allowLive
    ? "bg-accent-red/20 text-accent-red border-accent-red/60"
    : "bg-zinc-700/40 text-zinc-300 border-zinc-500/40";
  if (status === "paper") return "bg-accent-blue/15 text-accent-blue border-accent-blue/40";
  if (status === "paused") return "bg-accent-amber/15 text-accent-amber border-accent-amber/40";
  if (status === "closed") return "bg-zinc-700/40 text-zinc-500 border-zinc-700/40";
  return "bg-zinc-700/40 text-zinc-300 border-zinc-600/40";
}

function ArsenalBlock({ arsenal, subArsenals }: { arsenal: AgentArsenal; subArsenals: AgentArsenal[] | null }) {
  const feeds = arsenal.capabilities.filter((c) => c.category === "data_feed");
  const modules = arsenal.capabilities.filter((c) => c.category === "decision_module");
  const constraints = arsenal.capabilities.filter((c) => c.category === "constraint");
  return (
    <div className="border border-zinc-800 rounded p-3 space-y-3 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border ${familyClass(arsenal.strategyFamily)}`}>
            {arsenal.strategyFamily}
          </span>
          <span className="text-zinc-200">{arsenal.strategyLabel}</span>
        </div>
        {arsenal.isComposite && (
          <div className="text-[11px] text-zinc-500">
            Composite agent: picks first non-hold signal from {arsenal.subKinds.join(" → ")}
          </div>
        )}
      </div>

      <CapabilityList title="Data feeds" items={feeds} accent="accent-blue" />
      <CapabilityList title="Decision modules" items={modules} accent="accent-amber" />
      <CapabilityList title="Constraints" items={constraints} accent="accent-red" />

      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Genome parameters</div>
        {arsenal.genomeParams.length === 0 ? (
          <div className="text-[11px] text-zinc-600">(none — composite delegates to subs)</div>
        ) : (
          // grid-of-divs instead of <table> — avoids HTML table foster-parenting
          // (where whitespace between <table> and <tbody> in JSX gets re-parented
          // by the browser and creates a hydration mismatch in Next 15 Turbopack)
          <div className="text-[11px] grid grid-cols-[auto_1fr_auto] gap-x-2 gap-y-0.5">
            {arsenal.genomeParams.map((p) => (
              <div key={p.key} className="contents">
                <div className="text-zinc-400 font-mono border-t border-zinc-800 py-0.5">{p.key}</div>
                <div className="text-zinc-200 font-mono border-t border-zinc-800 py-0.5">{formatValue(p.value)}</div>
                <div className="text-zinc-500 text-[10px] border-t border-zinc-800 py-0.5">{formatBounds(p)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {subArsenals && subArsenals.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Sub-strategies</div>
          <div className="space-y-2">
            {subArsenals.map((sub, i) => (
              <details key={i} className="border border-zinc-800/60 rounded p-2">
                <summary className="cursor-pointer text-[11px] text-accent-blue">
                  {i + 1}. {sub.strategyLabel}
                </summary>
                <div className="mt-2">
                  <ArsenalBlock arsenal={sub} subArsenals={null} />
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CapabilityList({ title, items, accent }: { title: string; items: ArsenalCapability[]; accent: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{title}</div>
      <ul className="space-y-1">
        {items.map((c, i) => (
          <li key={i} className="text-[11px]">
            <span className={`text-${accent}`}>· </span>
            <span className="text-zinc-300">{c.name}</span>
            <span className="text-zinc-500"> — {c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toString();
    return Math.abs(v) < 1 ? v.toFixed(4) : v.toFixed(2);
  }
  if (typeof v === "string") return v.length > 32 ? v.slice(0, 28) + "..." : v;
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (v === null || v === undefined) return "—";
  return JSON.stringify(v);
}

function formatBounds(p: GenomeParam): string {
  if (!p.bounds) return "";
  if (Array.isArray(p.bounds) && p.bounds.length === 2 && typeof p.bounds[0] === "number") {
    const [lo, hi] = p.bounds as [number, number];
    return `[${lo}..${hi}]`;
  }
  if (Array.isArray(p.bounds) && typeof p.bounds[0] === "string") {
    const opts = (p.bounds as string[]).slice(0, 4).join(" | ");
    return `(${opts}${(p.bounds as string[]).length > 4 ? "..." : ""})`;
  }
  return "";
}
