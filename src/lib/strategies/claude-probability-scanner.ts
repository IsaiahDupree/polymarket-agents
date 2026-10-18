/**
 * Claude probability strategy — Lunar article #3.
 *
 * The Lunar article's "20-line Claude brain" is the probability source.
 * This module wraps it with the same opportunity-evaluator pattern used
 * by Markov persistence (decision-only, pure):
 *
 *   1. Reject if the brain returned low confidence.
 *   2. Run the brain's probability through the Becker calibration table
 *      (de1lymoon article) — the brain doesn't know about Polymarket's
 *      crowd longshot bias, but the calibration corrects for it.
 *   3. Compute edge vs the market price.
 *   4. Optionally enforce a minimum probability gap (default 5%).
 *   5. Emit ENTER on the YES or NO side, or PASS with a structured reason.
 *
 * Pure. The runner script (`scripts/scan-claude-probability.ts`) does the
 * LLM call + market fetch.
 */
import { calibrateProbability } from "../quant/becker-calibration";
import type { ProbabilityVerdict } from "../agents/probability-brain";

export type ClaudeProbMarket = {
  /** YES token id. */
  tokenId: string;
  /** Polymarket condition id. */
  conditionId: string;
  /** Question text. */
  title: string;
  /** Best mid price (0..1). */
  currentPrice: number;
  /** ISO timestamp at which resolution closes. */
  expiryIso?: string;
  /** Asset tag if known (BTC/ETH/...). */
  asset?: string;
  /** Category tag if known. */
  category?: string;
};

export type ClaudeProbOptions = {
  /** Minimum edge between calibrated_prob and market_price. Default 0.05 (5%). */
  minEdge?: number;
  /** Confidence floor: "medium" by default. Set to "low" to allow low-conf signals through. */
  minConfidence?: "high" | "medium" | "low";
};

export type ClaudeProbOpportunity = {
  decision: "ENTER";
  tokenId: string;
  conditionId: string;
  title: string;
  asset?: string;
  category?: string;
  side: "YES" | "NO";
  marketPrice: number;
  /** Brain's raw probability output. */
  rawProbYes: number;
  /** After Becker calibration. */
  calibratedProbYes: number;
  /** `calibratedProbYes - marketPrice`. Positive → BUY YES. */
  edge: number;
  confidence: "high" | "medium" | "low";
  rationale?: string;
  model: string;
};

export type ClaudeProbPass = {
  decision: "PASS";
  tokenId: string;
  conditionId: string;
  reason: "low_confidence" | "edge_below_threshold" | "bad_market_price";
  marketPrice: number;
  rawProbYes?: number;
  calibratedProbYes?: number;
  confidence?: "high" | "medium" | "low";
  edge?: number;
};

export type ClaudeProbResult = ClaudeProbOpportunity | ClaudeProbPass;

const CONFIDENCE_RANK: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };

export function evaluateMarketWithClaude(
  market: ClaudeProbMarket,
  verdict: ProbabilityVerdict,
  opts: ClaudeProbOptions = {},
): ClaudeProbResult {
  const minEdge = opts.minEdge ?? 0.05;
  const minConfidence = opts.minConfidence ?? "medium";

  if (!(market.currentPrice > 0 && market.currentPrice < 1)) {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason: "bad_market_price",
      marketPrice: market.currentPrice,
    };
  }

  if (CONFIDENCE_RANK[verdict.confidence] < CONFIDENCE_RANK[minConfidence]) {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason: "low_confidence",
      marketPrice: market.currentPrice,
      rawProbYes: verdict.probability,
      confidence: verdict.confidence,
    };
  }

  const calibratedProbYes = calibrateProbability(verdict.probability);
  const edge = calibratedProbYes - market.currentPrice;
  if (Math.abs(edge) < minEdge) {
    return {
      decision: "PASS",
      tokenId: market.tokenId,
      conditionId: market.conditionId,
      reason: "edge_below_threshold",
      marketPrice: market.currentPrice,
      rawProbYes: verdict.probability,
      calibratedProbYes,
      confidence: verdict.confidence,
      edge,
    };
  }

  return {
    decision: "ENTER",
    tokenId: market.tokenId,
    conditionId: market.conditionId,
    title: market.title,
    asset: market.asset,
    category: market.category,
    side: edge > 0 ? "YES" : "NO",
    marketPrice: market.currentPrice,
    rawProbYes: verdict.probability,
    calibratedProbYes,
    edge,
    confidence: verdict.confidence,
    rationale: verdict.rationale,
    model: verdict.model,
  };
}
