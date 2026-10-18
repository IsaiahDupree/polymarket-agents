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
import { optimalQuotes, makerLimitPrice } from "../quant/stoikov";
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

export type ExecMode = "naive" | "stoikov";

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
  /**
   * Pricing mode:
   *   - 'naive' (default): limit at the market price the scanner saw
   *   - 'stoikov': inventory-aware Avellaneda-Stoikov maker quote (Daniro article)
   */
  execMode?: ExecMode;
  /** Current normalised inventory in this market (−1 to +1). Only used in stoikov mode. */
  inventoryNormalised?: number;
  /** Variance of recent price moves. Only used in stoikov mode. */
  variance?: number;
  /** Time-fraction remaining (0..1). Only used in stoikov mode. */
  timeFraction?: number;
  /** Stoikov γ (risk aversion). Default 0.1. */
  riskAversion?: number;
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

  // Order is a LIMIT at either the scanner's mid (naive mode) or a Stoikov
  // inventory-aware maker quote (Daniro article). Both pass the maker-only
  // router gate without opt-in. If the market moves away before fill, the
  // order just sits resting; next scan cycle will resubmit if the edge
  // still exists.
  let limitPrice: number;
  const execMode: ExecMode = opts.execMode ?? "naive";
  if (execMode === "stoikov") {
    const quotes = optimalQuotes({
      midPrice: payload.marketPrice,
      inventoryNormalised: opts.inventoryNormalised ?? 0,
      variance: opts.variance ?? 0.01,
      timeFraction: opts.timeFraction ?? Math.max(0.05, Math.min(1, payload.stepsToExpiry / 60)),
      riskAversion: opts.riskAversion ?? 0.1,
    });
    // Map side → limit price via the maker convention. We're always BUYing
    // on the YES token (article: BUY_YES) or BUYing on the YES token at a
    // (1 − NO_ask) effective price for a "BUY NO" intent.
    const intent: "BUY_YES" | "BUY_NO" = payload.side === "YES" ? "BUY_YES" : "BUY_NO";
    const px = makerLimitPrice(quotes, intent);
    if (px == null) {
      return { kind: "skip", reason: "stoikov: no maker quote available" };
    }
    limitPrice = px;
  } else {
    limitPrice = payload.marketPrice;
  }
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
      execMode,
      ...(execMode === "stoikov"
        ? {
            stoikovInventoryNormalised: opts.inventoryNormalised ?? 0,
            stoikovVariance: opts.variance ?? 0.01,
            stoikovTimeFraction: opts.timeFraction,
            stoikovRiskAversion: opts.riskAversion ?? 0.1,
          }
        : {}),
      // No allowTaker — order is LIMIT, gate #6 passes naturally.
    },
  };

  return {
    kind: "submit",
    order,
    sizing: { betUsd, kelly: kelly.recommendedFraction, pTrueUsed: pTrue },
  };
}
