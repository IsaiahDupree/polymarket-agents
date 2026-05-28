/**
 * Observation-mode runner for the late-window-scalp strategy.
 *
 * Runs scanner + executor in a single process, **sim only** (no real
 * money). Designed to gather data: how often the strategy fires, what
 * win-rate the bot's would-have-trades achieve, comparison vs the
 * operator's manual record.
 *
 * Safety contract:
 *   - LATE_SCALP_LIVE is FORCED OFF here. Even if set in env, this
 *     script overrides to 'sim'. Real-money runs use worker:late-window-scalp-exec.
 *   - First-run idempotently creates a `late-window-scalp` paper capsule
 *     with status='paper' so the executor has a capsule binding without
 *     committing real capital.
 *
 * Loop:
 *   - Every SCAN_INTERVAL_MS: run scanner, capture opportunities
 *   - Every POLL_MS: executor pass, sim-routes opportunities through router
 *   - On any iteration: report stats since process start
 *
 *   npx tsx scripts/observe-late-window-scalp.ts
 *   npx tsx scripts/observe-late-window-scalp.ts --scan-ms 20000 --poll-ms 10000
 *
 * To stop: Ctrl+C. Final stats printed on exit.
 */
import "./_env.ts";
// Force sim mode regardless of env so this script can NEVER fire real orders.
process.env.LATE_SCALP_LIVE = "0";

import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { poly } from "../src/lib/polymarket/client.ts";
import {
  detectLateWindowScalp,
  type BinaryBookSnapshot,
} from "../src/lib/strategies/late-window-scalp.ts";
import { recordHeartbeat } from "../src/lib/heartbeat.ts";

const args = process.argv.slice(2);
function flagNum(name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return Number(args[i + 1]);
  return fallback;
}

const SCAN_INTERVAL_MS = flagNum("scan-ms", 30_000);
const POLL_MS = flagNum("poll-ms", 15_000);
const MIN_ASK = flagNum("min-ask", 0.85);
const MAX_ASK = flagNum("max-ask", 0.98);
const MAX_REM_SEC = flagNum("max-remaining-sec", 180);
const SCAN_LIMIT = flagNum("limit", 100);

console.log("[observe-late-scalp] starting in SIM-ONLY mode");
console.log(`  scanner cadence: ${SCAN_INTERVAL_MS / 1000}s`);
console.log(`  executor poll:   ${POLL_MS / 1000}s`);
console.log(`  detector gates:  min_ask=${MIN_ASK} max_ask=${MAX_ASK} window≤${MAX_REM_SEC}s`);
console.log(`  LIVE override:   FORCED OFF (cannot place real orders from this script)`);

// ── First-run: ensure the late-window-scalp paper capsule exists. ────
function ensurePaperCapsule(): string {
  const handle = db();
  const existing = handle.prepare("SELECT id, status FROM capsules WHERE id = 'late-window-scalp'").get() as { id: string; status: string } | undefined;
  if (existing) {
    console.log(`  capsule:         existing '${existing.id}' (status=${existing.status})`);
    return existing.id;
  }
  // Find the strategy_id for late-window-scalp.
  const strat = handle.prepare("SELECT id FROM strategies WHERE slug = 'late-window-scalp'").get() as { id: number } | undefined;
  if (!strat) {
    console.error("[observe-late-scalp] no 'late-window-scalp' strategy seeded — run npm run db:seed:gen2 first.");
    process.exit(2);
  }
  handle.prepare(
    `INSERT INTO capsules
       (id, name, status, strategy_id,
        capital_allocated_usd, capital_available_usd, capital_deployed_usd,
        max_daily_loss_usd, max_total_drawdown_usd, max_position_pct,
        max_open_positions, max_trades_per_day,
        allowed_venues_json, allowed_symbols_json, min_seconds_between_trades,
        strategy_family, asset_class, regime_dependency, time_horizon, directional_bias,
        diversity_confidence,
        created_at, updated_at)
     VALUES
       ('late-window-scalp', 'Late-window scalp (paper)', 'paper', @strategy_id,
        0, 0, 0,
        0, 0, 0,
        0, 100,
        '[]', NULL, 0,
        'directional', 'prediction_market', 'any', '5m', 'long_short',
        'operator_set',
        datetime('now'), datetime('now'))`,
  ).run({ strategy_id: strat.id });
  console.log(`  capsule:         created new paper capsule 'late-window-scalp'`);
  insertEvolutionEvent({
    event_type: "capsule-paper-created",
    summary: "Paper capsule 'late-window-scalp' created for observe-mode data gathering",
    payload_json: JSON.stringify({ source: "observe-late-window-scalp", capsule_id: "late-window-scalp" }),
  });
  return "late-window-scalp";
}

const capsuleId = ensurePaperCapsule();
process.env.LATE_SCALP_CAPSULE = capsuleId;
process.env.LATE_SCALP_POLL_MS = String(POLL_MS);

// ── Scanner loop ─────────────────────────────────────────────────────
type OrderBookResp = {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
};
function topAsk(book: OrderBookResp | null): { price: number; depthUsd: number } | null {
  if (!book || !Array.isArray(book.asks) || book.asks.length === 0) return null;
  const cheapest = Number(book.asks[0]!.price);
  if (!Number.isFinite(cheapest)) return null;
  let shares = 0;
  for (const a of book.asks) {
    const p = Number(a.price);
    if (p !== cheapest) break;
    const s = Number(a.size);
    if (Number.isFinite(s)) shares += s;
  }
  return { price: cheapest, depthUsd: shares * cheapest };
}

const stats = { scans: 0, candidates: 0, opportunities: 0, executions: 0, exec_skipped: 0 };

async function scanOnce() {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoffIso = new Date(nowMs + MAX_REM_SEC * 1000).toISOString();
  const binaries = db()
    .prepare(
      `SELECT token_id, condition_id, no_token_id, question, asset, expiry_iso
         FROM poly_binaries
        WHERE settled = 0 AND no_token_id IS NOT NULL
          AND expiry_iso > ? AND expiry_iso <= ?
        ORDER BY expiry_iso ASC LIMIT ?`,
    )
    .all(nowIso, cutoffIso, SCAN_LIMIT) as Array<{
      token_id: string; condition_id: string; no_token_id: string;
      question: string; asset: string; expiry_iso: string;
    }>;

  stats.scans++;
  stats.candidates += binaries.length;
  if (binaries.length === 0) return;

  let foundThisScan = 0;
  for (const b of binaries) {
    let upBook: OrderBookResp | null = null;
    let downBook: OrderBookResp | null = null;
    try { upBook = (await poly.orderbook(b.token_id)) as OrderBookResp; } catch { continue; }
    try { downBook = (await poly.orderbook(b.no_token_id)) as OrderBookResp; } catch { continue; }
    const upAsk = topAsk(upBook); const downAsk = topAsk(downBook);
    if (!upAsk || !downAsk) continue;

    const snap: BinaryBookSnapshot = {
      conditionId: b.condition_id,
      title: b.question,
      asset: b.asset,
      windowCloseMs: Date.parse(b.expiry_iso),
      nowMs,
      upBestAsk: upAsk.price,
      downBestAsk: downAsk.price,
      upDepthUsd: upAsk.depthUsd,
      downDepthUsd: downAsk.depthUsd,
    };
    const opp = detectLateWindowScalp(snap, {
      minAsk: MIN_ASK, maxAsk: MAX_ASK, maxRemainingSec: MAX_REM_SEC,
    });
    if (!opp) continue;

    foundThisScan++;
    stats.opportunities++;
    console.log(`  [scan] ✓ ${b.condition_id.slice(0, 10)} ${b.asset.padEnd(5)} ${opp.reason.slice(0, 90)}`);
    insertEvolutionEvent({
      event_type: "late-window-scalp-opportunity",
      summary: opp.reason.slice(0, 200),
      payload_json: JSON.stringify({
        conditionId: opp.conditionId, title: opp.title, asset: opp.asset,
        side: opp.side, entry_price: opp.entry_price,
        payoff_per_share: opp.payoff_per_share, max_shares: opp.max_shares,
        capital_required_usd: opp.capital_required_usd, max_payoff_usd: opp.max_payoff_usd,
        remaining_sec: opp.remaining_sec, scan_ts: nowIso,
        token_id: opp.side === "UP" ? b.token_id : b.no_token_id,
      }),
    });
  }
  recordHeartbeat("snapshot-evolution", { scanner: "late-window-scalp-observe", scanned: binaries.length, found: foundThisScan });
}

// ── Executor loop (uses worker's pollOnce; sim venue forced) ─────────
async function execLoop() {
  const { pollOnce } = await import("./worker-late-window-scalp-exec.ts");
  while (true) {
    try {
      const r = await pollOnce();
      if (r.executed > 0 || r.skipped > 0) {
        stats.executions += r.executed;
        stats.exec_skipped += r.skipped;
        console.log(`  [exec] checked=${r.checked} executed=${r.executed} skipped=${r.skipped} budget=$${r.remainingBudget.toFixed(2)}`);
      }
    } catch (err) {
      console.error(`  [exec] err: ${(err as Error).message?.slice(0, 100)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function scanLoop() {
  while (true) {
    try { await scanOnce(); } catch (err) { console.error(`  [scan] err: ${(err as Error).message?.slice(0, 100)}`); }
    await new Promise((r) => setTimeout(r, SCAN_INTERVAL_MS));
  }
}

function printStats() {
  console.log("");
  console.log(`[observe-late-scalp] stats:`);
  console.log(`  scans:         ${stats.scans}`);
  console.log(`  candidates:    ${stats.candidates}  (binaries in window)`);
  console.log(`  opportunities: ${stats.opportunities}  (detector fired)`);
  console.log(`  sim executions:${stats.executions}`);
  console.log(`  exec skipped:  ${stats.exec_skipped}`);
}

process.on("SIGINT", () => {
  console.log("\n[observe-late-scalp] caught SIGINT — stopping");
  printStats();
  process.exit(0);
});

// Periodic stats every minute.
setInterval(printStats, 60_000).unref();

scanLoop();
execLoop();
