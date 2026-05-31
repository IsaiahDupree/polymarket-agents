/**
 * Pure decision logic for the Markov persistence executor.
 *
 * Takes a logged `markov-persistence-opportunity` payload, plus the
 * remaining USD budget for the strategy and a per-signal cap, and
 * returns either a UnifiedOrder ready for `router.submit()` or a
 * structured skip-reason for the caller to log.
 *
 * Why this is a pure function (mirrors `markov-persistence-filter.ts`):
 *   - testable without spinning up the router, DB, or HTTP
 *   - the executor script becomes a thin loop around it
 *
 * Sizing: **quarter-Kelly** on the gap between the model's calibrated
 * probability and the market's implied probability — the math the
 * de1lymoon article spells out. Capped by per-signal cap and remaining
 * daily budget.
 *
 * Execution: **LIMIT order** priced at the entry mid the scanner saw.
 * This passes the maker-only router gate (Becker rule) without
 * `allowTaker`, and means we wait for a maker fill rather than crossing.
 */

import { kellyFraction } from "../quant/formulas";
import type { UnifiedOrder } from "@core/venue/types";

/** Shape of the JSON we serialise in scan-markov-persistence.ts. */
export type MarkovPersistencePayload = {
  decision: "ENTER";
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
  stepsToExpiry: number;
  inferredFidelitySec: number;
  expiryIso: string;
  historySamples: number;
  bucket?: string;
};

export type DecideOptions = {
  /** Opportunity event id (FK back to evolution_log). */
  opportunityId: number;
  /** Per-signal cap in USD. Default $25. */
  perSignalUsdCap?: number;
  /** Remaining USD budget for the day. The order is capped to this. */
  remainingBudgetUsd: number;
  /** Quarter-Kelly default (0.25 per article). */
  kellyFraction?: number;
  /** Max single-bet fraction of the per-signal cap (safety belt). Default 1.0. */
  maxFraction?: number;
  /** Venue: 'sim' for paper, 'polymarket' for live. */
  venue: "sim" | "polymarket";
  /** Capsule for risk accounting. */
  capsuleId?: string;
  /** Optional generator so tests can pin clientOrderId. Default randomUUID-ish. */
  coidSuffix: () => string;
  /** Optional minimum USD to bother submitting. Default $1. */
  minOrderUsd?: number;
};

export type DecideResult =
  | { kind: "submit"; order: UnifiedOrder; sizing: { betUsd: number; kelly: number; pTrueUsed: number } }
  | { kind: "skip"; reason: string };

export function decideOrder(
  payload: MarkovPersistencePayload,
  opts: DecideOptions,
): DecideResult {
  const perSignal = opts.perSignalUsdCap ?? 25;
  const minOrderUsd = opts.minOrderUsd ?? 1;
  const kellyLambda = opts.kellyFraction ?? 0.25;
  const maxFrac = opts.maxFraction ?? 1.0;

  // Convert the YES-centric oracle into the side-relative probability the
  // strategy is betting on. If the opportunity says BUY NO, our "pTrue" for
  // sizing is (1 - calibratedProbYes) and "pMarket" is (1 - marketPrice).
  const pTrueYes = payload.calibratedProbYes;
  const pMarketYes = payload.marketPrice;
  const pTrue = payload.side === "YES" ? pTrueYes : 1 - pTrueYes;
  const pMarket = payload.side === "YES" ? pMarketYes : 1 - pMarketYes;

  if (!(pTrue > pMarket)) {
    return {
      kind: "skip",
      reason: `pTrue ${pTrue.toFixed(3)} not > pMarket ${pMarket.toFixed(3)} for side ${payload.side}`,
    };
  }
  if (opts.remainingBudgetUsd <= 0) {
    return { kind: "skip", reason: "daily budget exhausted" };
  }

  // Quarter-Kelly on a bankroll equal to the per-signal cap. This gives a
  // per-signal bet sized by the EDGE (not just the cap).
  const kelly = kellyFraction({
    pTrue,
    pMarket,
    bankrollUsd: perSignal,
    fraction: kellyLambda,
    maxFraction: maxFrac,
  });

  // Cap to remaining daily budget. Kelly may already be the binding constraint.
  let betUsd = Math.min(kelly.betUsd, opts.remainingBudgetUsd);
  if (betUsd < minOrderUsd) {
    return {
      kind: "skip",
      reason: `bet ${betUsd.toFixed(2)} < min ${minOrderUsd}`,
    };
  }

  // Order is a LIMIT at the price the scanner saw — passes the maker-only
  // router gate without opt-in. If the market moves away before fill, the
  // order just sits resting; next scan cycle will resubmit if the edge
  // still exists.
  const limitPrice = payload.marketPrice;
  if (!(limitPrice > 0 && limitPrice < 1)) {
    return {
      kind: "skip",
      reason: `bad limit price ${limitPrice}`,
    };
  }

  // For NO-side trades, the order's `symbol` should be the NO token id, but
  // the payload may not include one in v1 (the scanner only knows YES token
  // ids from poly_binaries). For now, log the side and let the adapter
  // figure it out via metadata; if the adapter needs the NO token id
  // explicitly we'll surface it in v2.
  const order: UnifiedOrder = {
    clientOrderId: `markov-${opts.opportunityId}-${opts.coidSuffix()}`,
    venue: opts.venue,
    symbol: payload.tokenId,
    side: "BUY",
    type: "LIMIT",
    size: betUsd / limitPrice,
    refPrice: limitPrice,
    limitPrice,
    capsuleId: opts.capsuleId,
    metadata: {
      source: "markov-persistence-exec",
      opportunityId: opts.opportunityId,
      mpSide: payload.side,
      persistence: payload.persistence,
      calibratedProbYes: payload.calibratedProbYes,
      rawProbYes: payload.rawProbYes,
      currentState: payload.currentState,
      stepsToExpiry: payload.stepsToExpiry,
      asset: payload.asset,
      durationKind: payload.durationKind,
      kellyFraction: kelly.recommendedFraction,
      sizingPTrue: pTrue,
      sizingPMarket: pMarket,
      // No allowTaker — order is LIMIT, gate #6 passes naturally.
    },
  };

  return {
    kind: "submit",
    order,
    sizing: { betUsd, kelly: kelly.recommendedFraction, pTrueUsed: pTrue },
  };
}
