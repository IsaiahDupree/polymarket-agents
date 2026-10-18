import { describe, expect, it } from "vitest";
import {
  reconcileWalletPnl,
  summarizeReconciliation,
  type ActualPnl,
  type ReconciliationVerdict,
} from "@/lib/wallets/pnl-reconciliation";

function actual(pnl: number, vol = 1_000_000, rank?: number, name = "test"): ActualPnl {
  return { pnlUsd: pnl, volUsd: vol, rank, proxyWallet: "0xabc", userName: name };
}

describe("reconcileWalletPnl — outcome classification", () => {
  it("claim_supported when actual matches claim within ±15%", () => {
    const v = reconcileWalletPnl({
      handle: "kch123",
      claimedUsd: 12_000_000,
      actual: actual(11_590_000, 292_669_000, 3, "kch123"),
    });
    expect(v.outcome).toBe("claim_supported");
    expect(v.ratio).toBeCloseTo(11_590_000 / 12_000_000, 4);
    expect(v.deltaPct).toBeCloseTo(-3.4, 1);
  });

  it("claim_supported at the boundary (exactly -15%)", () => {
    const v = reconcileWalletPnl({
      handle: "x",
      claimedUsd: 1_000_000,
      actual: actual(850_000),
    });
    expect(v.outcome).toBe("claim_supported");
  });

  it("claim_inflated when actual < claim * 0.85", () => {
    const v = reconcileWalletPnl({
      handle: "exaggerator",
      claimedUsd: 5_000_000,
      actual: actual(1_000_000),
    });
    expect(v.outcome).toBe("claim_inflated");
    expect(v.deltaPct).toBeLessThan(-15);
    expect(v.rationale).toContain("below claim");
  });

  it("claim_understated when actual > claim * 1.15", () => {
    const v = reconcileWalletPnl({
      handle: "modest",
      claimedUsd: 1_000_000,
      actual: actual(2_500_000),
    });
    expect(v.outcome).toBe("claim_understated");
    expect(v.deltaPct).toBeGreaterThan(15);
    expect(v.rationale).toContain("above claim");
  });

  it("wallet_not_found when actual is null", () => {
    const v = reconcileWalletPnl({
      handle: "ghost",
      claimedUsd: 1_000_000,
      actual: null,
    });
    expect(v.outcome).toBe("wallet_not_found");
    expect(v.ratio).toBeNull();
    expect(v.deltaPct).toBeNull();
    expect(v.rationale).toContain("No leaderboard match");
  });

  it("claim_missing when actual exists but claim is null/zero", () => {
    const v = reconcileWalletPnl({
      handle: "unclaimed",
      claimedUsd: null,
      actual: actual(500_000),
    });
    expect(v.outcome).toBe("claim_missing");
    expect(v.rationale).toContain("did not state a claim");
  });

  it("claim_missing also when claim is 0", () => {
    const v = reconcileWalletPnl({
      handle: "zero",
      claimedUsd: 0,
      actual: actual(500_000),
    });
    expect(v.outcome).toBe("claim_missing");
  });
});

describe("reconcileWalletPnl — tolerance parameter", () => {
  it("respects a tighter tolerance (5%)", () => {
    const v = reconcileWalletPnl({
      handle: "x",
      claimedUsd: 1_000_000,
      actual: actual(900_000), // 10% below
      tolerance: 0.05,
    });
    expect(v.outcome).toBe("claim_inflated");
  });

  it("respects a looser tolerance (30%)", () => {
    const v = reconcileWalletPnl({
      handle: "x",
      claimedUsd: 1_000_000,
      actual: actual(750_000), // 25% below
      tolerance: 0.30,
    });
    expect(v.outcome).toBe("claim_supported");
  });
});

describe("reconcileWalletPnl — rationale format", () => {
  it("includes claim, actual, delta%, rank, and volume", () => {
    const v = reconcileWalletPnl({
      handle: "kch123",
      claimedUsd: 12_000_000,
      actual: actual(11_590_000, 292_669_000, 3),
    });
    expect(v.rationale).toContain("$12.00M");
    expect(v.rationale).toContain("$11.59M");
    expect(v.rationale).toContain("rank 3");
    expect(v.rationale).toContain("Volume $292.67M");
  });
});

describe("summarizeReconciliation — aggregate stats", () => {
  it("counts outcomes correctly", () => {
    const verdicts: ReconciliationVerdict[] = [
      { handle: "a", claimedUsd: 1_000_000, actual: actual(1_000_000), outcome: "claim_supported", ratio: 1, deltaPct: 0, rationale: "" },
      { handle: "b", claimedUsd: 5_000_000, actual: actual(1_000_000), outcome: "claim_inflated", ratio: 0.2, deltaPct: -80, rationale: "" },
      { handle: "c", claimedUsd: 100_000, actual: actual(500_000), outcome: "claim_understated", ratio: 5, deltaPct: 400, rationale: "" },
      { handle: "d", claimedUsd: 2_000_000, actual: null, outcome: "wallet_not_found", ratio: null, deltaPct: null, rationale: "" },
      { handle: "e", claimedUsd: 0, actual: actual(300_000), outcome: "claim_missing", ratio: null, deltaPct: null, rationale: "" },
    ];
    const s = summarizeReconciliation(verdicts);
    expect(s.totalWallets).toBe(5);
    expect(s.claimSupported).toBe(1);
    expect(s.claimInflated).toBe(1);
    expect(s.claimUnderstated).toBe(1);
    expect(s.walletNotFound).toBe(1);
    expect(s.claimMissing).toBe(1);
    expect(s.totalClaimedUsd).toBe(8_100_000); // 1M + 5M + 100K + 2M + 0
    expect(s.totalActualUsd).toBe(2_800_000); // 1M + 1M + 500K + 0 + 300K
  });

  it("aggregateRatio excludes unresolved + missing-claim wallets from the denominator", () => {
    const verdicts: ReconciliationVerdict[] = [
      { handle: "a", claimedUsd: 1_000_000, actual: actual(800_000), outcome: "claim_inflated", ratio: 0.8, deltaPct: -20, rationale: "" },
      { handle: "b", claimedUsd: 2_000_000, actual: null, outcome: "wallet_not_found", ratio: null, deltaPct: null, rationale: "" },
    ];
    const s = summarizeReconciliation(verdicts);
    // Numerator = actual sum = 800K; denominator = claims for resolved wallets only = 1M
    expect(s.aggregateRatio).toBeCloseTo(0.8, 3);
  });

  it("aggregateRatio is null when no resolved wallets had non-zero claims", () => {
    const verdicts: ReconciliationVerdict[] = [
      { handle: "a", claimedUsd: 1_000_000, actual: null, outcome: "wallet_not_found", ratio: null, deltaPct: null, rationale: "" },
    ];
    const s = summarizeReconciliation(verdicts);
    expect(s.aggregateRatio).toBeNull();
  });
});
