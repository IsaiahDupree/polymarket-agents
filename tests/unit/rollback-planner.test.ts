import { describe, expect, it } from "vitest";
import { planRollback, type ArbLeg, type LegFillResult } from "@/lib/arb/rollback-planner";

const yesLeg: ArbLeg = { tokenId: "TOK-YES", price: 0.30, shares: 100, sizeUsd: 30, label: "YES" };
const noLeg: ArbLeg = { tokenId: "TOK-NO", price: 0.30, shares: 100, sizeUsd: 30, label: "NO" };
const plan = { yesLeg, noLeg };

function fill(filled: boolean, filledShares?: number): LegFillResult {
  return { filled, filledShares };
}

describe("planRollback — clean cases (no_action)", () => {
  it("both legs fully filled → no_action", () => {
    const r = planRollback(plan, { yes: fill(true, 100), no: fill(true, 100) });
    expect(r.kind).toBe("no_action");
    if (r.kind === "no_action") expect(r.reason).toContain("both legs filled");
  });

  it("both legs unfilled → no_action", () => {
    const r = planRollback(plan, { yes: fill(false), no: fill(false) });
    expect(r.kind).toBe("no_action");
    if (r.kind === "no_action") expect(r.reason).toContain("neither leg filled");
  });

  it("matching partial fills (yes=80, no=80) → no_action", () => {
    const r = planRollback(plan, { yes: fill(true, 80), no: fill(true, 80) });
    expect(r.kind).toBe("no_action");
  });

  it("partial fills within 1 share of each other → no_action (rounding tolerance)", () => {
    const r = planRollback(plan, { yes: fill(true, 80), no: fill(true, 79.5) });
    expect(r.kind).toBe("no_action");
  });
});

describe("planRollback — single-leg unfilled (the article's failure mode)", () => {
  it("YES filled, NO failed → rollback YES", () => {
    const r = planRollback(plan, {
      yes: fill(true, 100),
      no: { filled: false, reason: "price moved to 0.78" },
    });
    expect(r.kind).toBe("rollback");
    if (r.kind === "rollback") {
      expect(r.closingLeg.tokenId).toBe("TOK-YES");
      expect(r.closingLeg.side).toBe("SELL");
      expect(r.closingLeg.shares).toBe(100);
      expect(r.closingLeg.label).toContain("close-YES");
      expect(r.originalLeg).toBe(yesLeg);
      expect(r.estimatedLossUsd).toBeGreaterThan(0);
      // 100 × $0.30 spent → recover ~50% → loss ~$15
      expect(r.estimatedLossUsd).toBeCloseTo(15, 2);
    }
  });

  it("NO filled, YES failed → rollback NO", () => {
    const r = planRollback(plan, {
      yes: fill(false, 0),
      no: fill(true, 100),
    });
    expect(r.kind).toBe("rollback");
    if (r.kind === "rollback") {
      expect(r.closingLeg.tokenId).toBe("TOK-NO");
      expect(r.closingLeg.shares).toBe(100);
    }
  });

  it("uses actual filled shares (not requested) for partial single-side fills", () => {
    const r = planRollback(plan, {
      yes: fill(true, 47),
      no: { filled: false },
    });
    expect(r.kind).toBe("rollback");
    if (r.kind === "rollback") expect(r.closingLeg.shares).toBe(47);
  });
});

describe("planRollback — mismatched partials (rebalance)", () => {
  it("yes=100, no=60 → close 40 shares of YES to balance at 60", () => {
    const r = planRollback(plan, { yes: fill(true, 100), no: fill(true, 60) });
    expect(r.kind).toBe("rollback");
    if (r.kind === "rollback") {
      expect(r.closingLeg.tokenId).toBe("TOK-YES");
      expect(r.closingLeg.shares).toBe(40);
      expect(r.closingLeg.label).toContain("rebalance-YES");
    }
  });

  it("yes=30, no=100 → close 70 shares of NO to balance at 30", () => {
    const r = planRollback(plan, { yes: fill(true, 30), no: fill(true, 100) });
    expect(r.kind).toBe("rollback");
    if (r.kind === "rollback") {
      expect(r.closingLeg.tokenId).toBe("TOK-NO");
      expect(r.closingLeg.shares).toBe(70);
    }
  });
});

describe("planRollback — defensive shape handling", () => {
  it("filled=true but missing filledShares → defaults to requested shares", () => {
    // adapter sometimes returns success without share count
    const r = planRollback(plan, {
      yes: { filled: true },
      no: { filled: false },
    });
    expect(r.kind).toBe("rollback");
    if (r.kind === "rollback") expect(r.closingLeg.shares).toBe(100); // = yesLeg.shares
  });
});
