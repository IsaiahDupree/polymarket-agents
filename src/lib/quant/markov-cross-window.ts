/**
 * Cross-window pooled transition matrix.
 *
 * The single-market Markov filter (`markov-persistence-filter.ts`) needs a
 * well-observed transition matrix — the de1lymoon article's rule is
 * ≥20–30 transitions per occupied row. On short-lived markets like BTC 5m
 * Up/Down, a single market's own history (~5 minutes of price samples)
 * doesn't get anywhere close. The fix is to pool transition counts across
 * many resolved markets of the same asset + duration kind: each market
 * contributes its own observed transitions, the counts add, normalisation
 * happens once at the end.
 *
 * Importantly, transitions are counted **within each history independently**.
 * We never count a fake transition from the last sample of market A to the
 * first sample of market B — that would inject noise unrelated to the
 * dynamics we're trying to model.
 *
 * Pure functions only. No DB, no HTTP.
 */
import { priceToState, type TransitionMatrix } from "./markov";

/**
 * Sum transition counts across multiple price histories.
 *
 * Each history is processed independently — within-history pairs are
 * counted, cross-history pairs are not. Result is an integer count matrix
 * suitable for either inspection or pooled normalisation.
 *
 * @param priceHistories Array of price arrays. Each inner array is one
 *   market's continuous-price observations in time order.
 * @param nStates Number of price buckets.
 */
export function aggregateTransitions(
  priceHistories: number[][],
  nStates: number,
): number[][] {
  if (nStates < 2) throw new Error(`aggregateTransitions: nStates must be ≥ 2, got ${nStates}`);
  const counts: number[][] = Array.from({ length: nStates }, () => new Array<number>(nStates).fill(0));
  for (const prices of priceHistories) {
    if (!Array.isArray(prices) || prices.length < 2) continue;
    for (let i = 0; i < prices.length - 1; i++) {
      const from = priceToState(prices[i], nStates);
      const to = priceToState(prices[i + 1], nStates);
      counts[from][to]++;
    }
  }
  return counts;
}

/**
 * Build a row-stochastic transition matrix from a pool of price histories.
 *
 * Empty rows (states never observed leaving from across ALL pooled markets)
 * get an identity row — same convention as `buildTransitionMatrix` so
 * downstream Monte Carlo walks don't crash on a row of zeros.
 *
 * @returns nStates × nStates row-stochastic matrix
 */
export function buildPooledMatrix(
  priceHistories: number[][],
  nStates = 10,
): TransitionMatrix {
  const counts = aggregateTransitions(priceHistories, nStates);
  return counts.map((row, i) => {
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum === 0) {
      const id = new Array<number>(nStates).fill(0);
      id[i] = 1;
      return id;
    }
    return row.map((c) => c / sum);
  });
}

/**
 * Per-row observation count for the pooled matrix. Use this with the
 * existing `validateMatrix`-style threshold to refuse trading from
 * still-sparse rows (e.g. extreme states where the chain almost never
 * lives).
 */
export function pooledRowObservations(
  priceHistories: number[][],
  nStates: number,
): number[] {
  const counts = aggregateTransitions(priceHistories, nStates);
  return counts.map((row) => row.reduce((a, b) => a + b, 0));
}

/**
 * Total transitions counted across the pool. Useful in logs ("pooled 1284
 * transitions across 12 markets").
 */
export function pooledTotalTransitions(priceHistories: number[][]): number {
  return priceHistories.reduce(
    (acc, h) => acc + Math.max(0, (h?.length ?? 0) - 1),
    0,
  );
}
