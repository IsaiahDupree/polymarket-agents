/**
 * Polymarket microstructure helpers — TypeScript port of
 * polymarket-2dollar-bot/polybot/microstructure.py.
 *
 * Each helper is a PURE function (no DB, no HTTP). Strategies call them
 * with already-loaded data; the helpers return either a discriminated
 * {kind: "skip"} / {kind: "opportunity"} result or a primitive number.
 *
 * Coverage (mirrors the Python source 1:1):
 *
 *   1. arbitrageEdge        — buy YES + NO when their asks sum < $1 (risk-free)
 *   2. directionalArbTilt   — arb base + model view → tilt to one side
 *   3. nearResolutionEdge   — late-window almost-certain side at 0.95-0.99
 *   4. orderbookImbalance   — top-N depth skew, [-1, 1]
 *   5. repricingEdge        — fair-value vs market gap → directional bet
 *
 * Reference docs:
 *   - polymarket-2dollar-bot/polybot/microstructure.py (source of truth)
 *   - HFT/docs/strategies/microstructure-signals.md §2.3 (OFI formal)
 *   - HFT/docs/strategies/event-driven.md §2.6 (near-resolution scrape)
 */

export type Opportunity = {
  /** Discriminator for callers that want to switch on edge type. */
  kind: "arbitrage" | "near_resolution" | "imbalance" | "repricing";
  side: "YES" | "NO" | "BOTH";
  /** Expected profit per $1 of cost (locked) or per $1 of stake (directional). */
  edge: number;
  /** Human-readable explanation for the rationale field on Signal. */
  detail: string;
  /** Side-channel meta for logging / debugging. Shape varies by kind. */
  meta: Record<string, number | string>;
};

// ---------------------------------------------------------------------------
// 1. Pure arbitrage (BOTH sides for < $1)

/**
 * If YES_ask + NO_ask + fees < $1, you can buy both, one settles at $1 →
 * risk-free locked profit. Returns the per-$1 edge when profitable.
 *
 * Fees in basis points (1 bp = 0.01 %). Default 0 — the caller knows
 * Polymarket's fee schedule better than this helper.
 */
export function arbitrageEdge(
  yesAsk: number,
  noAsk: number,
  feeBps = 0,
  minEdge = 0.005,
): Opportunity | null {
  if (!(yesAsk > 0 && yesAsk < 1)) return null;
  if (!(noAsk > 0 && noAsk < 1)) return null;
  const cost = yesAsk + noAsk;
  const fee = cost * (feeBps / 10_000);
  const profit = 1 - cost - fee;
  if (profit <= 0) return null;
  const edge = profit / cost;
  if (edge < minEdge) return null;
  return {
    kind: "arbitrage",
    side: "BOTH",
    edge,
    detail: `YES ${yesAsk.toFixed(3)} + NO ${noAsk.toFixed(3)} = ${cost.toFixed(3)} < 1 → +${profit.toFixed(3)}/set`,
    meta: { yes_ask: yesAsk, no_ask: noAsk, cost, profit_per_set: profit },
  };
}

/**
 * Arb base present AND a model view → tilt toward the under-priced side
 * while the set keeps risk bounded. Returns null when no arb is present.
 */
export function directionalArbTilt(
  yesAsk: number,
  noAsk: number,
  modelPYes: number,
  feeBps = 0,
): Opportunity | null {
  const arb = arbitrageEdge(yesAsk, noAsk, feeBps, /* minEdge */ 0);
  if (!arb) return null;
  const tilt: "YES" | "NO" = modelPYes > yesAsk ? "YES" : "NO";
  return {
    kind: "arbitrage",
    side: tilt,
    edge: arb.edge,
    detail: `arb set +${(arb.meta.profit_per_set as number).toFixed(3)}, tilt ${tilt} (model ${modelPYes.toFixed(2)})`,
    meta: { ...arb.meta, model_p_yes: modelPYes, tilt },
  };
}

// ---------------------------------------------------------------------------
// 2. Near-resolution scrape

/**
 * Late in a market, a near-certain side may still trade at 0.95-0.99
 * instead of 1.00. Buying it is high-win-rate / small-reward (the
 * "$2 → ~$0.30" profile). Gated on being close to resolution to bound
 * tail risk. seconds_to_resolution is the count down to expiry.
 */
export function nearResolutionEdge(
  winningPrice: number,
  secondsToResolution: number,
  opts: { minPrice?: number; maxPrice?: number; maxSeconds?: number } = {},
): Opportunity | null {
  const minPrice = opts.minPrice ?? 0.95;
  const maxPrice = opts.maxPrice ?? 0.995;
  const maxSeconds = opts.maxSeconds ?? 120;
  if (secondsToResolution > maxSeconds) return null;
  if (!(winningPrice >= minPrice && winningPrice <= maxPrice)) return null;
  const reward = (1 - winningPrice) / winningPrice;
  return {
    kind: "near_resolution",
    side: "YES",
    edge: reward,
    detail: `side at ${winningPrice.toFixed(3)}, ${secondsToResolution.toFixed(0)}s left → +${(reward * 100).toFixed(1)}%`,
    meta: { price: winningPrice, seconds_left: secondsToResolution, reward_per_dollar: reward },
  };
}

// ---------------------------------------------------------------------------
// 3. Order-book imbalance (signal, not a standalone strategy)

export type OrderBookLevel = { price?: number; size: number };

/**
 * Normalized order-flow imbalance in [-1, 1] over the top `depth` levels.
 * > 0 → bid-heavy (buy pressure); < 0 → ask-heavy. A lag / repricing signal.
 *
 *   bid_sz = Σ sizes of top-N bid levels
 *   ask_sz = Σ sizes of top-N ask levels
 *   OBI = (bid_sz − ask_sz) / (bid_sz + ask_sz)
 *
 * This is OBI (snapshot), not OFI (event-driven). The HFT
 * microstructure-signals.md doc §2.3 explains the distinction: OBI tells
 * you what the book LOOKS LIKE; OFI tells you HOW IT'S CHANGING. We
 * implement OBI here because PolymarketAutomation's snapshot store is
 * snapshot-based; OFI would need L2 event streaming we don't have yet.
 */
export function orderbookImbalance(
  bids: ReadonlyArray<OrderBookLevel>,
  asks: ReadonlyArray<OrderBookLevel>,
  depth = 5,
): number {
  let bidSz = 0;
  let askSz = 0;
  const bn = Math.min(depth, bids.length);
  const an = Math.min(depth, asks.length);
  for (let i = 0; i < bn; i++) bidSz += Number(bids[i]?.size ?? 0);
  for (let i = 0; i < an; i++) askSz += Number(asks[i]?.size ?? 0);
  const tot = bidSz + askSz;
  return tot > 0 ? (bidSz - askSz) / tot : 0;
}

// ---------------------------------------------------------------------------
// 4. Repricing / fair-value lag (the directional edge)

/**
 * Compare a fair P(YES) estimate (e.g. spot vs strike via BS, or a Markov
 * model output) to the market's implied price; act on a gap ≥ minEdge.
 * The underlying moves first; Polymarket reprices second. Positive edge
 * → BUY YES; negative → BUY NO.
 */
export function repricingEdge(
  marketPYes: number,
  fairPYes: number,
  minEdge = 0.05,
): Opportunity | null {
  if (!Number.isFinite(marketPYes) || !Number.isFinite(fairPYes)) return null;
  if (marketPYes < 0 || marketPYes > 1) return null;
  if (fairPYes < 0 || fairPYes > 1) return null;
  const edge = fairPYes - marketPYes;
  if (Math.abs(edge) < minEdge) return null;
  const side: "YES" | "NO" = edge > 0 ? "YES" : "NO";
  return {
    kind: "repricing",
    side,
    edge: Math.abs(edge),
    detail: `fair ${fairPYes.toFixed(3)} vs market ${marketPYes.toFixed(3)} → ${side} (edge ${edge >= 0 ? "+" : ""}${edge.toFixed(3)})`,
    meta: { fair_p_yes: fairPYes, market_p_yes: marketPYes },
  };
}
