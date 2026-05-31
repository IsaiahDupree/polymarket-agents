import { describe, expect, it } from "vitest";
import {
  decideOrder,
  type DecideOptions,
  type MarkovPersistencePayload,
} from "@/lib/strategies/markov-persistence-executor";

function basePayload(overrides: Partial<MarkovPersistencePayload> = {}): MarkovPersistencePayload {
  return {
    decision: "ENTER",
    tokenId: "TOK-1",
    conditionId: "COND-1",
    title: "BTC up",
    asset: "BTC",
    durationKind: "5M",
    side: "YES",
    marketPrice: 0.55,
    currentState: 5,
    persistence: 0.92,
    rawProbYes: 0.80,       // → Becker-calibrated would be ~0.82, but the payload
    calibratedProbYes: 0.82, // already encodes the calibrated value
    edge: 0.27,
    stepsToExpiry: 3,
    inferredFidelitySec: 60,
    expiryIso: new Date(Date.now() + 3 * 60_000).toISOString(),
    historySamples: 800,
    ...overrides,
  };
}

const baseOpts: DecideOptions = {
  opportunityId: 42,
  perSignalUsdCap: 25,
  remainingBudgetUsd: 100,
  kellyFraction: 0.25,
  venue: "sim",
  capsuleId: "markov-persistence",
  coidSuffix: () => "test1234",
};

describe("decideOrder — submit paths", () => {
  it("emits a LIMIT order for a YES-side ENTER (passes the maker-only gate naturally)", () => {
    const r = decideOrder(basePayload(), baseOpts);
    expect(r.kind).toBe("submit");
    if (r.kind === "submit") {
      expect(r.order.type).toBe("LIMIT");
      expect(r.order.limitPrice).toBeCloseTo(0.55, 6);
      expect(r.order.refPrice).toBeCloseTo(0.55, 6);
      expect(r.order.side).toBe("BUY");
      expect(r.order.symbol).toBe("TOK-1");
      expect(r.order.capsuleId).toBe("markov-persistence");
      expect(r.order.clientOrderId).toBe("markov-42-test1234");
      expect(r.order.metadata?.source).toBe("markov-persistence-exec");
      expect(r.order.metadata?.opportunityId).toBe(42);
      expect(r.order.metadata?.mpSide).toBe("YES");
      expect(r.order.metadata?.persistence).toBeCloseTo(0.92);
      // No allowTaker — order is LIMIT so gate #6 passes without opt-in.
      expect((r.order.metadata as any)?.allowTaker).toBeUndefined();
      // Bet size scales with edge, capped by per-signal $25, quarter-Kelly.
      expect(r.sizing.betUsd).toBeGreaterThan(0);
      expect(r.sizing.betUsd).toBeLessThanOrEqual(25);
    }
  });

  it("flips probabilities for a NO-side ENTER", () => {
    // YES calibrated = 0.20 → NO calibrated = 0.80. Market YES 0.45 → NO 0.55.
    // For NO side, pTrue=0.80, pMarket=0.55 → big edge.
    const payload = basePayload({
      side: "NO",
      marketPrice: 0.45,
      calibratedProbYes: 0.20,
      rawProbYes: 0.18,
    });
    const r = decideOrder(payload, baseOpts);
    expect(r.kind).toBe("submit");
    if (r.kind === "submit") {
      expect(r.sizing.pTrueUsed).toBeCloseTo(0.80, 6);
      expect(r.order.limitPrice).toBeCloseTo(0.45, 6);
    }
  });
});

describe("decideOrder — skip paths", () => {
  it("skips when pTrue is not strictly above pMarket (no edge for sizing)", () => {
    const payload = basePayload({ calibratedProbYes: 0.55, marketPrice: 0.55 });
    const r = decideOrder(payload, baseOpts);
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.reason).toContain("not > pMarket");
  });

  it("skips when remaining budget is zero", () => {
    const r = decideOrder(basePayload(), { ...baseOpts, remainingBudgetUsd: 0 });
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.reason).toBe("daily budget exhausted");
  });

  it("skips when computed bet is under min order size", () => {
    // Tiny edge → tiny Kelly → bet < $1.
    const payload = basePayload({
      calibratedProbYes: 0.551, // 0.1pp edge
      marketPrice: 0.55,
    });
    const r = decideOrder(payload, baseOpts);
    expect(r.kind).toBe("skip");
    if (r.kind === "skip") expect(r.reason).toMatch(/bet .* < min/);
  });

  it("skips on a NaN limit price (defensive guard)", () => {
    const r = decideOrder(basePayload({ marketPrice: Number.NaN, calibratedProbYes: 0.82 }), baseOpts);
    expect(r.kind).toBe("skip");
    // Either the pTrue>pMarket guard or the limit-price guard catches it; both are fine.
    if (r.kind === "skip") {
      const ok = r.reason.includes("bad limit price") || r.reason.includes("not > pMarket") || r.reason.includes("bet");
      expect(ok).toBe(true);
    }
  });

  it("caps bet to remaining budget when budget is tighter than Kelly", () => {
    // Large edge, but remaining budget = $2. Should clip to ~$2, not Kelly's ~$5.
    const r = decideOrder(basePayload(), { ...baseOpts, remainingBudgetUsd: 2 });
    expect(r.kind).toBe("submit");
    if (r.kind === "submit") {
      expect(r.sizing.betUsd).toBeLessThanOrEqual(2);
    }
  });
});
