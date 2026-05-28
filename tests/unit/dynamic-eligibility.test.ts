/**
 * Tests for the dynamic kind eligibility module (Self-evolving fix A).
 */
import { describe, expect, it } from "vitest";
import {
  decideKindEligibility,
  DEFAULT_SAFETY_CEILING,
  DEFAULT_THRESHOLDS,
  eligibleKinds,
  isDynamicBlacklistEnabled,
  readThresholdsFromEnv,
  type EligibilityThresholds,
  type KindPerformance,
} from "@/lib/arena/dynamic-eligibility";

const T: EligibilityThresholds = {
  ...DEFAULT_THRESHOLDS,
  safetyCeiling: DEFAULT_SAFETY_CEILING,
};

describe("decideKindEligibility", () => {
  it("positive PnL with enough trades → eligible", () => {
    const r = decideKindEligibility(
      [{ kind: "poly_short_binary_directional", trades_in_window: 30, realized_pnl_in_window: 5 }],
      T,
    );
    expect(r[0]).toEqual({
      kind: "poly_short_binary_directional",
      eligible: true,
      reason: "positive_pnl",
      trades_in_window: 30,
      realized_pnl_in_window: 5,
    });
  });

  it("negative PnL with enough trades → ineligible", () => {
    const r = decideKindEligibility(
      [{ kind: "poly_short_binary_directional", trades_in_window: 30, realized_pnl_in_window: -5 }],
      T,
    );
    expect(r[0]!.eligible).toBe(false);
    expect(r[0]!.reason).toBe("negative_pnl");
  });

  it("zero PnL with enough trades → ineligible (≤ pnlFloor)", () => {
    const r = decideKindEligibility(
      [{ kind: "poly_short_binary_directional", trades_in_window: 30, realized_pnl_in_window: 0 }],
      T,
    );
    expect(r[0]!.eligible).toBe(false);
  });

  it("under grace-period → eligible regardless of PnL", () => {
    const r = decideKindEligibility(
      [{ kind: "poly_short_binary_directional", trades_in_window: 2, realized_pnl_in_window: -100 }],
      T,
    );
    expect(r[0]!.eligible).toBe(true);
    expect(r[0]!.reason).toBe("grace_period");
  });

  it("kind not in safety ceiling → ineligible", () => {
    const r = decideKindEligibility(
      [{ kind: "experimental_genome_not_in_list", trades_in_window: 30, realized_pnl_in_window: 100 }],
      T,
    );
    expect(r[0]!.eligible).toBe(false);
    expect(r[0]!.reason).toBe("not_in_safety_ceiling");
  });

  it("custom pnlFloor: requires net positive above threshold", () => {
    const tight: EligibilityThresholds = { ...T, pnlFloor: 10 };
    expect(
      decideKindEligibility(
        [{ kind: "poly_short_binary_directional", trades_in_window: 30, realized_pnl_in_window: 5 }],
        tight,
      )[0]!.eligible,
    ).toBe(false);
    expect(
      decideKindEligibility(
        [{ kind: "poly_short_binary_directional", trades_in_window: 30, realized_pnl_in_window: 15 }],
        tight,
      )[0]!.eligible,
    ).toBe(true);
  });

  it("processes multiple kinds in one call", () => {
    const r = decideKindEligibility(
      [
        { kind: "poly_short_binary_directional", trades_in_window: 30, realized_pnl_in_window: 5 },
        { kind: "cb_breakout", trades_in_window: 30, realized_pnl_in_window: -10 },
        { kind: "cb_momentum_burst", trades_in_window: 2, realized_pnl_in_window: -100 },
        { kind: "unknown_kind", trades_in_window: 30, realized_pnl_in_window: 100 },
      ],
      T,
    );
    expect(r).toHaveLength(4);
    expect(r[0]!.eligible).toBe(true);  // positive
    expect(r[1]!.eligible).toBe(false); // negative
    expect(r[2]!.eligible).toBe(true);  // grace
    expect(r[3]!.eligible).toBe(false); // not in safety ceiling
  });
});

describe("eligibleKinds (convenience)", () => {
  it("returns just the eligible kinds as a Set", () => {
    const decisions = decideKindEligibility(
      [
        { kind: "poly_short_binary_directional", trades_in_window: 30, realized_pnl_in_window: 5 },
        { kind: "cb_breakout", trades_in_window: 30, realized_pnl_in_window: -10 },
        { kind: "cb_momentum_burst", trades_in_window: 30, realized_pnl_in_window: 2 },
      ],
      T,
    );
    const set = eligibleKinds(decisions);
    expect(set.has("poly_short_binary_directional")).toBe(true);
    expect(set.has("cb_breakout")).toBe(false);
    expect(set.has("cb_momentum_burst")).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe("readThresholdsFromEnv", () => {
  it("returns defaults on empty env", () => {
    const t = readThresholdsFromEnv({});
    expect(t.gracePeriodTrades).toBe(5);
    expect(t.pnlFloor).toBe(0);
    expect(t.safetyCeiling).toEqual(DEFAULT_SAFETY_CEILING);
  });

  it("respects ARENA_DYNAMIC_KIND_GRACE_TRADES", () => {
    expect(readThresholdsFromEnv({ ARENA_DYNAMIC_KIND_GRACE_TRADES: "20" }).gracePeriodTrades).toBe(20);
  });

  it("respects ARENA_DYNAMIC_KIND_FLOOR_PNL", () => {
    expect(readThresholdsFromEnv({ ARENA_DYNAMIC_KIND_FLOOR_PNL: "25" }).pnlFloor).toBe(25);
  });

  it("ARENA_AUTO_PROMOTE_LIVE_KINDS override sets the safety ceiling", () => {
    const t = readThresholdsFromEnv({ ARENA_AUTO_PROMOTE_LIVE_KINDS: "alpha,beta,gamma" });
    expect(t.safetyCeiling).toEqual(new Set(["alpha", "beta", "gamma"]));
  });

  it("strips inline comments + whitespace from env values", () => {
    expect(readThresholdsFromEnv({ ARENA_DYNAMIC_KIND_GRACE_TRADES: "20  # tight" }).gracePeriodTrades).toBe(20);
  });

  it("falls back to default on malformed numeric values", () => {
    expect(readThresholdsFromEnv({ ARENA_DYNAMIC_KIND_GRACE_TRADES: "garbage" }).gracePeriodTrades).toBe(5);
  });
});

describe("isDynamicBlacklistEnabled", () => {
  it("default ON (no env var set)", () => {
    expect(isDynamicBlacklistEnabled({})).toBe(true);
  });

  it("DYNAMIC_KIND_BLACKLIST=0 disables", () => {
    expect(isDynamicBlacklistEnabled({ DYNAMIC_KIND_BLACKLIST: "0" })).toBe(false);
    expect(isDynamicBlacklistEnabled({ DYNAMIC_KIND_BLACKLIST: "false" })).toBe(false);
  });

  it("DYNAMIC_KIND_BLACKLIST=1 enables explicitly", () => {
    expect(isDynamicBlacklistEnabled({ DYNAMIC_KIND_BLACKLIST: "1" })).toBe(true);
  });

  it("strips inline comments", () => {
    expect(isDynamicBlacklistEnabled({ DYNAMIC_KIND_BLACKLIST: "0 # off for now" })).toBe(false);
  });
});
