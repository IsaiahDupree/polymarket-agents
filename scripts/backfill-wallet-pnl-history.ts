/**
 * Backfill wallet PnL history into capsule_pnl_daily.
 *
 * Without this, the correlation engine + loss-overlap calculations depend
 * entirely on PROSPECTIVE data from the daily portfolio-snapshot worker —
 * which means the first 7+ days of capsule_correlations rows are flagged
 * low_confidence and loss-overlap shows "—" everywhere.
 *
 * This script pulls actual trade history from Polymarket's data-api for
 * the operator's wallet (POLYMARKET_FUNDER_ADDRESS), attributes each
 * realized PnL event to the live capsule that was active at the time of
 * close, buckets by UTC day, and UPSERTs into capsule_pnl_daily.
 *
 * Attribution algorithm (PRD §1.5):
 *   For each closed position:
 *     close_ts = max(trade.timestamp WHERE trade.conditionId == position.conditionId)
 *     active_capsules = capsules WHERE activated_at <= close_ts
 *                                   AND (updated_at IS NULL OR updated_at >= close_ts
 *                                        OR status IN ('live', 'paper'))
 *                                   AND strategy_family != 'reserve'
 *     If exactly one active capsule → attribute realized_pnl to it
 *     If multiple → split proportionally by capital_allocated_usd
 *     If none (trade predates any capsule) → skip with a 'orphan' counter
 *
 * Idempotent: UPSERT on (capsule_id, pnl_date) overwrites the existing
 * daily_pnl_usd. Re-running is safe.
 *
 *   npx tsx scripts/backfill-wallet-pnl-history.ts
 *   npx tsx scripts/backfill-wallet-pnl-history.ts --dry-run
 *   npx tsx scripts/backfill-wallet-pnl-history.ts --days 60
 */
import "./_env.ts";
import { db as openDb } from "../src/lib/db/client.ts";
import { polyFetch } from "../src/lib/polymarket/proxy-routing.ts";

type Args = { dryRun: boolean; lookbackDays: number; limit: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, lookbackDays: 90, limit: 500 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--days") args.lookbackDays = Number(argv[++i]);
    else if (a === "--limit") args.limit = Number(argv[++i]);
  }
  return args;
}

type ClosedPosition = {
  conditionId: string;
  title?: string;
  outcome?: string;
  size: number;
  initialValue: number;
  finalValue?: number;
  realizedPnl: number;
};

type Trade = {
  timestamp: number; // unix seconds
  conditionId: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdcSize?: number;
  transactionHash?: string;
};

type CapsuleRow = {
  id: string;
  status: string;
  strategy_family: string | null;
  capital_allocated_usd: number;
  activated_at: string | null;
  updated_at: string;
};

async function fetchJson<T>(url: string, opts: RequestInit & { timeoutMs?: number } = {}): Promise<T | null> {
  const { timeoutMs = 15_000, ...rest } = opts;
  try {
    const r = await polyFetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) {
      console.warn(`  ! ${url.slice(-60)} → HTTP ${r.status}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    console.warn(`  ! ${url.slice(-60)} → ${(err as Error).message?.slice(0, 80)}`);
    return null;
  }
}

/**
 * Returns the capsules that were active at `tsMs` (epoch ms).
 * "Active" = activated_at exists AND <= tsMs, AND capsule wasn't yet
 * stopped/closed by tsMs. Reserve capsules are excluded.
 */
function activeCapsulesAt(capsules: readonly CapsuleRow[], tsMs: number): CapsuleRow[] {
  return capsules.filter((c) => {
    if (c.strategy_family === "reserve") return false;
    if (!c.activated_at) return false;
    const activatedMs = Date.parse(c.activated_at);
    if (!Number.isFinite(activatedMs) || activatedMs > tsMs) return false;
    // A capsule that's currently still 'live' or 'paper' is active up to now.
    // A capsule that's 'paused' / 'stopped' / 'closed' was active up to its
    // updated_at (best proxy for when status changed).
    if (c.status === "live" || c.status === "paper") return true;
    const stoppedMs = Date.parse(c.updated_at);
    if (!Number.isFinite(stoppedMs)) return true;
    return tsMs <= stoppedMs;
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const db = openDb();
  const wallet = (process.env.POLYMARKET_FUNDER_ADDRESS ?? "").toLowerCase();
  if (!wallet || !wallet.startsWith("0x")) {
    console.error("[backfill-wallet-pnl] POLYMARKET_FUNDER_ADDRESS not set.");
    process.exit(2);
  }

  console.log(`[backfill-wallet-pnl] wallet=${wallet.slice(0, 10)}… lookback=${args.lookbackDays}d limit=${args.limit}`);

  // Load active capsules (live, paper, paused, stopped) ordered by activated_at.
  // Excludes reserve (un-deployable).
  const capsules = db
    .prepare(
      `SELECT id, status, strategy_family, capital_allocated_usd, activated_at, updated_at
         FROM capsules
        WHERE activated_at IS NOT NULL
          AND (strategy_family != 'reserve' OR strategy_family IS NULL)
        ORDER BY activated_at ASC`,
    )
    .all() as CapsuleRow[];

  if (capsules.length === 0) {
    console.error("[backfill-wallet-pnl] no capsules with activation timestamps found. Nothing to attribute.");
    process.exit(2);
  }
  console.log(`[backfill-wallet-pnl] ${capsules.length} capsules eligible for attribution`);

  // 1. Fetch closed positions (gives realized PnL per position).
  console.log(`[backfill-wallet-pnl] fetching /closed-positions...`);
  const closed = (await fetchJson<ClosedPosition[]>(
    `https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=${args.limit}`,
  )) ?? [];
  console.log(`  → ${closed.length} closed positions`);

  if (closed.length === 0) {
    console.log("[backfill-wallet-pnl] wallet has no closed positions yet. Nothing to backfill.");
    return;
  }

  // 2. Fetch trade activity (gives per-trade timestamps).
  console.log(`[backfill-wallet-pnl] fetching /activity?type=TRADE...`);
  const activity = (await fetchJson<Trade[]>(
    `https://data-api.polymarket.com/activity?user=${wallet}&limit=${args.limit}&type=TRADE`,
  )) ?? [];
  console.log(`  → ${activity.length} trade events`);

  // 3. Build conditionId → latest_sell_timestamp_ms map.
  // For each conditionId, find the most-recent SELL trade. That's our close
  // timestamp. (Polymarket binaries close via SELL or via REDEMPTION; for
  // direct sells we use the trade ts; for redemptions Polymarket events
  // surface them in activity with a different type — for v1 we use SELL as
  // the proxy; redemption-style closes get filtered by missing trade match
  // and counted as 'orphans'.)
  const closeTsByCondition = new Map<string, number>();
  for (const t of activity) {
    if (t.side !== "SELL") continue;
    const tsMs = t.timestamp * 1000;
    const existing = closeTsByCondition.get(t.conditionId);
    if (existing === undefined || tsMs > existing) {
      closeTsByCondition.set(t.conditionId, tsMs);
    }
  }

  // 4. Attribute each closed position's realized_pnl to a capsule via the
  // close timestamp.
  const cutoffMs = Date.now() - args.lookbackDays * 86_400_000;
  type AttribRow = { capsule_id: string; date: string; realized_pnl: number };
  const attributions: AttribRow[] = [];
  let orphanTrades = 0;
  let preCutoff = 0;
  let attributable = 0;

  for (const pos of closed) {
    if (!Number.isFinite(pos.realizedPnl) || pos.realizedPnl === 0) continue;
    const closeMs = closeTsByCondition.get(pos.conditionId);
    if (closeMs === undefined) {
      orphanTrades++;
      continue;
    }
    if (closeMs < cutoffMs) {
      preCutoff++;
      continue;
    }
    const active = activeCapsulesAt(capsules, closeMs);
    if (active.length === 0) {
      orphanTrades++;
      continue;
    }
    attributable++;

    // If multiple capsules active simultaneously, split proportionally by capital.
    const totalCapital = active.reduce((s, c) => s + (c.capital_allocated_usd || 0), 0);
    const date = new Date(closeMs).toISOString().slice(0, 10);
    if (totalCapital <= 0 || active.length === 1) {
      attributions.push({ capsule_id: active[0]!.id, date, realized_pnl: pos.realizedPnl });
    } else {
      for (const c of active) {
        const share = (c.capital_allocated_usd || 0) / totalCapital;
        attributions.push({ capsule_id: c.id, date, realized_pnl: pos.realizedPnl * share });
      }
    }
  }

  console.log("");
  console.log(`[backfill-wallet-pnl] attribution summary:`);
  console.log(`  attributable closed positions: ${attributable}`);
  console.log(`  orphan (no capsule active or no matching trade): ${orphanTrades}`);
  console.log(`  pre-cutoff (older than --days): ${preCutoff}`);

  // 5. Group by (capsule_id, date) and sum.
  const byKey = new Map<string, AttribRow>();
  for (const a of attributions) {
    const key = `${a.capsule_id}|${a.date}`;
    const existing = byKey.get(key);
    if (existing) existing.realized_pnl += a.realized_pnl;
    else byKey.set(key, { ...a });
  }
  const rows = Array.from(byKey.values()).sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  console.log(`  unique (capsule, day) rows to write: ${rows.length}`);

  // 6. UPSERT.
  if (args.dryRun) {
    console.log("");
    console.log("(dry-run — not writing)");
    for (const r of rows.slice(0, 20)) {
      console.log(`  ${r.capsule_id.slice(0, 8)}  ${r.date}  $${r.realized_pnl.toFixed(2)}`);
    }
    if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
    return;
  }

  const upsert = db.prepare(
    `INSERT INTO capsule_pnl_daily (capsule_id, pnl_date, daily_pnl_usd, trades_count, ending_equity_usd)
     VALUES (@capsule_id, @date, @realized_pnl, 0, NULL)
     ON CONFLICT(capsule_id, pnl_date) DO UPDATE SET
       daily_pnl_usd = excluded.daily_pnl_usd`,
  );
  const writeOne = db.transaction((r: AttribRow) => upsert.run(r));
  for (const r of rows) writeOne(r);

  console.log("");
  console.log(`[backfill-wallet-pnl] wrote ${rows.length} rows.`);

  // 7. Sanity report: rows by capsule.
  const byCapsule = db
    .prepare(
      `SELECT capsule_id, COUNT(*) AS n, SUM(daily_pnl_usd) AS total_pnl
         FROM capsule_pnl_daily
        WHERE pnl_date >= date('now', '-' || ? || ' days')
        GROUP BY capsule_id
        ORDER BY total_pnl DESC`,
    )
    .all(args.lookbackDays) as Array<{ capsule_id: string; n: number; total_pnl: number }>;

  console.log("");
  console.log(`[backfill-wallet-pnl] capsule_pnl_daily contents (last ${args.lookbackDays}d):`);
  for (const r of byCapsule) {
    console.log(`  ${r.capsule_id.slice(0, 8)}  ${r.n} days  total $${r.total_pnl.toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error(`[backfill-wallet-pnl] fatal: ${(err as Error).message}`);
  process.exit(1);
});
