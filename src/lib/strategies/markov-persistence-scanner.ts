/**
 * Markov persistence scanner — pure evaluator.
 *
 * Wraps the decision-only `markovPersistenceFilter` with a "market-shaped"
 * input + opportunity output, so the scanner runner script can stay thin.
 *
 * Inputs: a market snapshot (token id, condition id, expiry, current best
 * mid price) and its raw `pricesHistory` from the Polymarket CLOB. The
 * evaluator decides:
 *   - Are there enough history samples to even try? (refuse early)
 *   - What's `stepsToExpiry` given the history's fidelity? (1 sample = 1 step)
 *   - Does the filter say ENTER?
 *
 * Returns either a `MarkovOpportunity` (the runner serialises this into
 * `evolution_log.payload_json`) or `null` (with optional `passReason` for
 * diagnostics).
 *
 * Pure. No DB, no HTTP. The runner is the only thing that touches I/O.
 */
import {
  markovPersistenceFilter,
  markovPersistenceFilterCore,
  type MarkovFilterInput,
  type MarkovFilterVerdict,
} from "./markov-persistence-filter";
import {
  buildPooledMatrix,
  pooledRowObservations,
  pooledTotalTransitions,
} from "../quant/markov-cross-window";
import type { MatrixValidation } from "../quant/markov";

export type ScanMarket = {
  tokenId: string;
  conditionId: string;
  /** Question / title for logs + UI. */
  title?: string;
  /** Asset class (BTC/ETH/...) for filtering + reporting. */
  asset?: string;
  /** '5M' | '15M' | '1H' | etc. */
  durationKind?: string;
  /** Best mid price right now (the price the filter compares against). */
  currentPrice: number;
  /** ISO timestamp at which the binary settles. */
  expiryIso: string;
};

/**
 * One sample from `poly.pricesHistory(token_id, ...).history`.
 *   t: unix seconds, p: price (0..1)
 */
export type PriceSample = { t: number; p: number };

export type EvaluatorOptions = {
  /** Article default 0.87. Tune up to be stricter. */
  minPersistence?: number;
  /** Frozen-chain guard (default 0.99): refuse when persistence ≥ this. */
  maxPersistence?: number;
  /** Article default 0.05 (5%). */
  minEdge?: number;
  /** Article default 10. */
  nStates?: number;
  /** Article default 10000. Lower for tests. */
  nSims?: number;
  /** Articulated rule: ≥20–30 transitions per occupied row. */
  minObservationsPerRow?: number;
  /** Reject markets with fewer raw samples than this — saves an MC run. */
  minPriceSamples?: number;
  /** "now" override for deterministic tests. Defaults to Date.now(). */
  nowEpochSec?: number;
  /** Optional seeded RNG for tests. */
  rng?: () => number;
};

export type EvaluatorMode = "single" | "pooled";

export type MarkovOpportunity = {
  decision: "ENTER";
  /** Single-market history vs cross-window pool. */
  mode: EvaluatorMode;
  /** Number of histories pooled (1 in single mode). */
  pooledMarkets: number;
  /** Total transitions counted (sum across all pooled histories). */
  pooledTransitions: number;
  tokenId: string;
  conditionId: string;
  title?: string;
  asset?: string;
  durationKind?: string;
  side: "YES" | "NO";
  marketPrice: number;
  currentState: number;
  persistence: number;
  rawProbYes: number;
  calibratedProbYes: number;
  edge: number;
  /** Steps until settlement (1 step = 1 history sample). */
  stepsToExpiry: number;
  /** Inferred from the history's sample spacing (seconds). */
  inferredFidelitySec: number;
  expiryIso: string;
  /** How many history samples were used. */
  historySamples: number;
};

export type EvaluatorPass = {
  decision: "PASS";
  tokenId: string;
  conditionId: string;
  reason:
    | "too_few_samples"
    | "filter_frozen_chain"
    | "expired"
    | "filter_data_too_sparse"
    | "filter_persistence_below_threshold"
    | "filter_edge_below_threshold";
  marketPrice: number;
  /** Echo from the filter when available, for diagnostics. */
  persistence?: number;
  edge?: number;
};

export type EvaluatorResult = MarkovOpportunity | EvaluatorPass;

/**
 * Infer per-step seconds from the sample timestamps. Falls back to 60s
 * (article's default 1-minute steps) when timestamps are missing or
 * non-monotonic.
 */
export function inferFidelitySec(history: PriceSample[]): number {
  if (history.length < 2) return 60;
  // Use the median gap to avoid being skewed by occasional missing samples.
  const gaps: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const dt = history[i].t - history[i - 1].t;
    if (dt > 0) gaps.push(dt);
  }
  if (gaps.length === 0) return 60;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(1, Math.round(median));
}

export function evaluateMarket(
  market: ScanMarket,
  history: PriceSample[],
  opts: EvaluatorOptions = {},
): EvaluatorResult {
  const minSamples = opts.minPriceSamples ?? 30;
  const nStates = opts.nStates ?? 10;

  if (history.length < minSamples) {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason: "too_few_samples",
      marketPrice: market.currentPrice,
    };
  }

  // Time-to-expiry in steps (1 step = inferFidelitySec seconds).
  const fidelitySec = inferFidelitySec(history);
  const nowSec = opts.nowEpochSec ?? Math.floor(Date.now() / 1000);
  const expirySec = Math.floor(new Date(market.expiryIso).getTime() / 1000);
  const secondsLeft = expirySec - nowSec;
  const stepsToExpiry = Math.max(1, Math.floor(secondsLeft / fidelitySec));

  if (secondsLeft <= 0) {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason: "expired",
      marketPrice: market.currentPrice,
    };
  }

  const filterInput: MarkovFilterInput = {
    priceHistory: history.map((s) => s.p),
    currentPrice: market.currentPrice,
    daysToExpiry: stepsToExpiry, // "days" is a misnomer in markov.ts — it's really steps
    nStates,
    nSims: opts.nSims,
    minPersistence: opts.minPersistence,
    maxPersistence: opts.maxPersistence,
    minEdge: opts.minEdge,
    minObservationsPerRow: opts.minObservationsPerRow,
    rng: opts.rng,
  };

  const verdict: MarkovFilterVerdict = markovPersistenceFilter(filterInput);

  if (verdict.decision === "PASS") {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason:
        verdict.reason === "data_too_sparse"
          ? "filter_data_too_sparse"
          : verdict.reason === "persistence_below_threshold"
            ? "filter_persistence_below_threshold"
            : verdict.reason === "frozen_chain"
              ? "filter_frozen_chain"
              : "filter_edge_below_threshold",
      marketPrice: market.currentPrice,
      persistence: verdict.persistence,
      edge: verdict.edge,
    };
  }

  return {
    decision: "ENTER",
    mode: "single",
    pooledMarkets: 1,
    pooledTransitions: Math.max(0, history.length - 1),
    tokenId: market.tokenId,
    conditionId: market.conditionId,
    title: market.title,
    asset: market.asset,
    durationKind: market.durationKind,
    side: verdict.side,
    marketPrice: verdict.marketPrice,
    currentState: verdict.currentState,
    persistence: verdict.persistence,
    rawProbYes: verdict.rawProbYes,
    calibratedProbYes: verdict.calibratedProbYes,
    edge: verdict.edge,
    stepsToExpiry,
    inferredFidelitySec: fidelitySec,
    expiryIso: market.expiryIso,
    historySamples: history.length,
  };
}

/**
 * Cross-window pooled evaluator. Use this when the current market's own
 * history is too short to satisfy the article's ≥20-obs-per-row rule —
 * pool transition counts across `pooledHistories[]` (resolved-or-still-
 * trading same-asset same-duration markets) to densify the matrix.
 *
 * The current market's own history is used ONLY for:
 *   - Inferring the per-step time interval (so stepsToExpiry is correct)
 *   - The minimum-samples gate (still want the live market to have moved
 *     enough that we trust its current price)
 *
 * The actual transition probabilities come from the pooled set.
 */
export function evaluateMarketWithPool(
  market: ScanMarket,
  ownHistory: PriceSample[],
  pooledHistories: PriceSample[][],
  opts: EvaluatorOptions = {},
): EvaluatorResult {
  const minSamples = opts.minPriceSamples ?? 30;
  const nStates = opts.nStates ?? 10;
  const minObs = opts.minObservationsPerRow ?? 20;

  if (ownHistory.length < minSamples) {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason: "too_few_samples",
      marketPrice: market.currentPrice,
    };
  }

  const fidelitySec = inferFidelitySec(ownHistory);
  const nowSec = opts.nowEpochSec ?? Math.floor(Date.now() / 1000);
  const expirySec = Math.floor(new Date(market.expiryIso).getTime() / 1000);
  const secondsLeft = expirySec - nowSec;
  const stepsToExpiry = Math.max(1, Math.floor(secondsLeft / fidelitySec));
  if (secondsLeft <= 0) {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason: "expired",
      marketPrice: market.currentPrice,
    };
  }

  // Pool: own history + all supplied histories.
  const allPrices: number[][] = [ownHistory.map((s) => s.p), ...pooledHistories.map((h) => h.map((s) => s.p))];
  const T = buildPooledMatrix(allPrices, nStates);
  const rowObs = pooledRowObservations(allPrices, nStates);
  const sparseRows: number[] = [];
  const emptyRows: number[] = [];
  for (let i = 0; i < nStates; i++) {
    if (rowObs[i] === 0) emptyRows.push(i);
    else if (rowObs[i] < minObs) sparseRows.push(i);
  }
  const validation: MatrixValidation = {
    ok: sparseRows.length === 0 && emptyRows.length === 0,
    nStates,
    totalTransitions: pooledTotalTransitions(allPrices),
    rowObservations: rowObs,
    sparseRows,
    emptyRows,
  };

  const verdict: MarkovFilterVerdict = markovPersistenceFilterCore({
    matrix: T,
    validation,
    currentPrice: market.currentPrice,
    daysToExpiry: stepsToExpiry,
    nStates,
    nSims: opts.nSims,
    minPersistence: opts.minPersistence,
    maxPersistence: opts.maxPersistence,
    minEdge: opts.minEdge,
    rng: opts.rng,
  });

  if (verdict.decision === "PASS") {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason:
        verdict.reason === "data_too_sparse"
          ? "filter_data_too_sparse"
          : verdict.reason === "persistence_below_threshold"
            ? "filter_persistence_below_threshold"
            : verdict.reason === "frozen_chain"
              ? "filter_frozen_chain"
              : "filter_edge_below_threshold",
      marketPrice: market.currentPrice,
      persistence: verdict.persistence,
      edge: verdict.edge,
    };
  }

  return {
    decision: "ENTER",
    mode: "pooled",
    pooledMarkets: allPrices.length,
    pooledTransitions: validation.totalTransitions,
    tokenId: market.tokenId,
    conditionId: market.conditionId,
    title: market.title,
    asset: market.asset,
    durationKind: market.durationKind,
    side: verdict.side,
    marketPrice: verdict.marketPrice,
    currentState: verdict.currentState,
    persistence: verdict.persistence,
    rawProbYes: verdict.rawProbYes,
    calibratedProbYes: verdict.calibratedProbYes,
    edge: verdict.edge,
    stepsToExpiry,
    inferredFidelitySec: fidelitySec,
    expiryIso: market.expiryIso,
    historySamples: ownHistory.length,
  };
}
