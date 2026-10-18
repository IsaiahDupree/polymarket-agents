/**
 * Partial-fill rollback planner — @0x_Discover article #1.
 *
 * Article's exact failure mode:
 *
 *   Your arbitrage plan: buy YES at $0.30, buy NO at $0.30, guaranteed
 *   $0.40 profit. Reality: YES fills at $0.30 ✓. Price updates. NO fills
 *   at $0.78 ✗. You just lost $0.08.
 *
 * True atomic submission requires a multicall contract — that's a separate,
 * infra-heavy undertaking. The immediate mitigation: when we detect a
 * partial fill, IMMEDIATELY submit a closing order on the leg that DID
 * fill. We accept the round-trip slippage cost in exchange for not being
 * left holding unhedged directional exposure.
 *
 * This module is the PURE decision logic. It takes the planned legs +
 * actual fill results, classifies the outcome, and returns either:
 *   - { kind: "no_action" } — both legs filled or both failed cleanly
 *   - { kind: "rollback", closingLeg } — exactly one leg filled, close it
 *   - { kind: "ambiguous", reason } — fill results unclear, escalate
 *
 * The caller (executeSingleMarketArb) submits the closing order through
 * the existing single-side market path.
 *
 * Pure function — no I/O. The actual submission is the caller's job.
 */

export type ArbLeg = {
  /** Token id this leg targets (YES or NO of the conditional market). */
  tokenId: string;
  /** Cents per share at submission time. */
  price: number;
  /** Number of shares requested. */
  shares: number;
  /** USD notional planned. */
  sizeUsd: number;
  /** Human label — "YES" or "NO" or "leg1"/"leg2". */
  label?: string;
};

export type LegFillResult = {
  /** True if the leg appears to have filled (filledShares > 0). */
  filled: boolean;
  /** Shares actually filled (may be < requested for partial). */
  filledShares?: number;
  /** Reason for non-fill, if known. */
  reason?: string;
  /** Adapter's raw response — preserved for audit. */
  raw?: unknown;
};

export type RollbackPlan =
  | { kind: "no_action"; reason: string }
  | {
      kind: "rollback";
      /** Which leg to close. */
      closingLeg: {
        tokenId: string;
        side: "SELL"; // we're closing a long position
        /** Shares to dump — should equal the filled shares of the unbalanced leg. */
        shares: number;
        /** Reference price for risk + size accounting. */
        refPrice: number;
        label: string;
      };
      /** Which original leg this rollback corresponds to. */
      originalLeg: ArbLeg;
      /** Estimated USD loss vs the original arb plan (rough — actual depends on fill). */
      estimatedLossUsd: number;
    }
  | { kind: "ambiguous"; reason: string };

/**
 * Pure function: given the planned arbitrage legs and the fill results from
 * the adapter, decide what to do.
 *
 * Inputs:
 *   plan: { yesLeg, noLeg }    — the two legs we tried to submit
 *   fills: { yes, no }         — the results
 *
 * Output: RollbackPlan
 *
 * Decisions:
 *   - Both filled OR both unfilled → no_action.
 *   - Exactly one filled → rollback the filled leg.
 *   - Both partial → rollback the over-filled side to match the under-filled
 *     side's shares (so the basket is balanced at the smaller size, no
 *     unhedged exposure).
 */
export function planRollback(
  plan: { yesLeg: ArbLeg; noLeg: ArbLeg },
  fills: { yes: LegFillResult; no: LegFillResult },
): RollbackPlan {
  const yesShares = fills.yes.filled ? fills.yes.filledShares ?? plan.yesLeg.shares : 0;
  const noShares = fills.no.filled ? fills.no.filledShares ?? plan.noLeg.shares : 0;

  // Case 1: both clean fills (full or matching partials).
  if (yesShares > 0 && noShares > 0 && Math.abs(yesShares - noShares) < 1) {
    return {
      kind: "no_action",
      reason: `both legs filled cleanly (yes=${yesShares}, no=${noShares} shares)`,
    };
  }

  // Case 2: neither leg filled.
  if (yesShares === 0 && noShares === 0) {
    return {
      kind: "no_action",
      reason: "neither leg filled — nothing to roll back",
    };
  }

  // Case 3: exactly one leg filled, the other entirely failed.
  if (yesShares > 0 && noShares === 0) {
    return {
      kind: "rollback",
      closingLeg: {
        tokenId: plan.yesLeg.tokenId,
        side: "SELL",
        shares: yesShares,
        refPrice: plan.yesLeg.price,
        label: `close-YES (${yesShares}sh)`,
      },
      originalLeg: plan.yesLeg,
      estimatedLossUsd: estimateLossUsd(plan.yesLeg, yesShares),
    };
  }
  if (noShares > 0 && yesShares === 0) {
    return {
      kind: "rollback",
      closingLeg: {
        tokenId: plan.noLeg.tokenId,
        side: "SELL",
        shares: noShares,
        refPrice: plan.noLeg.price,
        label: `close-NO (${noShares}sh)`,
      },
      originalLeg: plan.noLeg,
      estimatedLossUsd: estimateLossUsd(plan.noLeg, noShares),
    };
  }

  // Case 4: both partial, mismatched sizes. Close the OVER-filled side back
  // to the under-filled side's share count, so the residual basket is
  // balanced.
  if (yesShares > 0 && noShares > 0) {
    const overLeg = yesShares > noShares ? "yes" : "no";
    const overShares = Math.max(yesShares, noShares);
    const underShares = Math.min(yesShares, noShares);
    const closeShares = Math.round(overShares - underShares);
    if (closeShares < 1) {
      return {
        kind: "no_action",
        reason: `partial fills within 1 share of each other (yes=${yesShares}, no=${noShares})`,
      };
    }
    const overOrig = overLeg === "yes" ? plan.yesLeg : plan.noLeg;
    return {
      kind: "rollback",
      closingLeg: {
        tokenId: overOrig.tokenId,
        side: "SELL",
        shares: closeShares,
        refPrice: overOrig.price,
        label: `rebalance-${overLeg.toUpperCase()} (${closeShares}sh)`,
      },
      originalLeg: overOrig,
      estimatedLossUsd: estimateLossUsd(overOrig, closeShares),
    };
  }

  return {
    kind: "ambiguous",
    reason: `unexpected fill shape: yes=${JSON.stringify(fills.yes)} no=${JSON.stringify(fills.no)}`,
  };
}

/**
 * Pessimistic loss estimate: assume the closing order fills at 0.5×price
 * (worst-case half the original) — i.e., we paid `price · shares` to open
 * and recover `0.5 · price · shares`. Real slippage depends on book depth
 * + how stale the price is. Caller can override with a tighter model.
 */
function estimateLossUsd(leg: ArbLeg, shares: number): number {
  const openCost = leg.price * shares;
  const closingRecovery = leg.price * 0.5 * shares;
  return Math.max(0, openCost - closingRecovery);
}
