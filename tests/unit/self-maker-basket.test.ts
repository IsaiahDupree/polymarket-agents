import { describe, expect, it } from "vitest";
import {
  deriveBidPrice,
  detectSelfMakerOpportunity,
  type BinaryBookSnapshot,
} from "@/lib/strategies/self-maker-basket";

const NOW = 1_700_000_000_000;
const TOMORROW = NOW + 86_400_000;

function book(over: Partial<BinaryBookSnapshot> = {}): BinaryBookSnapshot {
  return {
    conditionId: "test-cond",
    title: "BTC up?",
    yesBids: [{ price: 0.30, sizeUsd: 100 }],
    yesAsks: [{ price: 0.40, sizeUsd: 100 }],
    noBids: [{ price: 0.30, sizeUsd: 100 }],
    noAsks: [{ price: 0.40, sizeUsd: 100 }],
    windowCloseMs: TOMORROW,
    nowMs: NOW,
    feeBps: 0, // simplify default tests
    ...over,
  };
}

describe("deriveBidPrice", () => {
  it("places at midpoint when aggressiveness = 0.5", () => {
    expect(deriveBidPrice(0.30, 0.40, 0.01, 0.5)).toBeCloseTo(0.35, 6);
  });

  it("places near best bid when aggressiveness = 0", () => {
    // Snaps to bestBid + tick at fraction 0
    expect(deriveBidPrice(0.30, 0.40, 0.01, 0)).toBeCloseTo(0.31, 6);
  });

  it("places near best ask when aggressiveness = 1", () => {
    expect(deriveBidPrice(0.30, 0.40, 0.01, 1)).toBeCloseTo(0.39, 6);
  });

  it("snaps to tick grid", () => {
    expect(deriveBidPrice(0.30, 0.40, 0.05, 0.5)).toBeCloseTo(0.35, 6);
    expect(deriveBidPrice(0.30, 0.41, 0.01, 0.5)).toBeCloseTo(0.36, 6);
  });

  it("returns NaN when ask ≤ bid (crossed or empty book)", () => {
    expect(Number.isNaN(deriveBidPrice(0.40, 0.30, 0.01, 0.5))).toBe(true);
    expect(Number.isNaN(deriveBidPrice(0.5, 0.5, 0.01, 0.5))).toBe(true);
  });
});

describe("detectSelfMakerOpportunity — ENTER paths", () => {
  it("emits an opportunity when bid pair sums to < $1 - minEdge", () => {
    // YES bid 0.35, NO bid 0.35 → combined 0.70 → net edge 0.30 > 0.02
    const r = detectSelfMakerOpportunity(book());
    expect(r).not.toBeNull();
    if (r) {
      expect(r.yesBidPrice).toBeCloseTo(0.35, 6);
      expect(r.noBidPrice).toBeCloseTo(0.35, 6);
      expect(r.combinedBidCost).toBeCloseTo(0.70, 6);
      expect(r.netEdgePerPair).toBeCloseTo(0.30, 6);
      expect(r.maxPairs).toBeGreaterThan(0);
      expect(r.netProfitUsd).toBeGreaterThan(0);
    }
  });

  it("accounts for fees in the edge calc", () => {
    const r = detectSelfMakerOpportunity(book({ feeBps: 100 })); // 1% per leg
    expect(r).not.toBeNull();
    if (r) {
      // combined 0.70 → fee 0.007 → edge 0.293
      expect(r.netEdgePerPair).toBeCloseTo(0.293, 3);
    }
  });

  it("computes annualised yield correctly", () => {
    // 1-day-out, combined 0.70 + 0 fee, payoff $1 → 30¢ profit / 70¢ cost = ~42.9% yield × 365 days
    const r = detectSelfMakerOpportunity(book());
    expect(r).not.toBeNull();
    if (r) {
      const expectedYield = (0.30 / 0.70) * 365;
      expect(r.expectedAnnualizedYield).toBeCloseTo(expectedYield, 1);
    }
  });

  it("caps pairs at the smaller of the two book sides' depth", () => {
    const r = detectSelfMakerOpportunity(
      book({
        yesAsks: [{ price: 0.40, sizeUsd: 50 }],
        noAsks: [{ price: 0.40, sizeUsd: 200 }],
      }),
    );
    expect(r).not.toBeNull();
    if (r) {
      // fillable = min(50, 200, 25 default cap) = 25
      // pairs = floor(25 / max(0.35, 0.35)) = floor(71.4) = 71
      expect(r.maxPairs).toBeLessThanOrEqual(72);
    }
  });
});

describe("detectSelfMakerOpportunity — REFUSE paths", () => {
  it("returns null when combined bid pair has edge below the default 2¢ minimum", () => {
    // Bid 0.49 / Ask 0.50 → our snapped bid lands at 0.49, both sides → combined 0.98,
    // edge 0.02 = minEdge. Bump the minEdge above that to verify rejection.
    const r = detectSelfMakerOpportunity(
      book({
        yesBids: [{ price: 0.49, sizeUsd: 100 }],
        yesAsks: [{ price: 0.50, sizeUsd: 100 }],
        noBids: [{ price: 0.49, sizeUsd: 100 }],
        noAsks: [{ price: 0.50, sizeUsd: 100 }],
      }),
      { minNetEdgePerPair: 0.05 },
    );
    expect(r).toBeNull();
  });

  it("returns null when expiry is within minDaysToExpiry", () => {
    const r = detectSelfMakerOpportunity(book({ windowCloseMs: NOW + 5 * 60_000 }));
    expect(r).toBeNull();
  });

  it("returns null when the market is closed (expiry in past)", () => {
    const r = detectSelfMakerOpportunity(book({ windowCloseMs: NOW - 1000 }));
    expect(r).toBeNull();
  });

  it("returns null on empty book on either side", () => {
    expect(detectSelfMakerOpportunity(book({ yesAsks: [] }))).toBeNull();
    expect(detectSelfMakerOpportunity(book({ noBids: [] }))).toBeNull();
  });

  it("returns null when an ask is ≥ 1 (degenerate book)", () => {
    expect(detectSelfMakerOpportunity(book({ yesAsks: [{ price: 1.01, sizeUsd: 100 }] }))).toBeNull();
  });

  it("respects custom minNetEdgePerPair", () => {
    // Default emits the 30¢-edge opp; bump min to 40¢ and it should refuse.
    expect(
      detectSelfMakerOpportunity(book(), { minNetEdgePerPair: 0.40 }),
    ).toBeNull();
  });

  it("returns null when there's no fillable depth (book is one-sided)", () => {
    expect(
      detectSelfMakerOpportunity(
        book({
          yesAsks: [{ price: 0.40, sizeUsd: 0 }],
          noAsks: [{ price: 0.40, sizeUsd: 0 }],
        }),
      ),
    ).toBeNull();
  });
});

describe("detectSelfMakerOpportunity — option overrides", () => {
  it("respects custom maxUsdPerPair cap", () => {
    const r1 = detectSelfMakerOpportunity(book(), { maxUsdPerPair: 10 });
    const r2 = detectSelfMakerOpportunity(book(), { maxUsdPerPair: 100 });
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    if (r1 && r2) {
      expect(r2.maxPairs).toBeGreaterThanOrEqual(r1.maxPairs);
    }
  });

  it("respects custom tickSize", () => {
    const r = detectSelfMakerOpportunity(book(), { tickSize: 0.05 });
    expect(r).not.toBeNull();
    if (r) {
      // 0.35 lands on the 0.05 tick grid; both should be 0.35
      expect(r.yesBidPrice).toBeCloseTo(0.35, 6);
    }
  });

  it("respects custom bidAggressivenessFraction", () => {
    // 0 aggressiveness → place at bestBid + tick = 0.31
    const r = detectSelfMakerOpportunity(book(), { bidAggressivenessFraction: 0 });
    expect(r).not.toBeNull();
    if (r) {
      expect(r.yesBidPrice).toBeCloseTo(0.31, 6);
      expect(r.noBidPrice).toBeCloseTo(0.31, 6);
      expect(r.combinedBidCost).toBeCloseTo(0.62, 6);
    }
  });
});
