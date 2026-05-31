/**
 * Markov transition matrix + Monte Carlo probability oracle for Polymarket
 * binary contracts.
 *
 * Source: @de1lymoon "How To Use Markov Chains To Win Every Single Trade"
 * (2026-05-26). Article saved at
 * docs/research/articles/de1lymoon-markov-chains-framework.md.
 *
 * Also the substrate for @0xRicker's Markov-persistence filter (article #2,
 * `p(j*,j*) ≥ 0.87` on BTC 5m) — the persistence threshold is a function
 * computed from this matrix, so the persistence filter consumes the same
 * `buildTransitionMatrix` output.
 *
 * ## The model in one paragraph
 *
 * A contract trades between 0¢ and 100¢. Discretize into N states (default
 * 10 buckets). Count how many times the price moved from each state to every
 * other state across a price history. Normalize each row to a probability
 * distribution. That's the transition matrix `T`. To estimate the probability
 * a market resolves YES from its current price, simulate `nSims` random walks
 * through `T` from the current state for `days` steps; the fraction of paths
 * ending above the midpoint is the raw probability.
 *
 * ## Things this module deliberately does NOT do
 *
 * - **It does not auto-fetch price history.** Caller supplies the array. This
 *   keeps the module pure (testable, no I/O, no API rate-limit concerns).
 * - **It does not auto-apply Becker calibration.** Callers wanting the
 *   crowd-bias-corrected number should pipe `monteCarlo()` output through
 *   `calibrateProbability()` from becker-calibration.ts. The convenience
 *   function `markovProbabilityYes()` does this automatically.
 * - **It does not enforce a minimum step count.** Caller decides. The article
 *   says "every state needs ≥20–30 observed transitions"; we surface that
 *   diagnostic via `validateMatrix()` but don't refuse to compute.
 * - **It is not seeded.** Tests that need determinism inject a custom RNG
 *   via the `rng` option of `monteCarlo()`.
 *
 * ## Performance note
 *
 * The article quotes "10,000 sims in 0.1s" using numpy. In pure JS, 10,000
 * sims × 30 days × ~10 states is ~3M random draws — under a second on any
 * modern machine. We do not pre-compute cumulative distributions per row;
 * the per-step cost is one linear scan of the row (up to nStates entries).
 * For larger matrices or many markets, switch to cumulative-distribution
 * inversion (O(log N) per step instead of O(N)).
 *
 * Pure functions only. No DB, no HTTP, no side effects.
 */

import { calibrateProbability } from "./becker-calibration";

export type TransitionMatrix = number[][];

export type MatrixValidation = {
  ok: boolean;
  /** Number of states (matrix is nStates × nStates). */
  nStates: number;
  /** Total transitions observed across all rows. */
  totalTransitions: number;
  /** Row-by-row count of observations. Sparse rows ≠ noise. */
  rowObservations: number[];
  /** Rows where observations < threshold (article rule: 20–30 minimum). */
  sparseRows: number[];
  /** Rows that were never visited — these get an identity row (state self-loop) as a fallback. */
  emptyRows: number[];
};

export type MonteCarloResult = {
  /** Fraction of simulated paths that ended ≥ midpoint state (raw probability YES). */
  probYes: number;
  /** Mean ending state (0..nStates-1). */
  meanFinalState: number;
  /** Final-state histogram counts (length nStates). */
  histogram: number[];
  /** Number of simulations actually executed. */
  nSims: number;
};

export type MarkovOracleResult = MonteCarloResult & {
  /** Becker-calibrated probability — what we'd actually expect to resolve YES. */
  calibratedProbYes: number;
  /** Current price implied by the input (state midpoint, for sanity vs market). */
  currentPriceMid: number;
  /** Validation diagnostic so callers can refuse on too-sparse data. */
  validation: MatrixValidation;
};

/**
 * Discretize a continuous price (0..1) into a state index (0..nStates-1).
 * Inputs outside [0, 1) are clamped. Exact 1.0 maps to the last state.
 */
export function priceToState(price: number, nStates: number): number {
  if (!Number.isFinite(price)) return Math.floor(nStates / 2);
  if (price <= 0) return 0;
  if (price >= 1) return nStates - 1;
  return Math.min(nStates - 1, Math.floor(price * nStates));
}

/**
 * Midpoint price of a given state. Inverse-ish of priceToState (returns
 * the centre of the bucket, not the edge).
 */
export function stateToMidPrice(state: number, nStates: number): number {
  return (state + 0.5) / nStates;
}

/**
 * Build a row-stochastic transition matrix from a price history.
 *
 * @param prices Continuous prices in [0,1]. Must have ≥ 2 entries; rows of
 *   the matrix correspond to states the chain was observed leaving from.
 * @param nStates Number of price buckets (article default 10).
 * @returns nStates × nStates matrix. Rows where no transitions were
 *   observed get an identity row (self-loop) so downstream MC walks
 *   never panic on a row of all zeros.
 */
export function buildTransitionMatrix(prices: number[], nStates = 10): TransitionMatrix {
  if (nStates < 2) throw new Error(`buildTransitionMatrix: nStates must be ≥ 2, got ${nStates}`);
  if (prices.length < 2) throw new Error(`buildTransitionMatrix: need ≥ 2 prices, got ${prices.length}`);

  // Count transitions.
  const counts: number[][] = Array.from({ length: nStates }, () => new Array<number>(nStates).fill(0));
  for (let i = 0; i < prices.length - 1; i++) {
    const from = priceToState(prices[i], nStates);
    const to = priceToState(prices[i + 1], nStates);
    counts[from][to]++;
  }

  // Normalize each row. Empty rows get an identity row so the chain has
  // somewhere defined to step (article assumption: if we've never seen a
  // state, treat it as a self-loop — the model has no information about it,
  // and the alternative — refusing to step — kills MC paths).
  const T: TransitionMatrix = counts.map((row, i) => {
    const sum = row.reduce((a, b) => a + b, 0);
    if (sum === 0) {
      const id = new Array<number>(nStates).fill(0);
      id[i] = 1;
      return id;
    }
    return row.map((c) => c / sum);
  });

  return T;
}

/**
 * Diagnostic: which rows are noisy (too few observations) or empty?
 * Article rule: ≥20–30 observed transitions per row before trusting that
 * row's probabilities. Caller decides what to do (refuse, widen the window,
 * merge sparse states).
 */
export function validateMatrix(
  T: TransitionMatrix,
  prices: number[],
  opts: { minObservationsPerRow?: number } = {},
): MatrixValidation {
  const threshold = opts.minObservationsPerRow ?? 20;
  const nStates = T.length;
  const counts = new Array<number>(nStates).fill(0);
  for (let i = 0; i < prices.length - 1; i++) {
    const from = priceToState(prices[i], nStates);
    counts[from]++;
  }
  const sparseRows: number[] = [];
  const emptyRows: number[] = [];
  for (let i = 0; i < nStates; i++) {
    if (counts[i] === 0) emptyRows.push(i);
    else if (counts[i] < threshold) sparseRows.push(i);
  }
  return {
    ok: sparseRows.length === 0 && emptyRows.length === 0,
    nStates,
    totalTransitions: prices.length - 1,
    rowObservations: counts,
    sparseRows,
    emptyRows,
  };
}

/**
 * Pick the next state given the current row of the transition matrix.
 * Uses a simple linear scan; suitable for nStates ≲ 50.
 */
function sampleRow(row: number[], u: number): number {
  let acc = 0;
  for (let j = 0; j < row.length; j++) {
    acc += row[j];
    if (u < acc) return j;
  }
  // Floating-point safety: u was 1.0 exactly or rounding undershot.
  return row.length - 1;
}

/**
 * Run nSims random walks of length `days` through the transition matrix
 * from `startState`. Returns the fraction landing at or above the
 * midpoint state at the end, plus diagnostics.
 *
 * @param rng Optional [0,1) generator. Defaults to Math.random. Tests inject
 *   a seeded generator for determinism.
 */
export function monteCarlo(
  T: TransitionMatrix,
  startState: number,
  days: number,
  opts: { nSims?: number; rng?: () => number } = {},
): MonteCarloResult {
  const nSims = opts.nSims ?? 10_000;
  const rng = opts.rng ?? Math.random;
  const nStates = T.length;
  const midpoint = Math.floor(nStates / 2);
  if (startState < 0 || startState >= nStates) {
    throw new Error(`monteCarlo: startState ${startState} outside [0, ${nStates})`);
  }
  if (days < 1) throw new Error(`monteCarlo: days must be ≥ 1, got ${days}`);

  const histogram = new Array<number>(nStates).fill(0);
  let yesCount = 0;
  let stateSum = 0;

  for (let s = 0; s < nSims; s++) {
    let state = startState;
    for (let d = 0; d < days; d++) {
      state = sampleRow(T[state], rng());
    }
    histogram[state]++;
    stateSum += state;
    if (state >= midpoint) yesCount++;
  }

  return {
    probYes: yesCount / nSims,
    meanFinalState: stateSum / nSims,
    histogram,
    nSims,
  };
}

/**
 * Top-level convenience: take a price history + current price + days to
 * expiry, return the Markov-MC probability AND the Becker-calibrated value
 * AND a matrix validation diagnostic — everything a strategy needs to
 * decide whether to act.
 *
 * Typical pattern in a strategy:
 *
 *   const oracle = markovProbabilityYes({
 *     priceHistory,
 *     currentPrice,
 *     daysToExpiry,
 *   });
 *   if (!oracle.validation.ok) return null;        // refuse on sparse data
 *   if (oracle.calibratedProbYes < marketPriceYes) return null; // no edge
 *   const edge = oracle.calibratedProbYes - marketPriceYes;
 *   // ... size with Kelly, submit via router with type=LIMIT (Becker gate).
 */
export function markovProbabilityYes(args: {
  priceHistory: number[];
  currentPrice: number;
  daysToExpiry: number;
  nStates?: number;
  nSims?: number;
  minObservationsPerRow?: number;
  rng?: () => number;
}): MarkovOracleResult {
  const nStates = args.nStates ?? 10;
  const T = buildTransitionMatrix(args.priceHistory, nStates);
  const validation = validateMatrix(T, args.priceHistory, {
    minObservationsPerRow: args.minObservationsPerRow,
  });
  const startState = priceToState(args.currentPrice, nStates);
  const mc = monteCarlo(T, startState, args.daysToExpiry, {
    nSims: args.nSims,
    rng: args.rng,
  });
  return {
    ...mc,
    calibratedProbYes: calibrateProbability(mc.probYes),
    currentPriceMid: stateToMidPrice(startState, nStates),
    validation,
  };
}

/**
 * Markov persistence: probability the chain stays in the same state on the
 * next step, evaluated at the current state. The Ricker article calls this
 * `p(j*, j*)` and gates BTC 5m trades on `p(j*,j*) ≥ 0.87`.
 *
 *   const T = buildTransitionMatrix(prices, 10);
 *   const j = priceToState(currentPrice, 10);
 *   const persistence = persistenceProbability(T, j); // p(j, j)
 *   if (persistence < 0.87) return null;              // Ricker filter
 */
export function persistenceProbability(T: TransitionMatrix, state: number): number {
  if (state < 0 || state >= T.length) return 0;
  return T[state][state];
}
