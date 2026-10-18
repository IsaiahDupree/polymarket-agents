/**
 * Unit tests for the per-(kind, asset) Hermes-style blacklist extension
 * to src/lib/arena/dynamic-eligibility.ts.
 *
 * The existing per-kind logic is locked by tests/unit/arena-dynamic-
 * eligibility.test.ts; this file pins the NEW per-(kind, asset) API.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLDS,
  decideKindAssetEligibility,
  eligibleKindAssets,
  kindAssetKey,
  rollupToKindEligibility,
  type KindAssetPerformance,
  type EligibilityThresholds,
} from "@/lib/arena/dynamic-eligibility";

const thresholds: EligibilityThresholds = {
  ...DEFAULT_THRESHOLDS,
  safetyCeiling: new Set(["cb_breakout", "cb_mean_reversion", "markov_persistence"]),
};

const perf = (kind: string, asset: string, trades: number, pnl: number): KindAssetPerformance => ({
  kind, asset, trades_in_window: trades, realized_pnl_in_window: pnl,
});

// ---------------------------------------------------------------------------
// kindAssetKey

describe("kindAssetKey", () => {
  it("uses :: as the separator", () => {
    expect(kindAssetKey("cb_breakout", "BTC")).toBe("cb_breakout::BTC");
  });
  it("is stable across calls (no hidden state)", () => {
    expect(kindAssetKey("x", "y")).toBe(kindAssetKey("x", "y"));
  });
});

// ---------------------------------------------------------------------------
// decideKindAssetEligibility

describe("decideKindAssetEligibility — gates", () => {
  it("'grace_period' eligible when trades_in_window < grace floor", () => {
    const out = decideKindAssetEligibility(
      [perf("cb_breakout", "BTC", DEFAULT_THRESHOLDS.gracePeriodTrades - 1, -1000)],
      thresholds,
    );
    expect(out[0].eligible).toBe(true);
    expect(out[0].reason).toBe("grace_period");
  });

  it("'positive_pnl' eligible when above threshold + above pnl floor", () => {
    const out = decideKindAssetEligibility(
      [perf("cb_breakout", "BTC", 100, 50)],
      thresholds,
    );
    expect(out[0].eligible).toBe(true);
    expect(out[0].reason).toBe("positive_pnl");
  });

  it("'negative_pnl' ineligible when above sample size + below pnl floor", () => {
    const out = decideKindAssetEligibility(
      [perf("cb_breakout", "BTC", 100, -50)],
      thresholds,
    );
    expect(out[0].eligible).toBe(false);
    expect(out[0].reason).toBe("negative_pnl");
  });

  it("'not_in_safety_ceiling' ineligible regardless of perf", () => {
    const out = decideKindAssetEligibility(
      [perf("not_a_real_kind", "BTC", 100, 9999)],
      thresholds,
    );
    expect(out[0].eligible).toBe(false);
    expect(out[0].reason).toBe("not_in_safety_ceiling");
  });
});

describe("decideKindAssetEligibility — granular disable", () => {
  it("disables only the failing asset slice; the winning slice stays", () => {
    // The whole point of the per-(kind, asset) extension: per-kind
    // aggregation would net these to +$150 and keep cb_breakout fully
    // eligible. Per-(kind, asset) blacklists ONLY the SOL slice.
    const out = decideKindAssetEligibility([
      perf("cb_breakout", "BTC", 100, 200),
      perf("cb_breakout", "SOL", 100, -50),
    ], thresholds);
    const map = new Map(out.map((d) => [kindAssetKey(d.kind, d.asset), d]));
    expect(map.get("cb_breakout::BTC")?.eligible).toBe(true);
    expect(map.get("cb_breakout::SOL")?.eligible).toBe(false);
  });

  it("multiple kinds + multiple assets all decided independently", () => {
    const out = decideKindAssetEligibility([
      perf("cb_breakout", "BTC", 100, 200),       // +
      perf("cb_breakout", "SOL", 100, -50),       // -
      perf("cb_mean_reversion", "BTC", 100, -10), // -
      perf("cb_mean_reversion", "ETH", 100, 30),  // +
      perf("markov_persistence", "BTC", 4, -999), // grace (4 trades)
    ], thresholds);
    const decisions = new Map(out.map((d) => [kindAssetKey(d.kind, d.asset), d]));
    expect(decisions.get("cb_breakout::BTC")?.eligible).toBe(true);
    expect(decisions.get("cb_breakout::SOL")?.eligible).toBe(false);
    expect(decisions.get("cb_mean_reversion::BTC")?.eligible).toBe(false);
    expect(decisions.get("cb_mean_reversion::ETH")?.eligible).toBe(true);
    expect(decisions.get("markov_persistence::BTC")?.eligible).toBe(true);
    expect(decisions.get("markov_persistence::BTC")?.reason).toBe("grace_period");
  });
});

// ---------------------------------------------------------------------------
// eligibleKindAssets

describe("eligibleKindAssets", () => {
  it("returns composite keys for eligible decisions only", () => {
    const decisions = decideKindAssetEligibility([
      perf("cb_breakout", "BTC", 100, 200),
      perf("cb_breakout", "SOL", 100, -50),
    ], thresholds);
    const eligible = eligibleKindAssets(decisions);
    expect(eligible.has("cb_breakout::BTC")).toBe(true);
    expect(eligible.has("cb_breakout::SOL")).toBe(false);
    expect(eligible.size).toBe(1);
  });

  it("returns empty set when all decisions are ineligible", () => {
    const decisions = decideKindAssetEligibility([
      perf("cb_breakout", "BTC", 100, -10),
      perf("cb_breakout", "SOL", 100, -50),
    ], thresholds);
    expect(eligibleKindAssets(decisions).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// rollupToKindEligibility

describe("rollupToKindEligibility", () => {
  it("rolls up to kind-level when ANY asset slice is eligible", () => {
    // cb_breakout is eligible because BTC is eligible (SOL is not).
    const decisions = decideKindAssetEligibility([
      perf("cb_breakout", "BTC", 100, 200),
      perf("cb_breakout", "SOL", 100, -50),
    ], thresholds);
    const kinds = rollupToKindEligibility(decisions);
    expect(kinds.has("cb_breakout")).toBe(true);
  });

  it("excludes kinds where every asset slice is ineligible", () => {
    const decisions = decideKindAssetEligibility([
      perf("cb_breakout", "BTC", 100, -200),
      perf("cb_breakout", "SOL", 100, -50),
    ], thresholds);
    const kinds = rollupToKindEligibility(decisions);
    expect(kinds.has("cb_breakout")).toBe(false);
  });

  it("respects the safety ceiling on rollup", () => {
    const decisions = decideKindAssetEligibility([
      perf("not_a_real_kind", "BTC", 100, 9999),
    ], thresholds);
    const kinds = rollupToKindEligibility(decisions);
    expect(kinds.has("not_a_real_kind")).toBe(false);
  });

  it("integration: 4 kinds × 3 assets matrix, rollup picks the right kinds", () => {
    const decisions = decideKindAssetEligibility([
      // cb_breakout: BTC + (SOL bad) → eligible
      perf("cb_breakout", "BTC", 100, 50),
      perf("cb_breakout", "ETH", 100, 30),
      perf("cb_breakout", "SOL", 100, -20),
      // cb_mean_reversion: all bad → ineligible
      perf("cb_mean_reversion", "BTC", 100, -10),
      perf("cb_mean_reversion", "ETH", 100, -20),
      perf("cb_mean_reversion", "SOL", 100, -30),
      // markov_persistence: only grace → eligible (still gathering data)
      perf("markov_persistence", "BTC", 2, -5),
      perf("markov_persistence", "ETH", 1, 0),
      perf("markov_persistence", "SOL", 0, 0),
    ], thresholds);
    const kinds = rollupToKindEligibility(decisions);
    expect(kinds.has("cb_breakout")).toBe(true);
    expect(kinds.has("cb_mean_reversion")).toBe(false);
    expect(kinds.has("markov_persistence")).toBe(true);
  });
});
