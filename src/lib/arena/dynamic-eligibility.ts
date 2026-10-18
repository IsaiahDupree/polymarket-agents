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
