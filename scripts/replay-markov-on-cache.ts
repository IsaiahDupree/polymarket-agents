#!/usr/bin/env tsx
/**
 * Replay the Markov persistence strategy across cached binaries.
 *
 * For each recent cached slug, this:
 *   1. Reconstructs the YES-price trajectory from `api_call_cache`.
 *   2. Builds a transition matrix from the price history.
 *   3. Computes p(j*, j*) — the persistence probability at the current state.
 *   4. Runs a Monte Carlo simulation to estimate `probYes`.
 *   5. Compares against the YES market price → computes edge.
 *   6. Prints whether the strategy would have ENTERED (and which side).
 *
 * This is a paper trail of strategy decisions on historical state —
 * what the markov agents WOULD have done, given the data we've cached.
 *
 *   npm run replay:markov -- --limit 10
 *   npm run replay:markov -- --asset BTC --min-persistence 0.90 --min-edge 0.05
 *   npm run replay:markov -- --json    (machine-readable output)
 *
 * Defaults match the Ricker article: n_states=10, n_sims=10_000,
 * min_persistence=0.87, min_edge=0.03.
 */
import "./_env";
import { listCachedSlugs, replayCachedSlug } from "@/lib/backtest/cache-replay";
import {
  buildTransitionMatrix,
  priceToState,
  persistenceProbability,
  monteCarlo,
} from "@/lib/quant/markov";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(name);
}

const asset = arg("--asset");
const recurrence = arg("--recurrence");
const limit = arg("--limit") ? Number(arg("--limit")) : 20;
const nStates = arg("--n-states") ? Number(arg("--n-states")) : 10;
const nSims = arg("--n-sims") ? Number(arg("--n-sims")) : 10_000;
const minPersistence = arg("--min-persistence") ? Number(arg("--min-persistence")) : 0.87;
const minEdge = arg("--min-edge") ? Number(arg("--min-edge")) : 0.03;
const minHistory = arg("--min-history") ? Number(arg("--min-history")) : 15;
const jsonOut = flag("--json");

type Decision = {
  slug: string;
  n_points: number;
  current_yes_price: number | null;
  current_state: number | null;
  persistence: number | null;
  prob_yes: number | null;
  edge: number | null;
  side: "YES" | "NO" | "HOLD";
  reason: string;
};

const slugs = listCachedSlugs({ asset, recurrence, limit });
const decisions: Decision[] = [];

for (const s of slugs) {
  const t = replayCachedSlug(s.slug);
  if (!t) {
    decisions.push({
      slug: s.slug, n_points: 0, current_yes_price: null, current_state: null,
      persistence: null, prob_yes: null, edge: null, side: "HOLD",
      reason: "no trajectory",
    });
    continue;
  }
  const prices = t.points.map((p) => p.yesPrice).filter((x): x is number => x !== null);
  if (prices.length < minHistory) {
    decisions.push({
      slug: s.slug, n_points: t.points.length,
      current_yes_price: prices[prices.length - 1] ?? null,
      current_state: null, persistence: null, prob_yes: null, edge: null,
      side: "HOLD", reason: `insufficient history (${prices.length} < ${minHistory})`,
    });
    continue;
  }
  const currentPrice = prices[prices.length - 1];
  const T = buildTransitionMatrix(prices, nStates);
  const state = priceToState(currentPrice, nStates);
  const persistence = persistenceProbability(T, state);

  // Hold if not persistent enough.
  if (persistence < minPersistence) {
    decisions.push({
      slug: s.slug, n_points: t.points.length, current_yes_price: currentPrice,
      current_state: state, persistence, prob_yes: null, edge: null, side: "HOLD",
      reason: `persistence ${persistence.toFixed(3)} < ${minPersistence}`,
    });
    continue;
  }

  // Monte Carlo for YES probability. timeHorizon = 12 (Ricker default for 5m).
  const mc = monteCarlo(T, state, 12, { nSims });
  const edge = Math.abs(mc.probYes - currentPrice);
  if (edge < minEdge) {
    decisions.push({
      slug: s.slug, n_points: t.points.length, current_yes_price: currentPrice,
      current_state: state, persistence, prob_yes: mc.probYes, edge, side: "HOLD",
      reason: `edge ${edge.toFixed(3)} < ${minEdge}`,
    });
    continue;
  }

  const side: "YES" | "NO" = mc.probYes > currentPrice ? "YES" : "NO";
  decisions.push({
    slug: s.slug, n_points: t.points.length, current_yes_price: currentPrice,
    current_state: state, persistence, prob_yes: mc.probYes, edge, side,
    reason: `ENTRY: prob ${mc.probYes.toFixed(3)} vs market ${currentPrice.toFixed(3)}`,
  });
}

if (jsonOut) {
  console.log(JSON.stringify({ decisions }, null, 2));
} else {
  console.log("================================================");
  console.log("  Markov persistence replay across cached slugs");
  console.log("================================================");
  console.log(`  filters     : asset=${asset ?? "*"} recurrence=${recurrence ?? "*"} limit=${limit}`);
  console.log(`  thresholds  : persistence>=${minPersistence} edge>=${minEdge} min-history=${minHistory}`);
  console.log(`  monte carlo : n_states=${nStates} n_sims=${nSims}`);
  console.log("");
  const ENTRIES = decisions.filter((d) => d.side !== "HOLD");
  console.log(`  → ${ENTRIES.length}/${decisions.length} would enter`);
  console.log("");
  // Header
  console.log(
    "  slug".padEnd(42) +
    "pts".padStart(5) +
    "  yes_px".padStart(9) +
    "  pers".padStart(7) +
    "  prob_yes".padStart(11) +
    "  edge".padStart(8) +
    "  side".padStart(7) +
    "  reason",
  );
  console.log("  " + "─".repeat(110));
  for (const d of decisions) {
    const yesPx = d.current_yes_price === null ? "—" : d.current_yes_price.toFixed(3);
    const pers = d.persistence === null ? "—" : d.persistence.toFixed(3);
    const prob = d.prob_yes === null ? "—" : d.prob_yes.toFixed(3);
    const edge = d.edge === null ? "—" : d.edge.toFixed(3);
    console.log(
      "  " + d.slug.padEnd(40) +
      String(d.n_points).padStart(5) +
      yesPx.padStart(9) +
      pers.padStart(7) +
      prob.padStart(11) +
      edge.padStart(8) +
      d.side.padStart(7) +
      "  " + d.reason,
    );
  }
}
