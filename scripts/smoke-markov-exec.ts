/**
 * One-shot smoke test: inject a synthetic markov-persistence-opportunity,
 * run pollOnce, verify the audit row lands. Safe — defaults to sim venue.
 *
 * Remove after the executor is verified live.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { pollOnce } from "./worker-markov-persistence-exec.ts";

const handle = db();

console.log("[smoke] injecting synthetic opportunity");
insertEvolutionEvent({
  event_type: "markov-persistence-opportunity",
  summary: "SMOKE markov YES @ 0.55 → cal 0.82",
  payload_json: JSON.stringify({
    decision: "ENTER",
    tokenId: "SMOKE-TOK-1",
    conditionId: "SMOKE-COND-1",
    title: "Smoke test market",
    asset: "BTC",
    durationKind: "5M",
    side: "YES",
    marketPrice: 0.55,
    currentState: 5,
    persistence: 0.92,
    rawProbYes: 0.8,
    calibratedProbYes: 0.82,
    edge: 0.27,
    stepsToExpiry: 3,
    inferredFidelitySec: 60,
    expiryIso: new Date(Date.now() + 5 * 60_000).toISOString(),
    historySamples: 800,
    bucket: "SMOKE",
  }),
});

const before = (handle.prepare("SELECT COUNT(*) AS n FROM evolution_log WHERE event_type='markov-auto-exec'").get() as { n: number }).n;
console.log(`[smoke] pre-exec markov-auto-exec rows: ${before}`);

const r = await pollOnce();
console.log(`[smoke] pollOnce:`, r);

const after = (handle.prepare("SELECT COUNT(*) AS n FROM evolution_log WHERE event_type='markov-auto-exec'").get() as { n: number }).n;
const recent = handle.prepare("SELECT summary, payload_json FROM evolution_log WHERE event_type='markov-auto-exec' ORDER BY id DESC LIMIT 1").get() as { summary: string; payload_json: string } | undefined;
console.log(`[smoke] post-exec markov-auto-exec rows: ${after} (Δ ${after - before})`);
if (recent) {
  const p = JSON.parse(recent.payload_json);
  console.log(`[smoke] last row: ${recent.summary}`);
  console.log(`[smoke]   payload: orderUsd=${p.orderUsd}, mode=${p.mode}, verdict=${JSON.stringify(p.verdict ?? p.skipped ?? p.error)}`);
}
