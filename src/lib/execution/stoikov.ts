/**
 * Stoikov-style execution sizer.
 *
 * Daniro PRD §6: "The greater the inventory imbalance, the higher the
 * volatility, and the less time to expiry, the more aggressively the bot
 * adjusts its execution price." The original Avellaneda-Stoikov framework
 * computes an optimal quote skew from inventory + volatility + time-to-expiry;
 * this module ports the *intent* — a single aggressiveness scalar in [0, 1]
 * and a base-size multiplier — so any agent's decide() can size adaptively
 * without rewriting the order-emission layer.
 *
 * Aggressiveness rises monotonically with:
 *   • |inventory_imbalance|  → larger = more urgent (we want to flatten)
 *   • realized_volatility     → larger = more value at risk per second
 *   • inverse(time_to_expiry) → smaller window = more urgency to complete
 *
 * Size multiplier follows aggressiveness in the same direction — when the
 * book is screaming, the strategy commits more capital per leg (capped by
 * `max_size_multiplier` so it can't blow through the risk budget).
 *
 * Pure function, no IO. Safe to call from any decide() or sizing rail.
 */

export type StoikovInput = {
  /** Current inventory imbalance in [-1, 1].
   *   +1 = fully long this asset, fully exposed to UP
   *   -1 = fully short / fully exposed to DOWN
   *    0 = balanced */
  inventory_imbalance: number;
  /** Realized volatility of the underlying over a recent window, expressed as
   *  a fraction (0.01 = 1%). Higher = bot perceives more uncertainty. */
  realized_volatility: number;
  /** Time remaining until binary settlement, in seconds. */
  time_to_expiry_sec: number;
  /** Total window length in seconds (for the time-decay normalization). */
  window_length_sec: number;
  /** Operator-set base entry size in USD. The sizer multiplies this. */
  base_size_usd: number;
  /** Cap on the size multiplier so urgency can never blow the budget. */
  max_size_multiplier?: number;
  /** Stoikov gamma — risk aversion parameter. Higher = more conservative.
   *  Default 1.0 matches "balanced operator default". */
  gamma?: number;
};

export type StoikovOutput = {
  /** Composite aggressiveness in [0, 1]. UI-friendly scalar. */
  aggressiveness: number;
  /** Multiplier on base_size_usd. ≥ 1 when urgent, ≤ 1 when calm. */
  size_multiplier: number;
  /** Final suggested size in USD. */
  size_usd: number;
  /** Quote skew in fractional units. Positive = lift offer / hit bid harder
   *  (aggressive). Use to nudge entry-price targets toward the mid for
   *  faster fills, away when calm. */
  quote_skew: number;
  /** Per-component decomposition so the operator can see why aggressiveness
   *  is where it is — useful for debugging. */
  components: {
    inventory: number;
    volatility: number;
    time_decay: number;
  };
};

/** Map a raw scalar in [0, 1] to a size multiplier in [0.5, max_size_multiplier]
 *  via a smoothed step. At aggressiveness 0 → 0.5×; at 1 → max. */
function aggressivenessToSize(agg: number, max: number): number {
  const minMult = 0.5;
  const smooth = Math.pow(agg, 0.7);   // pulls mid-range toward the upper end
  return minMult + smooth * (max - minMult);
}

export function computeStoikov(input: StoikovInput): StoikovOutput {
  const inv = Math.abs(Math.max(-1, Math.min(1, input.inventory_imbalance)));
  const vol = Math.max(0, input.realized_volatility);
  const timeFrac = Math.max(0, Math.min(1, input.time_to_expiry_sec / Math.max(1, input.window_length_sec)));
  const decay = 1 - timeFrac;            // 0 at start, 1 at expiry
  const gamma = input.gamma ?? 1.0;
  const maxMult = input.max_size_multiplier ?? 2.0;

  // Saturate each component on its own scale, then weight them. Each
  // component is in [0, 1] before weighting.
  const cInventory  = Math.tanh(2 * inv);              // ≈ 0 when balanced, ≈ 1 when |inv| ≥ 0.7
  const cVolatility = Math.tanh(40 * vol);             // ≈ 1 when vol ≥ ~3% in window
  const cTimeDecay  = Math.tanh(3 * decay);            // ≈ 1 by ~70% through window

  // Weighted composite. Equal weights to start; can be tuned per genome later.
  const composite = (cInventory + cVolatility + cTimeDecay) / 3;
  // Apply gamma — higher risk aversion compresses the composite toward 0.
  const aggressiveness = Math.max(0, Math.min(1, composite / Math.max(0.1, gamma)));

  const sizeMult = aggressivenessToSize(aggressiveness, maxMult);
  const sizeUsd = input.base_size_usd * sizeMult;

  // Quote skew: at aggressiveness 1 we're willing to give up to 2% of the
  // mid to ensure fill; at 0 we keep a 25 bp passive cushion.
  const quoteSkew = -0.0025 + aggressiveness * 0.0225;

  return {
    aggressiveness,
    size_multiplier: sizeMult,
    size_usd: sizeUsd,
    quote_skew: quoteSkew,
    components: {
      inventory: cInventory,
      volatility: cVolatility,
      time_decay: cTimeDecay,
    },
  };
}

/** Convenience: compute realized vol from a closing-price series. Returns
 *  the standard deviation of log-returns × √(N) for the period N. */
export function realizedVolFromCloses(closes: number[]): number {
  if (closes.length < 3) return 0;
  const logRets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      logRets.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  if (logRets.length < 2) return 0;
  const mean = logRets.reduce((a, b) => a + b, 0) / logRets.length;
  const variance = logRets.reduce((a, b) => a + (b - mean) ** 2, 0) / logRets.length;
  return Math.sqrt(variance) * Math.sqrt(logRets.length);
}
