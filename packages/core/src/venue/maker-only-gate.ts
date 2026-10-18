/**
 * Maker-only execution gate (ExecutionRouter gate #6).
 *
 * Source: @de1lymoon "How To Use Markov Chains To Win Every Single Trade"
 * (2026-05-26), citing Becker's 72.1M-trade analysis. Empirical finding:
 *
 *   Makers earn +1.12% per trade. Takers lose −1.12% per trade.
 *   A 2.24 pp swing, statistically bulletproof.
 *
 * Article: docs/research/articles/de1lymoon-markov-chains-framework.md
 *
 * ## What this gate does
 *
 * Rejects any order that would execute as a taker (i.e. `type=MARKET`,
 * which crosses the spread) unless one of these escape hatches is set:
 *
 *   1. `order.metadata.allowTaker === true` — per-call opt-in. Use this
 *      from strategies where the edge is large enough to justify giving
 *      up the maker rebate (e.g. detected arbitrage where the spread will
 *      collapse before a limit order fills).
 *
 *   2. `process.env.ROUTER_ALLOW_TAKER === "1"` — global escape hatch.
 *      Use this during incident recovery or when running a strategy that's
 *      not yet maker-aware. Document why if turned on.
 *
 *   3. `order.type === "FOK_BASKET"` — FOK baskets are special: they're
 *      Polymarket-specific multi-leg atomic submits where one of the legs
 *      must cross to fill. The maker-only rule doesn't apply.
 *
 * `LIMIT` orders are always allowed.
 *
 * ## Why this lives at the router level
 *
 * Putting it at the router (not in each adapter or each strategy) makes
 * it impossible to silently bypass. Every order in this codebase flows
 * through `ExecutionRouter.submit()`. Every strategy now inherits the
 * Becker maker-rebate edge by default.
 *
 * Pure function. No DB, no HTTP, no side effects.
 */
import type { SubmitRejected, UnifiedOrder } from "./types";

export type MakerOnlyVerdict =
  | { ok: true }
  | (SubmitRejected & { code: "TAKER_BLOCKED" });

export function checkMakerOnly(
  order: UnifiedOrder,
  opts: { envAllowTaker?: string | undefined } = {},
): MakerOnlyVerdict {
  const envFlag = opts.envAllowTaker ?? process.env.ROUTER_ALLOW_TAKER;

  // FOK baskets bypass: they're atomic multi-leg crosses by design.
  if (order.type === "FOK_BASKET") return { ok: true };

  // LIMIT orders are always allowed.
  if (order.type !== "MARKET") return { ok: true };

  // MARKET orders need an explicit opt-in.
  if (order.metadata?.allowTaker === true) return { ok: true };
  if (envFlag === "1") return { ok: true };

  return {
    ok: false,
    code: "TAKER_BLOCKED",
    reason:
      "MARKET orders are blocked by default (Becker maker-rebate: +1.12% vs -1.12% taker). " +
      "Set order.metadata.allowTaker=true to opt-in for this order, " +
      "or ROUTER_ALLOW_TAKER=1 in the environment to disable the gate globally.",
  };
}
