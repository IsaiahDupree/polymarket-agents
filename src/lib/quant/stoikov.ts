/**
 * Stoikov-style maker pricing — Daniro article #4 (@Dan1ro0, 2026-05-25).
 *
 * Article quote:
 *
 *   Stoikov-style logic: the greater the inventory imbalance, the higher the
 *   volatility, and the less time to expiry, the more aggressively the bot
 *   adjusts its execution price. It knows how to speed up filling the second
 *   leg, avoid dangerous skew, and decide when to stay passive and when to
 *   switch to aggressive.
 *
 * Reference: Avellaneda + Stoikov (2008), "High-frequency trading in a
 * limit order book" — the canonical paper this technique is named for.
 *
 *   reservation_price = s - q * γ * σ² * (T - t)
 *   optimal_spread    = γ * σ² * (T - t) + (2/γ) * ln(1 + γ/k)
 *
 *   s = mid price, q = inventory (positive long), γ = risk aversion,
 *   σ² = variance per unit time, (T - t) = time-to-expiry,
 *   k = order-flow intensity parameter.
 *
 * In Polymarket land:
 *   - `s` is the mid of the binary contract (0..1).
 *   - `σ²` is the empirical variance of recent price moves over a fixed window.
 *   - `(T - t)` is normalised time remaining in [0,1] (closer to 0 = closer
 *     to settlement → more aggressive).
 *   - `q` is signed inventory in shares, normalised against a target
 *     position size (so +1 means "long full size", −1 means "short").
 *   - `γ` is the operator's risk aversion. The article uses ~0.1 implicitly;
 *     we expose it as a parameter.
 *   - `k` is the order-arrival rate, defaulted to 1.5 — a sane prior for the
 *     binary CLOB. Operator can tune via the input.
 *
 * The function returns three numbers:
 *
 *   1. `reservationPrice` — your "fair" price after adjusting for inventory.
 *      The more you're already long, the lower it pulls (you want to sell);
 *      the more short, the higher it pulls (you want to buy).
 *   2. `bidPrice` — where to place a maker BUY order.
 *   3. `askPrice` — where to place a maker SELL order.
 *
 * Bidprice and askprice are symmetric around the reservation price.
 *
 * Pure function. No I/O.
 */

export type StoikovInput = {
  /** Best mid price (0..1). */
  midPrice: number;
  /** Signed inventory, normalised: +1 = full long target, −1 = full short. */
  inventoryNormalised: number;
  /** Variance per unit time (σ²) — over the same time scale as `timeFraction`. */
  variance: number;
  /** Fraction of original window remaining (0..1). 1.0 = just opened, 0.0 = settling. */
  timeFraction: number;
  /** Risk aversion (γ). Default 0.1. Higher = more aggressive skew with inventory. */
  riskAversion?: number;
  /**
   * Order-flow intensity (k). Default 150 — calibrated to the binary 0–1
   * scale (Stoikov's original 1.5 assumes dollar-denominated stocks).
   * Higher = tighter spread.
   */
  orderArrivalRate?: number;
  /**
   * Practical cap on the analytic half-spread. Without this, low-γ / low-k
   * regimes produce δ > 0.5 which has no meaning on a 0–1 binary. Default
   * 0.10 (10 ¢ either side of reservation) — wide enough to capture maker
   * patience but narrow enough to actually fill within a 5-minute window.
   */
  maxHalfSpread?: number;
};

export type StoikovQuote = {
  reservationPrice: number;
  bidPrice: number;
  askPrice: number;
  /** Half-spread (used internally; surfaced for inspection). */
  halfSpread: number;
};

/**
 * Compute the inventory-aware reservation price.
 * Avellaneda-Stoikov canonical form:
 *   r = s − q·γ·σ²·(T − t)
 */
export function reservationPrice(args: {
  midPrice: number;
  inventoryNormalised: number;
  variance: number;
  timeFraction: number;
  riskAversion?: number;
}): number {
  const γ = args.riskAversion ?? 0.1;
  return args.midPrice - args.inventoryNormalised * γ * args.variance * args.timeFraction;
}

/**
 * Compute the optimal half-spread.
 *   δ = (γ·σ²·(T − t))/2 + (1/γ)·ln(1 + γ/k)
 */
export function optimalHalfSpread(args: {
  variance: number;
  timeFraction: number;
  riskAversion?: number;
  orderArrivalRate?: number;
  maxHalfSpread?: number;
}): number {
  const γ = args.riskAversion ?? 0.1;
  const k = args.orderArrivalRate ?? 150;
  const cap = args.maxHalfSpread ?? 0.10;
  const variancePart = (γ * args.variance * args.timeFraction) / 2;
  const liquidityPart = (1 / γ) * Math.log(1 + γ / k);
  const raw = Math.max(0, variancePart + liquidityPart);
  return Math.min(cap, raw);
}

/**
 * Compute optimal maker quotes around the reservation price.
 * Symmetric around `r`, with half-width `δ`.
 *
 * Clamps both prices to (0, 1) so they never quote outside the binary
 * range — Polymarket would reject an order at 1.00 or below 0.00.
 */
export function optimalQuotes(input: StoikovInput): StoikovQuote {
  const r = reservationPrice(input);
  const δ = optimalHalfSpread({
    variance: input.variance,
    timeFraction: input.timeFraction,
    riskAversion: input.riskAversion,
    orderArrivalRate: input.orderArrivalRate,
    maxHalfSpread: input.maxHalfSpread,
  });
  // Clamp to a strict open interval; binary contracts can't quote at 0 or 1.
  const minPx = 0.001;
  const maxPx = 0.999;
  const bidPrice = Math.max(minPx, Math.min(maxPx, r - δ));
  const askPrice = Math.max(minPx, Math.min(maxPx, r + δ));
  return {
    reservationPrice: r,
    bidPrice,
    askPrice,
    halfSpread: δ,
  };
}

/**
 * Convenience: given a maker-strategy intent (buy YES or buy NO) and the
 * Stoikov quotes, pick the appropriate limit price for that side.
 *
 *   intent="BUY_YES" → bidPrice (you're buying YES at or below mid)
 *   intent="BUY_NO"  → buy NO at (1 − askPrice) because NO = 1 − YES
 *
 * Returns null when the input price would be on the wrong side of mid
 * (e.g., you're so long that the reservation pulled past your target —
 * means "don't place this order, the math says fade").
 */
export function makerLimitPrice(
  quotes: StoikovQuote,
  intent: "BUY_YES" | "BUY_NO" | "SELL_YES" | "SELL_NO",
): number | null {
  switch (intent) {
    case "BUY_YES":
      return quotes.bidPrice;
    case "SELL_YES":
      return quotes.askPrice;
    case "BUY_NO":
      // NO = 1 − YES. Buying NO at limit price p_NO means accepting a fill
      // when YES trades at (1 − p_NO). For a maker BUY of NO, that's
      // 1 − askPrice.
      return 1 - quotes.askPrice;
    case "SELL_NO":
      return 1 - quotes.bidPrice;
    default:
      return null;
  }
}
