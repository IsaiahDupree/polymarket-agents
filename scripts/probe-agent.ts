/**
 * probe:agent — fast-fail health probe for a single paper_agent.
 *
 * Runs a 12-tick quick probe (under 30s typically) to detect inert agents
 * BEFORE committing to a full multi-day backtest that might hang for minutes
 * with zero output.
 *
 * Behavior:
 *   - Probe fires 12 ticks against current-time market data
 *   - If probe shows 0 entries → reports INACTIVE and exits 0
 *   - If probe shows ≥1 entry → optionally runs the full window
 *
 * Usage:
 *   npm run probe:agent -- --agent 3091
 *   npm run probe:agent -- --agent 3091 --full 14    # if probe non-zero, run full 14d
 *   npm run probe:agent -- --agent 3091 --full 14 --progress
 */
import "./_env.ts";
import { simulateAgentReplay, quickProbeAgent } from "../src/lib/arena/training.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const agentId = Number(arg("agent", "0"));
if (!agentId) {
  console.error("usage: npm run probe:agent -- --agent <id> [--full <days>] [--progress]");
  process.exit(2);
}
const fullDays = Number(arg("full", "0"));
const showProgress = flag("progress");

console.log(`[probe] agent #${agentId} — running 12-tick quick probe...`);
// Probe over the LAST HOUR so all 12 ticks land on near-current binaries.
// (Iterating from 3-days-ago made the probe see "current" binaries as 3-day-
// future events — the strategy's max_window_min filter rejected them every
// tick. With a 60-min window the ticks all see binaries that are 5-25 min
// from expiry, which is what `decide()` is built around.)
const tProbeStart = Date.now();
const probe = quickProbeAgent({
  agentId,
  fromIso: new Date(Date.now() - 60 * 60 * 1000).toISOString(),  // last 60 min
  toIso: new Date().toISOString(),
  tickIntervalMin: 5,
});
const probeMs = Date.now() - tProbeStart;

console.log(`[probe] ${probeMs}ms · entries=${probe.signals_emitted.entries} exits=${probe.signals_emitted.exits} holds=${probe.signals_emitted.holds} trades=${probe.trades_count} pnl=$${probe.pnl_usd.toFixed(2)}`);

if (probe.signals_emitted.entries === 0) {
  console.log(`[probe] INACTIVE — agent fires no entries in current conditions. Skipping full backtest.`);
  console.log(`        Likely causes: too-restrictive params, no matching binaries available, or genome kind that doesn't act on current asset.`);
  process.exit(0);
}

console.log(`[probe] ACTIVE — agent fires entries.`);

if (fullDays > 0) {
  console.log(`\n[probe] running full ${fullDays}-day backtest...`);
  const tFullStart = Date.now();
  const full = simulateAgentReplay({
    agentId,
    fromIso: new Date(Date.now() - fullDays * 86_400_000).toISOString(),
    toIso: new Date().toISOString(),
    tickIntervalMin: 5,
    equityCurveStride: 9999,
    onProgress: showProgress
      ? (s) => console.log(`  tick=${s.tick} entries=${s.entries} exits=${s.exits} holds=${s.holds} cash=$${s.cash.toFixed(0)} pos=${s.positions} elapsed=${(s.elapsedMs / 1000).toFixed(0)}s`)
      : undefined,
    progressEveryNTicks: 200,
  });
  const fullMs = Date.now() - tFullStart;
  console.log(`\n[probe] FULL: ${fullMs}ms (${(fullMs / 1000).toFixed(1)}s)`);
  console.log(`        pnl=$${full.pnl_usd.toFixed(2)} trades=${full.trades_count} wins=${full.wins_count} win%=${full.trades_count > 0 ? Math.round(full.win_rate * 100) : 0} max_dd=${(full.max_dd_pct * 100).toFixed(1)}%`);
}
