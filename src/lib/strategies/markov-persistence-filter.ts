/**
 * Markov persistence filter — Ricker article #2 (@0xRicker, 2026-05-22).
 *
 * The rule (verbatim from the article):
 *
 *   Δ⁽ʷ⁾ = p̂⁽ʷ⁾ − q⁽ʷ⁾ ≥ ε   →   ENTER
 *   The bot only enters when p(j*, j*) ≥ 0.87 — the Markov persistence
 *   threshold. Below that, no trade.
 *
 * In plain English:
 *
 *   1. Build a transition matrix from recent price history.
 *   2. Look up the diagonal entry at the current state — `p(j*, j*)`.
 *   3. Only consider entering if that diagonal ≥ 0.87 (the chain is in
 *      a high-persistence state — the market is "committed").
 *   4. Compute the model's full-horizon probability via Monte Carlo.
 *   5. Only enter if `model_p - market_p ≥ MIN_EDGE` (default 5%).
 *
 * Article claims 63–72% win rate at this gate on BTC 5m markets. The
 * thresholds are tunable per the article (MIN_PROB, MIN_EDGE in .env).
 *
 * This module is **decision logic only** — pure function, no I/O. A
 * scanner script wraps it with live data and an executor wraps the
 * scanner output with router submit (subject to gate #6 maker-only —
 * use LIMIT orders since BTC 5m has 5-minute windows, not 5-second).
 *
 * Source files referenced here:
 *   - docs/research/articles/0xricker-hermes-btc-trading-agent.md
 *   - src/lib/quant/markov.ts (build / monte-carlo / persistence)
 *   - src/lib/quant/becker-calibration.ts (longshot-bias correction)
 *   - src/lib/quant/formulas.ts (Kelly sizing for downstream)
 */

import {
  buildTransitionMatrix,
  monteCarlo,
  persistenceProbability,
  priceToState,
  validateMatrix,
  type MatrixValidation,
  type TransitionMatrix,
} from "../quant/markov";
import { calibrateProbability } from "../quant/becker-calibration";

export type MarkovFilterInput = {
  /** Recent price history (continuous in [0,1]) for the contract. */
  priceHistory: number[];
  /** Current best-mid price (or the side the bot is considering). */
  currentPrice: number;
  /** Days (or step-equivalents) to expiry — drives MC walk length. */
  daysToExpiry: number;
  /** Number of price buckets. Default 10 (article default). */
  nStates?: number;
  /** Monte Carlo sims. Default 10000 (article default). */
  nSims?: number;
  /** Ricker's persistence threshold `p(j*,j*) ≥ ε`. Default 0.87. */
  minPersistence?: number;
  /** Upper-bound guard against frozen chains (T[j][j] ≥ this means the chain
   *  never moves → MC walk is a no-op → predicted probability is meaningless).
   *  Default 0.99. */
  maxPersistence?: number;
  /** Ricker's edge floor (model - market) ≥ ε. Default 0.05 (5%). */
  minEdge?: number;
  /** Minimum observed transitions per occupied row before trusting MC. */
  minObservationsPerRow?: number;
  /** Optional seeded RNG for reproducibility in tests. */
  rng?: () => number;
};

export type MarkovFilterVerdict =
  | {
      decision: "ENTER";
      side: "YES" | "NO";
      currentState: number;
      persistence: number;
      rawProbYes: number;
      calibratedProbYes: number;
      marketPrice: number;
      /** `calibratedProbYes - marketPrice` (positive → buy YES, negative → buy NO). */
      edge: number;
    }
  | {
      decision: "PASS";
      reason:
        | "data_too_sparse"
        | "persistence_below_threshold"
        | "frozen_chain"
        | "edge_below_threshold";
      currentState: number;
      persistence: number;
      rawProbYes?: number;
      calibratedProbYes?: number;
      marketPrice: number;
      edge?: number;
    };

/**
 * Pure decision function. Returns ENTER or PASS with the diagnostic that
 * shows why. Doesn't size positions — caller layers Kelly on top.
 */
export function markovPersistenceFilter(input: MarkovFilterInput): MarkovFilterVerdict {
  const nStates = input.nStates ?? 10;
  const T: TransitionMatrix = buildTransitionMatrix(input.priceHistory, nStates);
  const validation = validateMatrix(T, input.priceHistory, {
    minObservationsPerRow: input.minObservationsPerRow,
  });
  return markovPersistenceFilterCore({
    matrix: T,
    validation,
    currentPrice: input.currentPrice,
    daysToExpiry: input.daysToExpiry,
    nStates,
    nSims: input.nSims,
    minPersistence: input.minPersistence,
    maxPersistence: input.maxPersistence,
    minEdge: input.minEdge,
    rng: input.rng,
  });
}

/**
 * Inner core: operates on a pre-built matrix + validation result. Used by
 * `markovPersistenceFilter` (single-market case) AND by the cross-window
 * evaluator (which pools multiple markets' transitions into one matrix
 * before calling here).
 */
export type MarkovFilterCoreInput = {
  matrix: TransitionMatrix;
  validation: MatrixValidation;
  currentPrice: number;
  daysToExpiry: number;
  nStates: number;
  nSims?: number;
  minPersistence?: number;
  maxPersistence?: number;
  minEdge?: number;
  rng?: () => number;
};

export function markovPersistenceFilterCore(
  input: MarkovFilterCoreInput,
): MarkovFilterVerdict {
  const minPersistence = input.minPersistence ?? 0.87;
  const maxPersistence = input.maxPersistence ?? 0.99;
  const minEdge = input.minEdge ?? 0.05;
  const currentState = priceToState(input.currentPrice, input.nStates);
  const persistence = persistenceProbability(input.matrix, currentState);

  const currentRowSparse =
    input.validation.emptyRows.includes(currentState) ||
    input.validation.sparseRows.includes(currentState);
  if (currentRowSparse) {
    return {
      decision: "PASS",
      reason: "data_too_sparse",
      currentState,
      persistence,
      marketPrice: input.currentPrice,
    };
  }

  if (persistence < minPersistence) {
    return {
      decision: "PASS",
      reason: "persistence_below_threshold",
      currentState,
      persistence,
      marketPrice: input.currentPrice,
    };
  }

  // Frozen chain: persistence ≈ 1.0 means the matrix has no information
  // about transitions — every MC path starts AND ends at the same state.
  // The resulting "probability" is just a function of where the midpoint
  // cutoff lands relative to the current state, NOT a prediction. Refuse.
  if (persistence >= maxPersistence) {
    return {
      decision: "PASS",
      reason: "frozen_chain",
      currentState,
      persistence,
      marketPrice: input.currentPrice,
    };
  }

  const mc = monteCarlo(input.matrix, currentState, input.daysToExpiry, {
    nSims: input.nSims,
    rng: input.rng,
  });
  const calibratedProbYes = calibrateProbability(mc.probYes);
  const edge = calibratedProbYes - input.currentPrice;

  if (Math.abs(edge) < minEdge) {
    return {
      decision: "PASS",
      reason: "edge_below_threshold",
      currentState,
      persistence,
      rawProbYes: mc.probYes,
      calibratedProbYes,
      marketPrice: input.currentPrice,
      edge,
    };
  }

  return {
    decision: "ENTER",
    side: edge > 0 ? "YES" : "NO",
    currentState,
    persistence,
    rawProbYes: mc.probYes,
    calibratedProbYes,
    marketPrice: input.currentPrice,
    edge,
  };
}
