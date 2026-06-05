#!/usr/bin/env tsx
/**
 * Quick operator CLI — print a coverage report of `api_call_cache` so we
 * can see how much Polymarket history we've recorded, broken down by
 * asset / recurrence / time-window. Run after a discovery cycle to
 * confirm the recorder is actually capturing what we expect.
 *
 *   npm run replay:cache-summary
 *   npm run replay:cache-summary -- --asset BTC --recurrence 5m
 *   npm run replay:cache-summary -- --from 2026-05-28T00:00:00Z
 */
import "./_env";
import { summarizeCacheCoverage } from "@/lib/backtest/cache-replay";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const r = summarizeCacheCoverage({
  asset: arg("--asset"),
  recurrence: arg("--recurrence"),
  fromIso: arg("--from"),
  toIso: arg("--to"),
  limit: arg("--limit") ? Number(arg("--limit")) : undefined,
});

console.log("================================================");
console.log("  api_call_cache coverage report");
console.log("================================================");
console.log(`  slugs matched     : ${r.matched}`);
console.log(`  total snapshots   : ${r.total_points}`);
console.log(`  assets seen       : ${r.unique_assets.join(", ") || "—"}`);
console.log(`  recurrences seen  : ${r.unique_recurrences.join(", ") || "—"}`);
console.log(`  first snapshot    : ${r.first_seen ?? "—"}`);
console.log(`  last snapshot     : ${r.last_seen ?? "—"}`);
console.log("");
console.log("  top trajectories (most recent):");
for (const t of r.trajectories) {
  const span =
    t.first_seen === t.last_seen
      ? "single point"
      : `${t.first_seen} → ${t.last_seen}`;
  console.log(`    ${t.slug.padEnd(40)} ${String(t.n_points).padStart(4)} pts   ${span}`);
}
