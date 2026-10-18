/**
 * Dynamic live-eligibility for genome kinds (Self-evolving improvement A).
 *
 * Replaces the static ARENA_AUTO_PROMOTE_LIVE_KINDS env list with a query
 * that reads rolling-window realized PnL across ALL agents of each kind
 * and returns the kinds that are currently profitable enough to deploy
 * real money against.
 *
 * Failing kinds drop out automatically. Recovering kinds auto-reinstate.
 * No env edits required for the system to react to its own performance.
 *
 * Pure module — takes a `KindPerformance[]` snapshot + thresholds, returns
 * `Set<string>` of eligible kinds. The caller (auto-promote.ts) does the
 * DB read.
 *
 * Algorithm:
 *   For each kind:
 *     trades_in_window = trades from agents of this kind in the rolling window
 *     realized_pnl_in_window = sum of realized_pnl_usd over those trades
 *
 *     If trades < gracePeriodTrades:
 *       → ELIGIBLE (grace period — too little data to judge)
 *     Else:
 *       If realized_pnl_in_window > 0: → ELIGIBLE
 *       Else: → INELIGIBLE (kind is currently failing)
 *
 *   The grace period exists so new kinds (e.g. fresh from meta-evolution)
 *   aren't immediately judged on tiny samples. Default 5 trades.
 *
 * Env override:
 *   - DYNAMIC_KIND_BLACKLIST=0 — disable; fall back to static env list
 *   - ARENA_DYNAMIC_KIND_WINDOW_DAYS=30 — rolling window length
 *   - ARENA_DYNAMIC_KIND_GRACE_TRADES=5 — sample-size floor for judgment
 *   - ARENA_DYNAMIC_KIND_FLOOR_PNL=0 — PnL threshold (default 0; raise to
 *     require a kind to be NET POSITIVE not just break-even)
 *
 * The static ARENA_AUTO_PROMOTE_LIVE_KINDS env list remains as a SAFETY
 * CEILING: a kind never becomes eligible if it's not in that list. This
 * prevents new genome kinds from going live without operator approval.
 */

export type KindPerformance = {
  kind: string;
  trades_in_window: number;
  realized_pnl_in_window: number;
};

export type EligibilityThresholds = {
  /** Min trades required before the kind is judged on PnL. */
  gracePeriodTrades: number;
  /** Realized-PnL floor that the kind must exceed to stay eligible. Default 0. */
  pnlFloor: number;
  /** Static safety ceiling — kinds not in this set are never eligible regardless of perf. */
  safetyCeiling: ReadonlySet<string>;
};

export const DEFAULT_THRESHOLDS: Omit<EligibilityThresholds, "safetyCeiling"> = {
  gracePeriodTrades: 5,
  pnlFloor: 0,
};

/** Safety-ceiling default — the genome kinds we'd ever consider live. */
export const DEFAULT_SAFETY_CEILING: ReadonlySet<string> = new Set([
  "poly_short_binary_directional",
  "llm_probability_oracle",
  "polymarket_market_maker",
  "cb_momentum_burst",
  "cb_mean_reversion",
  "cb_breakout",
  // Markov persistence: registered 2026-05-30. Uses the same Polymarket CLOB
  // execution path as poly_short_binary_directional, so live-eligibility
  // reduces to "the executor can route it correctly" — which it can.
  "markov_persistence",
  // Microstructure kinds — registered 2026-05-31 from 2dollar-bot/mac port.
  // All use the Polymarket CLOB executor.
  "poly_arbitrage_set",
  "poly_repricing",
  "poly_directional_arb_tilt",
  // poly_near_resolution removed from safety ceiling 2026-06-05. Empirically
  // produced a cohort of 80-90 % win-rate agents that all bled capital — the
  // strategy buys the favorite at ~0.95 and wins $0.05 per share, losing
  // $0.95 on the 1-in-10. Negative EV by construction; keeping it out of
  // live promotion eligibility regardless of paper performance. Set
  // ARENA_AUTO_PROMOTE_LIVE_KINDS in env to override if the failure mode
  // is later confirmed mitigated.
  // "poly_near_resolution",
]);

export type EligibilityDecision = {
  kind: string;
  eligible: boolean;
  reason: "grace_period" | "positive_pnl" | "negative_pnl" | "not_in_safety_ceiling";
  trades_in_window: number;
  realized_pnl_in_window: number;
};

export function decideKindEligibility(
  perfs: readonly KindPerformance[],
  thresholds: EligibilityThresholds,
): EligibilityDecision[] {
  return perfs.map((p) => {
    if (!thresholds.safetyCeiling.has(p.kind)) {
      return {
        kind: p.kind,
        eligible: false,
        reason: "not_in_safety_ceiling",
        trades_in_window: p.trades_in_window,
        realized_pnl_in_window: p.realized_pnl_in_window,
      };
    }
    if (p.trades_in_window < thresholds.gracePeriodTrades) {
      return {
        kind: p.kind,
        eligible: true,
        reason: "grace_period",
        trades_in_window: p.trades_in_window,
        realized_pnl_in_window: p.realized_pnl_in_window,
      };
    }
    if (p.realized_pnl_in_window > thresholds.pnlFloor) {
      return {
        kind: p.kind,
        eligible: true,
        reason: "positive_pnl",
        trades_in_window: p.trades_in_window,
        realized_pnl_in_window: p.realized_pnl_in_window,
      };
    }
    return {
      kind: p.kind,
      eligible: false,
      reason: "negative_pnl",
      trades_in_window: p.trades_in_window,
      realized_pnl_in_window: p.realized_pnl_in_window,
    };
  });
}

/** Convenience: extract just the eligible kinds as a Set. */
export function eligibleKinds(decisions: readonly EligibilityDecision[]): Set<string> {
  return new Set(decisions.filter((d) => d.eligible).map((d) => d.kind));
}

/**
 * Parse env-config into EligibilityThresholds. Defensive against malformed
 * env values — falls back to defaults.
 */
export function readThresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): EligibilityThresholds {
  const safetyCeilingRaw = env.ARENA_AUTO_PROMOTE_LIVE_KINDS;
  const safetyCeiling = safetyCeilingRaw
    ? new Set(safetyCeilingRaw.split(",").map((s) => s.trim()).filter(Boolean))
    : DEFAULT_SAFETY_CEILING;
  return {
    gracePeriodTrades: numFromEnv(env.ARENA_DYNAMIC_KIND_GRACE_TRADES, DEFAULT_THRESHOLDS.gracePeriodTrades),
    pnlFloor: numFromEnv(env.ARENA_DYNAMIC_KIND_FLOOR_PNL, DEFAULT_THRESHOLDS.pnlFloor),
    safetyCeiling,
  };
}

/**
 * Whether the dynamic blacklist is enabled. Defaults to ON (true).
 * Setting DYNAMIC_KIND_BLACKLIST=0 disables it and falls back to the
 * static safety-ceiling list (= the previous behavior).
 */
export function isDynamicBlacklistEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DYNAMIC_KIND_BLACKLIST;
  if (raw === undefined) return true; // default ON
  const cleaned = raw.replace(/\s*#.*$/, "").trim().replace(/^["']|["']$/g, "");
  return cleaned !== "0" && cleaned.toLowerCase() !== "false";
}

function numFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const cleaned = raw.replace(/\s*#.*$/, "").trim().replace(/^["']|["']$/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Per-(kind, asset) eligibility — Hermes-style granular blacklist.
//
// The per-kind version above bundles every asset under one bucket. That
// hides the case where (cb_breakout, BTC) is +$200 but (cb_breakout, SOL)
// is -$300 — net positive, kind stays eligible, but the actual SOL
// performance is destroying value. Per-(kind, asset) catches it and only
// disables the failing slice while letting the winning slice through.
//
// Ported from polymarket-2dollar-bot/polybot/tuner.py — the (asset, kind)
// granularity of group_stats() + the disable/re-enable loop.
// ---------------------------------------------------------------------------

export type KindAssetPerformance = {
  kind: string;
  /** Asset symbol — BTC/ETH/SOL/XRP/DOGE/BNB/HYPE/etc, or "any" for asset-agnostic kinds. */
  asset: string;
  trades_in_window: number;
  realized_pnl_in_window: number;
};

export type KindAssetDecision = {
  kind: string;
  asset: string;
  eligible: boolean;
  reason: "grace_period" | "positive_pnl" | "negative_pnl" | "not_in_safety_ceiling";
  trades_in_window: number;
  realized_pnl_in_window: number;
};

/**
 * Compose a composite key from (kind, asset). Used in the disabled set
 * to track granular blacklist state without nested maps.
 */
export function kindAssetKey(kind: string, asset: string): string {
  return `${kind}::${asset}`;
}

/**
 * Same algorithm as decideKindEligibility but keyed by (kind, asset).
 * The safety ceiling still operates per-kind (asset doesn't change
 * whether a kind is structurally allowed to trade live).
 */
export function decideKindAssetEligibility(
  perfs: readonly KindAssetPerformance[],
  thresholds: EligibilityThresholds,
): KindAssetDecision[] {
  return perfs.map((p) => {
    if (!thresholds.safetyCeiling.has(p.kind)) {
      return {
        kind: p.kind,
        asset: p.asset,
        eligible: false,
        reason: "not_in_safety_ceiling",
        trades_in_window: p.trades_in_window,
        realized_pnl_in_window: p.realized_pnl_in_window,
      };
    }
    if (p.trades_in_window < thresholds.gracePeriodTrades) {
      return {
        kind: p.kind,
        asset: p.asset,
        eligible: true,
        reason: "grace_period",
        trades_in_window: p.trades_in_window,
        realized_pnl_in_window: p.realized_pnl_in_window,
      };
    }
    if (p.realized_pnl_in_window > thresholds.pnlFloor) {
      return {
        kind: p.kind,
        asset: p.asset,
        eligible: true,
        reason: "positive_pnl",
        trades_in_window: p.trades_in_window,
        realized_pnl_in_window: p.realized_pnl_in_window,
      };
    }
    return {
      kind: p.kind,
      asset: p.asset,
      eligible: false,
      reason: "negative_pnl",
      trades_in_window: p.trades_in_window,
      realized_pnl_in_window: p.realized_pnl_in_window,
    };
  });
}

/** Convenience: extract eligible (kind, asset) pairs as a Set of composite keys. */
export function eligibleKindAssets(decisions: readonly KindAssetDecision[]): Set<string> {
  return new Set(decisions.filter((d) => d.eligible).map((d) => kindAssetKey(d.kind, d.asset)));
}

/**
 * Roll up per-(kind, asset) decisions into a per-kind verdict for use by
 * the existing per-kind auto-promote pipeline. A kind is rolled-up
 * eligible if ANY of its (kind, asset) slices is eligible — preserving
 * the winning slice instead of disabling the whole kind for one bad
 * asset.
 */
export function rollupToKindEligibility(decisions: readonly KindAssetDecision[]): Set<string> {
  const out = new Set<string>();
  for (const d of decisions) {
    if (d.eligible) out.add(d.kind);
  }
  return out;
}
