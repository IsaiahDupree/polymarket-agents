/**
 * Late-window-scalp auto-executor — long-running worker.
 *
 *   npm run worker:late-window-scalp-exec               # sim mode (no money)
 *   LATE_SCALP_LIVE=1 npm run worker:late-window-scalp-exec   # arm live (CAREFUL)
 *
 * Polls evolution_log for new `late-window-scalp-opportunity` events.
 * For each unseen opportunity:
 *   - Verify still in window (skip if already past resolution)
 *   - Cap order USD to per-signal cap + remaining daily budget
 *   - Submit a BUY of the favored side through ExecutionRouter
 *   - Writes `late-scalp-auto-exec` event with full provenance
 *
 * Defaults match the operator's manual pattern (audit-wallet 2026-05-28):
 *   - venue           = 'sim' (LATE_SCALP_LIVE=1 → 'polymarket')
 *   - per-signal cap  = $2     (LATE_SCALP_PER_SIGNAL_USD) — matches operator's $2/trade
 *   - daily USD cap   = $10    (LATE_SCALP_DAILY_USD_CAP) — bounded blast radius
 *   - poll interval   = 15s    (LATE_SCALP_POLL_MS) — short windows close fast
 *   - capsule         = "late-window-scalp" (LATE_SCALP_CAPSULE)
 *
 * Idempotency: dedup key = source opportunity event ID.
 * Capsule + risk gates apply. Missing capsule → router rejects with
 * CAPSULE_NOT_FOUND and the executor logs + moves on.
 */
import { randomUUID } from "node:crypto";
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { getDefaultRouter } from "../src/lib/venue/router.ts";
import type { UnifiedOrder } from "../src/lib/venue/types.ts";

const LIVE = process.env.LATE_SCALP_LIVE === "1" || process.env.LATE_SCALP_LIVE === "true";
const PER_SIGNAL_USD = Number(process.env.LATE_SCALP_PER_SIGNAL_USD ?? 2);
const DAILY_CAP_USD = Number(process.env.LATE_SCALP_DAILY_USD_CAP ?? 10);
const POLL_MS = Number(process.env.LATE_SCALP_POLL_MS ?? 15_000);
const CAPSULE_ID = process.env.LATE_SCALP_CAPSULE ?? "late-window-scalp";
const VENUE = LIVE ? "polymarket" : "sim";

console.log("[late-scalp-exec] starting");
console.log(`  mode:       ${LIVE ? "LIVE (CAREFUL!)" : "sim (no money)"}`);
console.log(`  venue:      ${VENUE}`);
console.log(`  per-signal: $${PER_SIGNAL_USD}`);
console.log(`  daily cap:  $${DAILY_CAP_USD}`);
console.log(`  poll:       ${POLL_MS}ms`);
console.log(`  capsule:    ${CAPSULE_ID}`);

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function pollOnce(): Promise<{ checked: number; executed: number; skipped: number; remainingBudget: number }> {
  const handle = db();
  const today = todayUtc();

  // Today's deployed USD on this strategy.
  const todayDeployed = (
    handle
      .prepare(
        `SELECT COALESCE(SUM(CAST(json_extract(payload_json, '$.orderUsd') AS REAL)), 0) AS d
           FROM evolution_log
          WHERE event_type = 'late-scalp-auto-exec'
            AND date(created_at) = ?`,
      )
      .get(today) as { d: number }
  ).d;

  let remainingBudget = DAILY_CAP_USD - todayDeployed;
  if (remainingBudget <= 0) {
    console.log(`[late-scalp-exec] daily cap hit ($${todayDeployed.toFixed(2)}/$${DAILY_CAP_USD}); idling`);
    return { checked: 0, executed: 0, skipped: 0, remainingBudget: 0 };
  }

  // Pull recent opportunities — only last 5 minutes (these are 5m binaries).
  const opps = handle
    .prepare(
      `SELECT id, summary, payload_json, created_at
         FROM evolution_log
        WHERE event_type = 'late-window-scalp-opportunity'
          AND created_at >= datetime('now', '-5 minutes')
        ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: number; summary: string; payload_json: string; created_at: string }>;
  if (opps.length === 0) return { checked: 0, executed: 0, skipped: 0, remainingBudget };

  // Dedup against already-executed opportunities.
  const executedRows = handle
    .prepare("SELECT payload_json FROM evolution_log WHERE event_type = 'late-scalp-auto-exec' AND date(created_at) = ?")
    .all(today) as Array<{ payload_json: string }>;
  const executedIds = new Set<number>();
  for (const e of executedRows) {
    try {
      executedIds.add(JSON.parse(e.payload_json).opportunityId);
    } catch { /* ignore */ }
  }

  const router = getDefaultRouter();
  const nowMs = Date.now();
  let executed = 0;
  let skipped = 0;

  for (const opp of opps) {
    if (executedIds.has(opp.id)) {
      skipped++;
      continue;
    }
    if (remainingBudget <= 0) break;

    let payload: {
      conditionId: string;
      title?: string;
      asset: string;
      side: "UP" | "DOWN";
      entry_price: number;
      payoff_per_share: number;
      max_shares: number;
      capital_required_usd: number;
      remaining_sec: number;
      scan_ts: string;
      token_id: string;
    };
    try {
      payload = JSON.parse(opp.payload_json);
    } catch (err) {
      console.error(`[late-scalp-exec] bad payload on opp ${opp.id}: ${(err as Error).message}`);
      skipped++;
      continue;
    }

    // Still in window? The opportunity ts + remaining_sec gives an upper
    // bound on when the window closes. If the scan was N seconds ago and
    // remaining_sec at scan-time was M, then now we have remaining_sec - N.
    const scanMs = Date.parse(payload.scan_ts);
    const elapsedSec = (nowMs - scanMs) / 1000;
    const stillRemaining = payload.remaining_sec - elapsedSec;
    if (stillRemaining < 15) {
      console.log(`  ⊘ opp ${opp.id} ${payload.asset} ${payload.side} — window too close (${stillRemaining.toFixed(0)}s left)`);
      skipped++;
      continue;
    }

    // Order sizing — capped at min(per-signal, remaining-budget, capital-required-by-detector).
    const orderUsd = Math.min(PER_SIGNAL_USD, remainingBudget, payload.capital_required_usd);
    if (orderUsd < 0.50) {
      console.log(`  ⊘ opp ${opp.id} — order size below $0.50 floor (got $${orderUsd.toFixed(2)})`);
      skipped++;
      continue;
    }

    // Compute share count from USD ÷ entry price.
    const shares = orderUsd / payload.entry_price;

    const clientOrderId = `late-scalp-${randomUUID().slice(0, 8)}`;
    const order: UnifiedOrder = {
      clientOrderId,
      venue: VENUE,
      symbol: payload.token_id,
      side: "BUY",
      type: "MARKET",
      size: shares,
      refPrice: payload.entry_price,
      capsuleId: CAPSULE_ID,
      metadata: {
        source: "late-window-scalp",
        asset: payload.asset,
        condition_id: payload.conditionId,
        favored_side: payload.side,
        opportunity_id: opp.id,
        sizeUsd: orderUsd, // adapter reads this for MARKET path notional
        intent: "entry",
        rationale: `late-window scalp · ${payload.asset} ${payload.side} @ $${payload.entry_price.toFixed(3)} · ${stillRemaining.toFixed(0)}s remaining`,
      },
    } as UnifiedOrder & { capsuleId: string };

    const verdict = await router.submit(order);

    insertEvolutionEvent({
      event_type: "late-scalp-auto-exec",
      summary:
        `late-scalp ${payload.asset} ${payload.side} @ $${payload.entry_price.toFixed(3)} · $${orderUsd.toFixed(2)} · ${verdict.ok ? ("status" in verdict ? verdict.status : "ok") : "rejected"}`,
      payload_json: JSON.stringify({
        opportunityId: opp.id,
        opportunityTs: opp.created_at,
        clientOrderId,
        venue: VENUE,
        capsuleId: CAPSULE_ID,
        asset: payload.asset,
        side: payload.side,
        entryPrice: payload.entry_price,
        orderUsd,
        shares,
        remainingSec: stillRemaining,
        verdict,
      }),
    });

    if (verdict.ok) {
      executed++;
      remainingBudget -= orderUsd;
      console.log(`  ✓ opp ${opp.id} ${payload.asset} ${payload.side} @ $${payload.entry_price.toFixed(3)} · order $${orderUsd.toFixed(2)} · ${("status" in verdict ? verdict.status : "ok")}`);
    } else {
      skipped++;
      const reason = (verdict as { code?: string; reason?: string }).reason ?? "rejected";
      console.log(`  ✗ opp ${opp.id} rejected — ${reason}`);
    }
  }

  return { checked: opps.length, executed, skipped, remainingBudget };
}

async function loop() {
  while (true) {
    try {
      const r = await pollOnce();
      if (r.checked > 0 || r.executed > 0) {
        console.log(`[late-scalp-exec] poll: checked=${r.checked} executed=${r.executed} skipped=${r.skipped} budget=$${r.remainingBudget.toFixed(2)}`);
      }
    } catch (err) {
      console.error(`[late-scalp-exec] poll error: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();
