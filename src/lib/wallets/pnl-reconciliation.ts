/**
 * Wallet PnL reconciliation — given an article's claimed PnL for a wallet
 * and the wallet's actual leaderboard PnL, decide whether the claim is
 * supported, inflated, understated, or unverifiable.
 *
 * Used by the 0x_Discover-article-validation runner to test whether the
 * article's 15 bot citations hold up against Polymarket's own data API.
 *
 * Pure functions only.
 */

export type ActualPnl = {
  /** From Polymarket leaderboard pnl field (USD). */
  pnlUsd: number;
  /** Lifetime volume USD. */
  volUsd: number;
  /** Leaderboard rank if returned. */
  rank?: number;
  /** Resolved proxyWallet address (for the audit). */
  proxyWallet: string;
  /** UserName as returned by the leaderboard (verifies handle resolution). */
  userName: string;
};

export type ReconciliationVerdict = {
  handle: string;
  claimedUsd: number;
  /** null when the wallet/handle didn't resolve at all. */
  actual: ActualPnl | null;
  /** Headline classification. */
  outcome:
    | "claim_supported"      // |actual - claimed| / claimed < 0.15 (15% tolerance)
    | "claim_inflated"       // actual < claimed * 0.85
    | "claim_understated"    // actual > claimed * 1.15
    | "wallet_not_found"     // resolution returned nothing
    | "claim_missing";       // we have data but the article didn't make a claim
  /** Ratio = actual / claimed (null when one side is missing). */
  ratio: number | null;
  /** Percentage-point delta = (actual - claimed) / claimed × 100 (null when one side is missing). */
  deltaPct: number | null;
  /** Human-readable explanation surfaced in reports. */
  rationale: string;
};

/**
 * Default tolerance for claim_supported = within ±15% of the article's claim.
 * The article's numbers are quoted in round figures ("$12,000,000"); a 15%
 * band absorbs both rounding by the article AND time drift between when the
 * article was written and when we query the leaderboard.
 */
export const DEFAULT_TOLERANCE = 0.15;

export function reconcileWalletPnl(input: {
  handle: string;
  claimedUsd: number | null;
  actual: ActualPnl | null;
  /** Tolerance band as fraction (default 0.15 = ±15%). */
  tolerance?: number;
}): ReconciliationVerdict {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;

  // Case A: no on-chain data at all.
  if (!input.actual) {
    return {
      handle: input.handle,
      claimedUsd: input.claimedUsd ?? 0,
      actual: null,
      outcome: "wallet_not_found",
      ratio: null,
      deltaPct: null,
      rationale: `No leaderboard match for handle "${input.handle}".`,
    };
  }

  // Case B: we have actual data but the article didn't make a claim.
  if (input.claimedUsd == null || input.claimedUsd <= 0) {
    return {
      handle: input.handle,
      claimedUsd: 0,
      actual: input.actual,
      outcome: "claim_missing",
      ratio: null,
      deltaPct: null,
      rationale: `Wallet exists (lifetime PnL $${input.actual.pnlUsd.toFixed(0)}) but article did not state a claim to compare against.`,
    };
  }

  const ratio = input.actual.pnlUsd / input.claimedUsd;
  const deltaPct = ((input.actual.pnlUsd - input.claimedUsd) / input.claimedUsd) * 100;

  let outcome: ReconciliationVerdict["outcome"];
  let descriptor: string;
  if (Math.abs(deltaPct) <= tolerance * 100) {
    outcome = "claim_supported";
    descriptor = "within tolerance";
  } else if (input.actual.pnlUsd < input.claimedUsd * (1 - tolerance)) {
    outcome = "claim_inflated";
    descriptor = "actual significantly below claim";
  } else {
    outcome = "claim_understated";
    descriptor = "actual significantly above claim";
  }

  const rationale = [
    `Claim $${formatM(input.claimedUsd)}, actual $${formatM(input.actual.pnlUsd)} → ${descriptor}`,
    `(${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}% vs claim)`,
    input.actual.rank != null ? `Leaderboard rank ${input.actual.rank}.` : "",
    `Volume $${formatM(input.actual.volUsd)}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    handle: input.handle,
    claimedUsd: input.claimedUsd,
    actual: input.actual,
    outcome,
    ratio,
    deltaPct,
    rationale,
  };
}

/** Format USD value with M/K suffix for compact display. */
function formatM(usd: number): string {
  if (Math.abs(usd) >= 1_000_000) return `${(usd / 1_000_000).toFixed(2)}M`;
  if (Math.abs(usd) >= 1_000) return `${(usd / 1_000).toFixed(1)}K`;
  return usd.toFixed(0);
}

/**
 * Aggregate summary across many wallets. Useful for the final report's
 * headline numbers ("9 of 15 claim_supported, 4 inflated, 2 not found").
 */
export type ReconciliationSummary = {
  totalWallets: number;
  claimSupported: number;
  claimInflated: number;
  claimUnderstated: number;
  walletNotFound: number;
  claimMissing: number;
  /** Sum of all claimed PnLs in the cohort. */
  totalClaimedUsd: number;
  /** Sum of all actual PnLs across resolved wallets only. */
  totalActualUsd: number;
  /** Aggregate ratio (sum of actual / sum of claimed across resolved wallets). */
  aggregateRatio: number | null;
};

export function summarizeReconciliation(verdicts: ReconciliationVerdict[]): ReconciliationSummary {
  let claimSupported = 0;
  let claimInflated = 0;
  let claimUnderstated = 0;
  let walletNotFound = 0;
  let claimMissing = 0;
  let totalClaimedUsd = 0;
  let totalActualUsd = 0;
  let resolvedClaimedUsd = 0;

  for (const v of verdicts) {
    switch (v.outcome) {
      case "claim_supported":
        claimSupported++;
        break;
      case "claim_inflated":
        claimInflated++;
        break;
      case "claim_understated":
        claimUnderstated++;
        break;
      case "wallet_not_found":
        walletNotFound++;
        break;
      case "claim_missing":
        claimMissing++;
        break;
    }
    totalClaimedUsd += v.claimedUsd;
    if (v.actual) {
      totalActualUsd += v.actual.pnlUsd;
      if (v.claimedUsd > 0) resolvedClaimedUsd += v.claimedUsd;
    }
  }

  return {
    totalWallets: verdicts.length,
    claimSupported,
    claimInflated,
    claimUnderstated,
    walletNotFound,
    claimMissing,
    totalClaimedUsd,
    totalActualUsd,
    aggregateRatio: resolvedClaimedUsd > 0 ? totalActualUsd / resolvedClaimedUsd : null,
  };
}
