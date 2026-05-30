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
  // Count rows in paper_trades created today (UTC) across the consistent-winner cohort.
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM paper_trades t
         JOIN paper_agents a ON a.id = t.paper_agent_id
        WHERE a.introduced_by = 'consistent-winner-2026-05-30'
          AND date(t.tick_at) = date('now')`,
    )
    .get() as { n: number };
  return row?.n ?? 0;
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
