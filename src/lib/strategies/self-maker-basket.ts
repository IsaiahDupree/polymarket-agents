/**
 * Self-maker basket arb scanner — pure decision logic.
 *
 * Strategy (article-faithful but achievable via the public CLOB API):
 *
 *   We post a LIMIT BUY on YES at price p_y and a LIMIT BUY on NO at
 *   price p_n. If both fill (someone sells us YES at p_y AND someone
 *   sells us NO at p_n), we own one YES + one NO. At resolution, exactly
 *   one of them pays $1. So we paid (p_y + p_n) for a guaranteed $1
 *   payout — net profit per pair = $1 − p_y − p_n − fees.
 *
 *   This is the same arithmetic as the complement-sum arb already
 *   implemented (`src/lib/strategies/complement-sum-arb.ts`), but applied
 *   to OUR OWN bids rather than the existing book. The difference matters:
 *   complement-sum scrapes opportunities that already exist on the book
 *   (which are usually filled in milliseconds by faster bots); self-maker
 *   CREATES the opportunity by posting bids that, if filled, lock in
 *   the basket.
 *
 *   Risks the decision logic explicitly considers:
 *     - Partial fill (one leg fills, the other doesn't) → directional
 *       exposure. Mitigated downstream by the AtomicArbExecutor contract
 *       (cancel-on-partial logic) OR by the rollback planner already
 *       shipped.
 *     - Adverse selection (the market moves before both legs fill) → the
 *       SIDE that didn't fill stays at the original price while the
 *       other side fills against bad info. Mitigated by tight expiration
 *       and a wide enough `targetEdge` to absorb a one-bucket move.
 *     - Capital tie-up vs the existing complement-sum scanner — every
 *       resting bid pair we maintain is capital that's not earning
 *       elsewhere. The decision logic surfaces an `expectedAnnualizedYield`
 *       so the operator can prioritise.
 *
 * Pure function. No I/O. The scanner script wraps this with the live
 * book fetcher; the executor wraps the opportunity with the order-post
 * path (gated on the contract being deployed + audited).
 */

export type BookLevel = {
  /** Price in [0, 1]. */
  price: number;
  /** USD-denominated depth at this level. */
  sizeUsd: number;
};

export type BinaryBookSnapshot = {
  conditionId: string;
  title?: string;
  /** Best bid (highest price someone wants to BUY YES). Sorted desc. */
  yesBids: BookLevel[];
  /** Best ask (lowest price someone wants to SELL YES). Sorted asc. */
  yesAsks: BookLevel[];
  /** Best bid on NO. */
  noBids: BookLevel[];
  /** Best ask on NO. */
  noAsks: BookLevel[];
  /** Epoch ms when the market settles. */
  windowCloseMs: number;
  /** Current epoch ms. */
  nowMs: number;
  /** Round-trip fee in basis points. Default 50 if not supplied. */
  feeBps?: number;
};

export type SelfMakerOptions = {
  /** Minimum target net edge per pair (USD), after fees. Default $0.02. */
  minNetEdgePerPair?: number;
  /** Minimum holdable days to expiry (avoids hyper-short markets where
   *  fill speed matters more than the strategy gives us). Default 0.01 (~15min). */
  minDaysToExpiry?: number;
  /** Tick size for our bid placement (default 0.01). */
  tickSize?: number;
  /** How tightly we undercut the best ask when placing our bid.
   *  0 = match best ask (won't fill), 1 = match best bid (instant fill but
   *  no edge). Default 0.5 = midpoint between bid and ask. */
  bidAggressivenessFraction?: number;
  /** Max USD per pair (caps our exposure). Default $25. */
  maxUsdPerPair?: number;
};

export type SelfMakerOpportunity = {
  conditionId: string;
  title?: string;
  yesBidPrice: number;
  noBidPrice: number;
  /** Our bids sum: yesBidPrice + noBidPrice. */
  combinedBidCost: number;
  /** $1 − combinedBidCost − fees. */
  netEdgePerPair: number;
  /** Number of YES+NO pairs we can build before exhausting either side's depth. */
  maxPairs: number;
  /** USD cost of building maxPairs pairs. */
  totalUsdCost: number;
  /** USD payoff of building maxPairs pairs (= maxPairs × $1). */
  guaranteedPayoutUsd: number;
  /** Total net profit. */
  netProfitUsd: number;
  /** Annualised yield assuming both bids fill at the day-bucket midpoint. */
  expectedAnnualizedYield: number;
  daysToExpiry: number;
};

const DEFAULTS = {
  minNetEdgePerPair: 0.02,
  minDaysToExpiry: 0.01,
  tickSize: 0.01,
  bidAggressivenessFraction: 0.5,
  maxUsdPerPair: 25,
  feeBps: 50,
};

/**
 * Compute our bid price for a side given the current best bid + ask.
 * We post BETWEEN the bid and ask, at the operator's aggressiveness level.
 */
export function deriveBidPrice(
  bestBid: number,
  bestAsk: number,
  tickSize: number,
  aggressivenessFraction: number,
): number {
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestAsk <= bestBid) {
    return Number.NaN;
  }
  const raw = bestBid + (bestAsk - bestBid) * aggressivenessFraction;
  // Snap to the tick grid.
  const ticks = Math.round(raw / tickSize);
  return Math.min(bestAsk - tickSize, Math.max(bestBid + tickSize, ticks * tickSize));
}

/**
 * Pure decision: does this book have a self-maker basket opportunity?
 */
export function detectSelfMakerOpportunity(
  book: BinaryBookSnapshot,
  opts: SelfMakerOptions = {},
): SelfMakerOpportunity | null {
  const minNetEdge = opts.minNetEdgePerPair ?? DEFAULTS.minNetEdgePerPair;
  const minDays = opts.minDaysToExpiry ?? DEFAULTS.minDaysToExpiry;
  const tick = opts.tickSize ?? DEFAULTS.tickSize;
  const aggr = opts.bidAggressivenessFraction ?? DEFAULTS.bidAggressivenessFraction;
  const maxUsd = opts.maxUsdPerPair ?? DEFAULTS.maxUsdPerPair;
  const feeBps = book.feeBps ?? DEFAULTS.feeBps;

  // Time check.
  const daysToExpiry = (book.windowCloseMs - book.nowMs) / 86_400_000;
  if (!(daysToExpiry > minDays)) return null;

  // Need at least one level on each side.
  const yesBid = book.yesBids[0]?.price;
  const yesAsk = book.yesAsks[0]?.price;
  const noBid = book.noBids[0]?.price;
  const noAsk = book.noAsks[0]?.price;
  if (!Number.isFinite(yesBid) || !Number.isFinite(yesAsk) || !Number.isFinite(noBid) || !Number.isFinite(noAsk)) {
    return null;
  }
  if (yesBid <= 0 || yesAsk >= 1 || noBid <= 0 || noAsk >= 1) return null;

  // Derive our bid prices.
  const ourYesBid = deriveBidPrice(yesBid, yesAsk, tick, aggr);
  const ourNoBid = deriveBidPrice(noBid, noAsk, tick, aggr);
  if (!Number.isFinite(ourYesBid) || !Number.isFinite(ourNoBid)) return null;

  const combinedBidCost = ourYesBid + ourNoBid;
  // Net edge per pair = $1 − sum − fees (fees apply twice: one per leg).
  const feeUsd = (combinedBidCost * feeBps) / 10_000; // approx — fees are on filled notional
  const netEdgePerPair = 1 - combinedBidCost - feeUsd;
  if (netEdgePerPair < minNetEdge) return null;

  // Sizing: capped by min of (yes-side depth at our price level, no-side depth).
  // Since we're POSTING bids, we don't actually need depth ABOVE our price —
  // we need someone to be willing to sell to us at our price. Use available
  // depth at the current best ask as a rough proxy for fillable size.
  const yesFillableUsd = Math.min(book.yesAsks[0]?.sizeUsd ?? 0, maxUsd);
  const noFillableUsd = Math.min(book.noAsks[0]?.sizeUsd ?? 0, maxUsd);
  const fillableUsd = Math.min(yesFillableUsd, noFillableUsd);
  if (fillableUsd <= 0) return null;

  // Pairs we can build = fillableUsd / max(ourYesBid, ourNoBid). Pessimistic.
  const dollarsPerPair = combinedBidCost;
  if (dollarsPerPair <= 0) return null;
  const maxPairsByCap = Math.floor(fillableUsd / Math.max(ourYesBid, ourNoBid));
  const maxPairs = Math.max(1, maxPairsByCap);

  const totalUsdCost = maxPairs * dollarsPerPair;
  const guaranteedPayoutUsd = maxPairs * 1; // each pair pays $1
  const netProfitUsd = guaranteedPayoutUsd - totalUsdCost - maxPairs * feeUsd;

  // Annualised yield = (net profit / cost) × (365 / days).
  const expectedAnnualizedYield =
    totalUsdCost > 0 && daysToExpiry > 0
      ? (netProfitUsd / totalUsdCost) * (365 / daysToExpiry)
      : 0;

  return {
    conditionId: book.conditionId,
    title: book.title,
    yesBidPrice: ourYesBid,
    noBidPrice: ourNoBid,
    combinedBidCost,
    netEdgePerPair,
    maxPairs,
    totalUsdCost,
    guaranteedPayoutUsd,
    netProfitUsd,
    expectedAnnualizedYield,
    daysToExpiry,
  };
}
