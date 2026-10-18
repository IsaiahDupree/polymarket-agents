/**
 * Hermes nightly review worker — @0xRicker article #2, Section 06.
 *
 *   npm run worker:nightly-review              # one-shot, no auto-update
 *   npm run worker:nightly-review -- --hours 24
 *
 * Reads the last N hours of `markov-auto-exec` rows from evolution_log,
 * runs the pure analysis module, and writes a `markov-threshold-proposal`
 * row. NEVER auto-updates the strategy spec — the operator reviews the
 * proposal on /opportunities or /settings and applies it manually if they
 * agree. This is the article's "self-learning loop" with the
 * dangerous-auto-update bit replaced by a human-in-the-loop gate.
 *
 * Wire into cron / scheduler:  e.g. `0 5 * * * npm run worker:nightly-review`
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import {
  buildNightlyReview,
  type CurrentThresholds,
  type ExecRow,
} from "../src/lib/agents/nightly-review.ts";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}
function flagNum(name: string, fallback: number): number {
  const v = flag(name);
  return v != null ? Number(v) : fallback;
}

const HOURS = flagNum("hours", 24);
const DRY_RUN = args.includes("--dry-run");

// Current thresholds — defaults match the article + filter module. In
// future these should be loaded from the strategy spec's current version.
const current: CurrentThresholds = {
  minPersistence: Number(process.env.MARKOV_MIN_PERSISTENCE ?? 0.87),
  maxPersistence: Number(process.env.MARKOV_MAX_PERSISTENCE ?? 0.99),
  minEdge: Number(process.env.MARKOV_MIN_EDGE ?? 0.05),
  kellyFraction: Number(process.env.MARKOV_KELLY_FRACTION ?? 0.25),
};

const handle = db();
const cutoff = new Date(Date.now() - HOURS * 3600_000).toISOString();

console.log(`[nightly-review] window: last ${HOURS}h (since ${cutoff})`);

const rawRows = handle
  .prepare(
    `SELECT id, payload_json, created_at FROM evolution_log
      WHERE event_type = 'markov-auto-exec'
        AND created_at >= ?
      ORDER BY created_at ASC`,
  )
  .all(cutoff) as Array<{ id: number; payload_json: string; created_at: string }>;

const rows: ExecRow[] = rawRows.map((r) => {
  let payload: any = {};
  try {
    payload = JSON.parse(r.payload_json);
  } catch {
    /* ignore — empty payload, treated as a no-op row */
  }
  return { id: r.id, createdAt: r.created_at, payload };
});

console.log(`[nightly-review] ${rows.length} markov-auto-exec rows in window`);
console.log(`[nightly-review] current thresholds:`, current);

const review = buildNightlyReview(rows, current);
console.log(`[nightly-review] outcome: ${review.outcome}`);
console.log(`[nightly-review] stats:`, review.stats);
console.log(`[nightly-review] proposed:`, review.proposed);
console.log(`[nightly-review] rationale: ${review.rationale}`);

if (!DRY_RUN) {
  insertEvolutionEvent({
    event_type: "markov-threshold-proposal",
    summary:
      `Hermes nightly review · ${review.outcome} · fill=${(review.stats.fillRate * 100).toFixed(0)}% (n=${review.stats.totalExecs})` +
      (Object.keys(review.proposed).length
        ? ` · proposed: ${Object.entries(review.proposed)
            .map(([k, v]) => `${k}=${Number(v).toFixed(3)}`)
            .join(" ")}`
        : ""),
    payload_json: JSON.stringify({
      hoursWindow: HOURS,
      current,
      proposed: review.proposed,
      outcome: review.outcome,
      rationale: review.rationale,
      stats: review.stats,
    }),
  });
  console.log(`[nightly-review] proposal logged as markov-threshold-proposal event.`);
  console.log(`[nightly-review] NOT auto-updating strategy spec — operator applies manually.`);
} else {
  console.log(`[nightly-review] DRY_RUN — proposal NOT persisted.`);
}
