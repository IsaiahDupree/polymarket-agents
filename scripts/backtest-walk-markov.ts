#!/usr/bin/env tsx
/**
 * Run the time-walked Markov persistence backtest across cached
 * trajectories. Distinct from `replay:markov` which only evaluates the
 * LATEST tick. This walks each trajectory from minHistory forward and
 * records the first qualifying entry's P&L.
 *
 *   npm run backtest:walk-markov
 *   npm run backtest:walk-markov -- --asset BTC --min-history 8
 *   npm run backtest:walk-markov -- --json
 *   npm run backtest:walk-markov -- --per-asset    (run per-asset breakdown)
 */
import "./_env.ts";
import { walkAll } from "../src/lib/backtest/walk-markov.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function flag(n: string): boolean { return process.argv.includes(`--${n}`); }

const asset = arg("asset");
const recurrence = arg("recurrence");
const limit = arg("limit") ? Number(arg("limit")) : 500;
const minHistory = arg("min-history") ? Number(arg("min-history")) : 8;
const minPersistence = arg("min-persistence") ? Number(arg("min-persistence")) : 0.92;
const minEdge = arg("min-edge") ? Number(arg("min-edge")) : 0.03;
const minObsCurrentState = arg("min-obs-current-state") ? Number(arg("min-obs-current-state")) : 3;
const stakeUsd = arg("stake") ? Number(arg("stake")) : 2;
const jsonMode = flag("json");
const perAsset = flag("per-asset");

function runOne(opts: { asset?: string; recurrence?: string }) {
  return walkAll(
    { ...opts, limit },
    { minHistory, minPersistence, minEdge, stakeUsd, minObservationsCurrentState: minObsCurrentState },
  );
}

function printReport(label: string, r: ReturnType<typeof walkAll>): void {
  const a = r.aggregate;
  console.log(`\n══ ${label} ${"═".repeat(Math.max(0, 60 - label.length))}`);
  console.log(`  thresholds: minHistory=${minHistory} minPers=${minPersistence} minEdge=${minEdge} minObsCurState=${minObsCurrentState}`);
  console.log(`  total slugs cached  : ${a.totalSlugs}`);
  console.log(`  slugs considered    : ${a.slugsConsidered}     (≥ minHistory+1 points)`);
  console.log(`  entries fired       : ${a.slugsEntered}`);
  console.log(`  settled wins        : ${a.slugsWon}`);
  console.log(`  settled losses      : ${a.slugsLost}`);
  console.log(`  unsettled (MTM)     : ${a.slugsUnsettled}`);
  console.log(`  win rate (settled)  : ${(a.winRate * 100).toFixed(1)}%`);
  console.log(`  total stake         : $${a.totalStakeUsd.toFixed(2)}`);
  console.log(`  total P&L           : $${a.totalPnlUsd.toFixed(2)}`);
  console.log(`  mean P&L / entry    : $${a.meanPnlUsd.toFixed(2)}`);

  // Top 10 entries by abs(pnl).
  const sortedEntries = r.results
    .filter((x) => x.entry !== null)
    .sort((a, b) => Math.abs(b.entry!.pnlUsd) - Math.abs(a.entry!.pnlUsd))
    .slice(0, 10);
  if (sortedEntries.length > 0) {
    console.log(`\n  Top entries:`);
    console.log("    " + "slug".padEnd(40) + "side  entry   prob   edge   PnL    basis");
    console.log("    " + "─".repeat(85));
    for (const r of sortedEntries) {
      const e = r.entry!;
      console.log(
        "    " + e.slug.padEnd(40) +
        e.side.padEnd(6) +
        e.entryPrice.toFixed(3).padStart(5) + "  " +
        e.probYes.toFixed(3).padStart(5) + "  " +
        e.edge.toFixed(3).padStart(5) + "  " +
        (e.pnlUsd >= 0 ? "+" : "") + e.pnlUsd.toFixed(2).padStart(5) + "  " +
        e.pnlBasis,
      );
    }
  }
}

if (perAsset) {
  const allReports: Record<string, ReturnType<typeof walkAll>> = {};
  for (const a of ["BTC", "ETH", "SOL", "XRP", "DOGE"]) {
    allReports[a] = runOne({ asset: a, recurrence });
  }
  if (jsonMode) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(allReports)) out[k] = v.aggregate;
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const [k, v] of Object.entries(allReports)) printReport(`${k} ${recurrence ?? "all-recurrences"}`, v);
  }
} else {
  const r = runOne({ asset, recurrence });
  if (jsonMode) {
    console.log(JSON.stringify({ aggregate: r.aggregate, entries: r.results.filter((x) => x.entry !== null).map((x) => x.entry) }, null, 2));
  } else {
    printReport(`${asset ?? "all-assets"} ${recurrence ?? "all-recurrences"}`, r);
  }
}
