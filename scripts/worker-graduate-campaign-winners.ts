/**
 * worker:graduate-campaign-winners — runs the graduation-pass on a periodic
 * cadence. For each paper-staged capsule attached to a campaign-N tagged
 * agent, evaluates forward PnL and emits a `graduation-eligible` event when
 * thresholds clear. Operator still confirms live promotion manually.
 *
 * Usage:
 *   npm run worker:graduate            # default 30-min interval
 *   npm run worker:graduate -- --once  # run a single pass and exit
 *   npm run worker:graduate -- --interval-min 5  # custom cadence
 *
 * Thresholds via env (or defaults if unset):
 *   GRADUATION_MIN_PNL_USD  (10)  — lowered 2026-05-30 for staged-stake
 *   GRADUATION_MIN_TRADES   (15)
 *
 * Emits two evolution_log event types:
 *   - graduation-eligible (one per newly-eligible agent, deduped 24h)
 *   - factory-summary     (one per pass, even when zero new eligibilities)
 */
import "./_env.ts";
import { runGraduationPass } from "../src/lib/arena/graduation.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const intervalMin = Number(arg("interval-min", "30"));
const runOnce = flag("once");

function pass(): void {
  const t0 = Date.now();
  try {
    const res = runGraduationPass();
    const elapsed = Date.now() - t0;
    const top = res.candidates.slice(0, 5).map((c) => `#${c.paper_agent_id}=$${c.realized_pnl_usd.toFixed(2)}${c.eligible ? "✓" : ""}`).join(" ");
    console.log(
      `[graduate] ${res.ran_at} scanned=${res.scanned} eligible=${res.eligible} new=${res.newly_emitted} top=[${top}] ${elapsed}ms`,
    );
  } catch (err) {
    console.error(`[graduate] pass failed: ${(err as Error).message}`);
  }
}

console.log(`[graduate] starting (interval=${intervalMin}min, once=${runOnce})`);
pass();

if (!runOnce) {
  // Long-running: re-run every intervalMin minutes.
  setInterval(pass, intervalMin * 60_000);
  // Stay alive — Node exits when no handles remain, setInterval keeps one open.
  process.on("SIGINT", () => { console.log("\n[graduate] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error("[graduate] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
}
