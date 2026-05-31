/**
 * worker:preflight — time-consistency + system-health watchdog.
 *
 * Runs the full preflight check (see src/lib/preflight.ts) on a periodic
 * cadence and manages the data/.trade-gate file. The operator's ask:
 * "know ahead of time if we get time errors."
 *
 * Behavior:
 *   - Default 30-min interval (matches the 30-min preflight cadence in PRD F4)
 *   - On abort: trade-gate goes CLOSED, exit code stays 0 (worker keeps
 *     ticking so it can REOPEN the gate after 3 consecutive passes)
 *   - On 3 consecutive passes: trade-gate goes OPEN
 *
 * Usage:
 *   npm run preflight                  # forever, 30-min cadence
 *   npm run preflight:once             # single pass, then exit
 *   npm run preflight -- --interval-min 5
 */
import "./_env.ts";
import { applyPreflightToGate, runPreflight, readTradeGate } from "../src/lib/preflight.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const intervalMin = Math.max(1, Number(arg("interval-min", "30")));
const runOnce = flag("once");

function pass(): void {
  const t0 = Date.now();
  const result = runPreflight();
  const gate = applyPreflightToGate(result);
  const elapsed = Date.now() - t0;
  const ts = new Date().toISOString().slice(11, 19);

  if (result.level === "pass") {
    console.log(`[preflight] ${ts} PASS — ${result.summary} | gate=${gate.state} | ${elapsed}ms`);
    return;
  }
  console.log(`[preflight] ${ts} ${result.level.toUpperCase()} — ${result.summary} | gate=${gate.state} | ${elapsed}ms`);
  for (const c of result.checks) {
    if (c.level !== "pass") console.log(`    ${c.level === "abort" ? "✗" : "⚠"} ${c.name}: ${c.message}`);
  }
}

console.log(`[preflight] starting (interval=${intervalMin}min once=${runOnce} initial-gate=${readTradeGate().state})`);
pass();

if (!runOnce) {
  setInterval(pass, intervalMin * 60_000);
  process.on("SIGINT", () => { console.log("\n[preflight] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error("[preflight] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
}
