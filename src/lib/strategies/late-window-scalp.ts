/**
 * Late-window scalp — mirrors the operator's manual winning pattern.
 *
 * From audit-wallet on 2026-05-28:
 *   The operator buys the HEAVILY-FAVORED side of a 5-min crypto Up/Down
 *   binary in the last ~1-3 minutes before resolution. Entries are
 *   $0.85-$0.98 on the winning side; positions are small ($2 each); the
 *   trade settles in minutes. Win-rate on the operator's last 39 closed
 *   positions was 79% (31 wins / 8 losses) at $2 stake = small but
 *   profitable when separated from out-of-money directional bets.
 *
 * This detector codifies the pattern. Inputs: a 5-min binary book
 * snapshot with both sides' best-asks and depth. Outputs an
 * opportunity when:
 *   - remaining time in [minRemainingSec, maxRemainingSec]
 *   - one side's best-ask in [minAsk, maxAsk] (heavily favored, but
 *     still room to profit)
 *   - top-of-book depth ≥ minDepthUsd (enough to fill our small bet)
 *   - net payoff/share ≥ minPayoffPerShare (after fees)
 *
 * Side selection: BUY the side with the HIGHER ask (the favored side).
 * If both sides are within `tieThreshold` of each other → no signal
 * (no clear favorite; that's the "directional bet at <$0.30" leg that
 * costs the operator most of their losses).
 *
 * Pure function. No I/O.
 *
 * Risk note: this strategy works empirically but isn't arbitrage —
 * the favored side CAN lose. Win-rate ~80% on the operator's data means
 * 20% of trades go to zero. Average win is ~$0.10-0.20 per share; one
 * full loss costs $0.85-$0.98 per share. EV is positive only if
 * `win_rate × (1 - ask) > (1 - win_rate) × ask`. At ask=$0.90 +
 * win_rate=0.80: 0.80×0.10 - 0.20×0.90 = -$0.10/share. That's NEGATIVE
 * EV unless win_rate > ask. The operator's edge comes from selecting
 * the LAST-MINUTE state where the favored side's ACTUAL win prob
 * exceeds the market-implied (i.e. the market is slow to mark the
 * winner to $1.00). The detector codifies this timing edge; backtest
 * required before going live.
 */

export type BinaryBookSnapshot = {
  conditionId: string;
  title?: string;
  asset: string;
  /** Epoch ms when market resolves. */
  windowCloseMs: number;
  /** Current epoch ms. */
  nowMs: number;
  /** Best-ask on UP outcome (cost to BUY one UP share). */
  upBestAsk: number;
  /** Best-ask on DOWN outcome. */
  downBestAsk: number;
  /** USD-denominated depth at the best UP ask. */
  upDepthUsd: number;
  /** USD-denominated depth at the best DOWN ask. */
  downDepthUsd: number;
};

export type LateWindowScalpOpportunity = {
  conditionId: string;
  title?: string;
  asset: string;
  /** Side we'd BUY — the heavily-favored one. */
  side: "UP" | "DOWN";
  /** Price we'd pay per share. */
  entry_price: number;
  /** Payoff per share if right (= 1 - entry - fees). */
  payoff_per_share: number;
  /** Implied break-even win-rate at this entry. = entry / 1.0. */
  implied_breakeven_win_rate: number;
  /** floor(min_side_depth_usd / entry_price). */
  max_shares: number;
  /** max_shares × entry_price. */
  capital_required_usd: number;
  /** Estimated max realized payoff if all shares win. */
  max_payoff_usd: number;
  /** Seconds until market resolves. */
  remaining_sec: number;
  reason: string;
};

export type LateWindowScalpOptions = {
  /** Minimum ask on the favored side (default 0.85). */
  minAsk?: number;
  /** Maximum ask on the favored side (default 0.98 — above this no profit room). */
  maxAsk?: number;
  /** Minimum seconds remaining (default 30 — need time to fill). */
  minRemainingSec?: number;
  /** Maximum seconds remaining (default 180 — only last 3 minutes). */
  maxRemainingSec?: number;
  /** Minimum USD depth on chosen side (default $2). */
  minDepthUsd?: number;
  /** Minimum payoff per share after fees (default $0.02 = 2¢). */
  minPayoffPerShare?: number;
  /** Round-trip fee in basis points (default 20). */
  feeBps?: number;
  /**
   * Minimum gap between Up and Down asks for one side to be considered
   * "heavily favored". If |Up_ask - Down_ask| < this, no signal (no
   * clear favorite). Default 0.30 → one side must be ≥0.30 above the
   * other for the favorite to be unambiguous.
   */
  tieThreshold?: number;
};

const D = {
  minAsk: 0.85,
  maxAsk: 0.98,
  minRemainingSec: 30,
  maxRemainingSec: 180,
  minDepthUsd: 2,
  minPayoffPerShare: 0.02,
  feeBps: 20,
  tieThreshold: 0.30,
};

export function detectLateWindowScalp(
  market: BinaryBookSnapshot,
  opts: LateWindowScalpOptions = {},
): LateWindowScalpOpportunity | null {
  const minAsk = opts.minAsk ?? D.minAsk;
  const maxAsk = opts.maxAsk ?? D.maxAsk;
  const minRemSec = opts.minRemainingSec ?? D.minRemainingSec;
  const maxRemSec = opts.maxRemainingSec ?? D.maxRemainingSec;
  const minDepth = opts.minDepthUsd ?? D.minDepthUsd;
  const minPayoff = opts.minPayoffPerShare ?? D.minPayoffPerShare;
  const feeBps = opts.feeBps ?? D.feeBps;
  const tieThreshold = opts.tieThreshold ?? D.tieThreshold;

  // Price sanity.
  if (!Number.isFinite(market.upBestAsk) || !Number.isFinite(market.downBestAsk)) return null;
  if (market.upBestAsk <= 0 || market.upBestAsk >= 1) return null;
  if (market.downBestAsk <= 0 || market.downBestAsk >= 1) return null;
  if (!Number.isFinite(market.upDepthUsd) || !Number.isFinite(market.downDepthUsd)) return null;

  // Time gates.
  const remainingMs = market.windowCloseMs - market.nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const remainingSec = remainingMs / 1000;
  if (remainingSec < minRemSec || remainingSec > maxRemSec) return null;

  // Pick the favored side (higher ask). Reject if the gap is too small.
  const gap = Math.abs(market.upBestAsk - market.downBestAsk);
  if (gap < tieThreshold) return null;
  const favoredSide: "UP" | "DOWN" = market.upBestAsk > market.downBestAsk ? "UP" : "DOWN";
  const entryPrice = favoredSide === "UP" ? market.upBestAsk : market.downBestAsk;
  const depthUsd = favoredSide === "UP" ? market.upDepthUsd : market.downDepthUsd;

  // Price gate (must be in the scalp band).
  if (entryPrice < minAsk || entryPrice > maxAsk) return null;

  // Depth gate.
  if (depthUsd < minDepth) return null;

  // Payoff math.
  const feeAdj = feeBps / 10_000;
  const payoffPerShare = (1 - entryPrice) - feeAdj;
  if (payoffPerShare < minPayoff) return null;

  // Sizing.
  const maxShares = Math.floor(depthUsd / entryPrice);
  if (maxShares < 1) return null;
  const capitalRequired = maxShares * entryPrice;
  const maxPayoff = maxShares * payoffPerShare;

  const impliedBreakeven = entryPrice; // need to win > entry/1.0 of the time to break even

  return {
    conditionId: market.conditionId,
    title: market.title,
    asset: market.asset,
    side: favoredSide,
    entry_price: entryPrice,
    payoff_per_share: +payoffPerShare.toFixed(4),
    implied_breakeven_win_rate: +impliedBreakeven.toFixed(4),
    max_shares: maxShares,
    capital_required_usd: +capitalRequired.toFixed(2),
    max_payoff_usd: +maxPayoff.toFixed(2),
    remaining_sec: +remainingSec.toFixed(0),
    reason:
      `${market.asset} ${favoredSide} @ $${entryPrice.toFixed(3)} ` +
      `· ${remainingSec.toFixed(0)}s remaining · gap ${(gap * 100).toFixed(0)}pp ` +
      `· payoff $${payoffPerShare.toFixed(3)}/sh · max ${maxShares}sh ($${capitalRequired.toFixed(2)} → $${maxPayoff.toFixed(2)}) ` +
      `· need win > ${(impliedBreakeven * 100).toFixed(0)}% to be EV+`,
  };
}
