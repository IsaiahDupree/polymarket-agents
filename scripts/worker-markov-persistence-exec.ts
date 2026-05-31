/**
 * Markov persistence auto-executor — long-running worker.
 *
 *   npm run worker:markov-exec
 *   MARKOV_LIVE=1 npm run worker:markov-exec    # arm live (CAREFUL)
 *
 * Polls evolution_log for new `markov-persistence-opportunity` events
 * (written by scan-markov-persistence). For each unseen opportunity,
 * calls `decideOrder` (pure, tested separately) and submits a LIMIT
 * order via ExecutionRouter. LIMIT path means the Becker maker-only
 * gate passes naturally without an allowTaker opt-in.
 *
 * Defaults are conservative:
 *   - venue           = 'sim' (no money) unless MARKOV_LIVE=1 → 'polymarket'
 *   - per-signal cap  = $25       (MARKOV_PER_SIGNAL_USD)
 *   - daily USD cap   = $100      (MARKOV_DAILY_USD_CAP)
 *   - poll interval   = 60s       (MARKOV_POLL_MS)
 *   - capsule         = "markov-persistence" (MARKOV_CAPSULE)
 *   - Kelly fraction  = 0.25      (MARKOV_KELLY_FRACTION) — Quarter Kelly
 *
 * Idempotency: dedup key = source opportunity event ID. Re-runs never
 * double-execute. Capsule + global risk gates apply via the router.
 */
import { randomUUID } from "node:crypto";
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { getDefaultRouter } from "@core/venue/router";
import {
  decideOrder,
  type MarkovPersistencePayload,
} from "../src/lib/strategies/markov-persistence-executor.ts";

const LIVE = process.env.MARKOV_LIVE === "1" || process.env.MARKOV_LIVE === "true";
const PER_SIGNAL_USD = Number(process.env.MARKOV_PER_SIGNAL_USD ?? 25);
const DAILY_CAP_USD = Number(process.env.MARKOV_DAILY_USD_CAP ?? 100);
const POLL_MS = Number(process.env.MARKOV_POLL_MS ?? 60_000);
const CAPSULE_ID = process.env.MARKOV_CAPSULE ?? "markov-persistence";
const KELLY_LAMBDA = Number(process.env.MARKOV_KELLY_FRACTION ?? 0.25);
const VENUE: "sim" | "polymarket" = LIVE ? "polymarket" : "sim";

console.log("[markov-exec] starting");
console.log(`  mode:        ${LIVE ? "LIVE (CAREFUL!)" : "sim (no money)"}`);
console.log(`  venue:       ${VENUE}`);
console.log(`  per-signal:  $${PER_SIGNAL_USD} cap`);
console.log(`  daily:       $${DAILY_CAP_USD} cap`);
console.log(`  poll:        ${POLL_MS}ms`);
console.log(`  capsule:     ${CAPSULE_ID}`);
console.log(`  kelly λ:     ${KELLY_LAMBDA}`);

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
          WHERE event_type = 'markov-auto-exec'
            AND date(created_at) = ?`,
      )
      .get(today) as { d: number }
  ).d;

  let remainingBudget = DAILY_CAP_USD - todayDeployed;
  if (remainingBudget <= 0) {
    console.log(`[markov-exec] daily cap hit ($${todayDeployed.toFixed(0)}/$${DAILY_CAP_USD}); idling`);
    return { checked: 0, executed: 0, skipped: 0, remainingBudget: 0 };
  }

  const opps = handle
    .prepare(
      `SELECT id, summary, payload_json, created_at
         FROM evolution_log
        WHERE event_type = 'markov-persistence-opportunity'
          AND created_at >= datetime('now', '-2 hours')
        ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: number; summary: string; payload_json: string; created_at: string }>;
  if (opps.length === 0) return { checked: 0, executed: 0, skipped: 0, remainingBudget };

  // Dedup: ids we've already attempted.
  const executedRows = handle
    .prepare("SELECT payload_json FROM evolution_log WHERE event_type = 'markov-auto-exec'")
    .all() as Array<{ payload_json: string }>;
  const executedIds = new Set<number>();
  for (const e of executedRows) {
    try {
      executedIds.add(JSON.parse(e.payload_json).opportunityId);
    } catch {
      /* ignore */
    }
  }

  const router = getDefaultRouter();
  let executed = 0;
  let skipped = 0;

  for (const opp of opps) {
    if (executedIds.has(opp.id)) {
      skipped++;
      continue;
    }
    if (remainingBudget <= 0) break;

    let payload: MarkovPersistencePayload;
    try {
      payload = JSON.parse(opp.payload_json) as MarkovPersistencePayload;
    } catch (err) {
      console.error(`[markov-exec] bad payload on opp ${opp.id}: ${(err as Error).message}`);
      skipped++;
      continue;
    }

    const decision = decideOrder(payload, {
      opportunityId: opp.id,
      perSignalUsdCap: PER_SIGNAL_USD,
      remainingBudgetUsd: remainingBudget,
      kellyFraction: KELLY_LAMBDA,
      venue: VENUE,
      capsuleId: CAPSULE_ID,
      coidSuffix: () => randomUUID().slice(0, 8),
    });

    if (decision.kind === "skip") {
      console.log(`[markov-exec] opp ${opp.id} skipped: ${decision.reason}`);
      insertEvolutionEvent({
        event_type: "markov-auto-exec",
        summary: `MARKOV opp ${opp.id}: skipped — ${decision.reason}`,
        payload_json: JSON.stringify({
          opportunityId: opp.id,
          mode: VENUE,
          skipped: decision.reason,
          orderUsd: 0,
        }),
      });
      skipped++;
      continue;
    }

    const { order, sizing } = decision;

    try {
      const verdict = await router.submit(order);
      const ok = verdict.ok;
      const status = ok && "status" in verdict ? verdict.status : verdict.code;
      console.log(
        `[markov-exec] opp ${opp.id} → ${status} ${payload.side} @ ${payload.marketPrice.toFixed(3)} ` +
          `($${sizing.betUsd.toFixed(2)}, kelly=${(sizing.kelly * 100).toFixed(1)}%, pTrue=${sizing.pTrueUsed.toFixed(3)})`,
      );
      insertEvolutionEvent({
        event_type: "markov-auto-exec",
        summary:
          `MARKOV opp ${opp.id}: ${status} ${payload.side} ${(payload.title ?? payload.conditionId).slice(0, 24)} ` +
          `@ ${payload.marketPrice.toFixed(3)} ($${sizing.betUsd.toFixed(2)})`,
        payload_json: JSON.stringify({
          opportunityId: opp.id,
          mode: VENUE,
          orderUsd: sizing.betUsd,
          kelly: sizing.kelly,
          pTrueUsed: sizing.pTrueUsed,
          persistence: payload.persistence,
          calibratedProbYes: payload.calibratedProbYes,
          marketPrice: payload.marketPrice,
          side: payload.side,
          asset: payload.asset,
          durationKind: payload.durationKind,
          verdict: ok
            ? { status, brokerOrderId: "brokerOrderId" in verdict ? verdict.brokerOrderId : undefined }
            : { status, reason: verdict.reason },
        }),
      });
      executed++;
      remainingBudget -= sizing.betUsd;
    } catch (err) {
      console.error(`[markov-exec] opp ${opp.id} threw: ${(err as Error).message}`);
      insertEvolutionEvent({
        event_type: "markov-auto-exec",
        summary: `MARKOV opp ${opp.id} FAILED`,
        payload_json: JSON.stringify({ opportunityId: opp.id, error: (err as Error).message, orderUsd: 0 }),
      });
      executed++;
    }
  }
  return { checked: opps.length, executed, skipped, remainingBudget };
}

async function main(): Promise<void> {
  await pollOnce();
  let stopped = false;
  process.on("SIGINT", () => {
    stopped = true;
    console.log("[markov-exec] stopping (SIGINT)");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopped = true;
    process.exit(0);
  });
  while (!stopped) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      await pollOnce();
    } catch (e) {
      console.error("[markov-exec] poll error:", e);
    }
  }
}

if (process.argv[1]?.endsWith("worker-markov-persistence-exec.ts")) {
  main().catch((err) => {
    console.error("[markov-exec] FATAL:", err);
    process.exit(1);
  });
}
