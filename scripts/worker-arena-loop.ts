/**
 * worker:arena-loop — fire arena:tick every N minutes forever.
 *
 * The arena tick is the canonical pulse: every alive elite agent gets to make
 * a decision against the current market state. Without this loop running,
 * agents accumulate ZERO live trades (which is the situation that motivated
 * the staged-stake PRD).
 *
 * Throttling:
 *   - Default cadence: 5 min between ticks
 *   - When today's trade count across the cohort exceeds DAILY_TRADE_TARGET
 *     (default 280), backs off to 10-min cadence so we don't overshoot
 *   - Resets at UTC midnight
 *
 * Usage:
 *   npm run worker:arena                       # forever, default 5min
 *   npm run worker:arena -- --interval-min 3   # custom cadence
 *   npm run worker:arena -- --once             # one tick and exit (smoke test)
 *
 * Logs each tick to stdout + writes a 'arena-loop-tick' evolution event so
 * the operator can see activity in /arena/training-campaigns or grep evo log.
 */
import "./_env.ts";
import { spawnSync } from "node:child_process";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { applyPreflightToGate, runPreflight } from "../src/lib/preflight.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const intervalMin = Math.max(1, Number(arg("interval-min", "5")));
const slowIntervalMin = Math.max(intervalMin, Number(arg("slow-interval-min", "10")));
const dailyTradeTarget = Math.max(10, Number(process.env.DAILY_TRADE_TARGET ?? "280"));
const runOnce = flag("once");

console.log(`[arena-loop] starting (interval=${intervalMin}min slow=${slowIntervalMin}min target=${dailyTradeTarget}/day once=${runOnce})`);

function todaysTradeCountAcrossCohort(): number {
  // Count rows in paper_trades created today (UTC) across the consistent-winner
  // cohort (v1+v2+v3 — keeps the throttle accurate as new cohorts are seeded).
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM paper_trades t
         JOIN paper_agents a ON a.id = t.paper_agent_id
        WHERE a.introduced_by IN (
                'consistent-winner-2026-05-30',
                'consistent-winner-v2-2026-05-30',
                'consistent-winner-v3-2026-05-30'
              )
          AND date(t.tick_at) = date('now')`,
    )
    .get() as { n: number };
  return row?.n ?? 0;
}

// F4: run preflight every PREFLIGHT_EVERY_TICKS arena-loop passes. The arena-loop
// runs every 5-10 min; 6 ticks = 30-60 min preflight cadence which matches the
// PRD requirement for in-session drift detection.
const PREFLIGHT_EVERY_TICKS = Math.max(1, Number(process.env.PREFLIGHT_EVERY_TICKS ?? "6"));
let ticksSincePreflight = PREFLIGHT_EVERY_TICKS; // run once on startup

function maybeRunPreflight(): void {
  ticksSincePreflight += 1;
  if (ticksSincePreflight < PREFLIGHT_EVERY_TICKS) return;
  ticksSincePreflight = 0;
  try {
    const result = runPreflight();
    const gate = applyPreflightToGate(result);
    if (result.level !== "pass") {
      console.log(`[arena-loop:preflight] ${result.level.toUpperCase()} — ${result.summary} | gate=${gate.state}`);
      for (const c of result.checks) {
        if (c.level !== "pass") console.log(`    ${c.level === "abort" ? "✗" : "⚠"} ${c.name}: ${c.message}`);
      }
    }
  } catch (err) {
    console.warn(`[arena-loop:preflight] failed: ${(err as Error).message.slice(0, 200)}`);
  }
}

function tick(): { trades: number; elapsedMs: number; err?: string } {
  const t0 = Date.now();
  // Run as a child process so a SQLite/genome crash doesn't take down the loop.
  // Captures stdout for the trade count.
  const result = spawnSync("npx", ["tsx", "scripts/arena-tick.ts"], {
    encoding: "utf-8",
    shell: true,
    timeout: 60_000,
  });
  const elapsedMs = Date.now() - t0;
  if (result.status !== 0) {
    return { trades: 0, elapsedMs, err: result.stderr?.slice(0, 200) ?? "non-zero exit" };
  }
  // Parse trade count from arena-tick stdout: "entries=X exits=Y holds=Z"
  const m = /entries=(\d+) exits=(\d+)/.exec(result.stdout);
  const trades = m ? Number(m[1]) + Number(m[2]) : 0;
  return { trades, elapsedMs };
}

function pass(): void {
  maybeRunPreflight();
  const todayCount = todaysTradeCountAcrossCohort();
  const overTarget = todayCount >= dailyTradeTarget;
  const r = tick();
  const ts = new Date().toISOString().slice(11, 19);
  if (r.err) {
    console.log(`[arena-loop] ${ts} TICK FAILED ${r.elapsedMs}ms: ${r.err}`);
  } else {
    console.log(
      `[arena-loop] ${ts} tick: trades=${r.trades} today_cohort=${todayCount}/${dailyTradeTarget}${overTarget ? " ⚠ over-target" : ""} elapsed=${r.elapsedMs}ms`,
    );
  }
  // Persist activity to evolution_log so /arena pages can show the loop is running.
  try {
    insertEvolutionEvent({
      event_type: "arena-loop-tick",
      summary: `arena-loop pass: ticked +${r.trades} trades, today_cohort=${todayCount}/${dailyTradeTarget}, elapsed=${r.elapsedMs}ms`,
      payload_json: JSON.stringify({
        cohort_trades_today: todayCount,
        target: dailyTradeTarget,
        over_target: overTarget,
        tick_trades: r.trades,
        elapsed_ms: r.elapsedMs,
      }),
    });
  } catch (err) {
    console.error(`[arena-loop] log err: ${(err as Error).message.slice(0, 120)}`);
  }
  // Throttle: when over target, slow down. nextDelay set by caller.
}

function nextDelayMs(): number {
  const todayCount = todaysTradeCountAcrossCohort();
  return (todayCount >= dailyTradeTarget ? slowIntervalMin : intervalMin) * 60_000;
}

async function main(): Promise<void> {
  pass();
  if (runOnce) return;
  while (true) {
    await new Promise((r) => setTimeout(r, nextDelayMs()));
    pass();
  }
}

process.on("SIGINT", () => { console.log("\n[arena-loop] SIGINT — stopping"); process.exit(0); });
process.on("unhandledRejection", (reason) => {
  console.error("[arena-loop] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
});

main().catch((err) => { console.error("[arena-loop] fatal:", (err as Error).message); process.exit(1); });
