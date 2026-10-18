import { describe, expect, it } from "vitest";
import {
  evaluateMarketWithClaude,
  type ClaudeProbMarket,
} from "@/lib/strategies/claude-probability-scanner";
import type { ProbabilityVerdict } from "@/lib/agents/probability-brain";

const market: ClaudeProbMarket = {
  tokenId: "TOK-1",
  conditionId: "COND-1",
  title: "Will the Fed cut rates next meeting?",
  currentPrice: 0.42,
  asset: "MACRO",
  category: "economics",
};

function verdict(p: number, c: "high" | "medium" | "low" = "medium"): ProbabilityVerdict {
  return { probability: p, confidence: c, rationale: "test", model: "claude-haiku-4-5" };
}

describe("evaluateMarketWithClaude — PASS paths", () => {
  it("low_confidence when brain is uncertain (default floor = medium)", () => {
    const r = evaluateMarketWithClaude(market, verdict(0.65, "low"));
    expect(r.decision).toBe("PASS");
    if (r.decision === "PASS") expect(r.reason).toBe("low_confidence");
  });

  it("respects custom minConfidence (allow low through)", () => {
    const r = evaluateMarketWithClaude(market, verdict(0.65, "low"), { minConfidence: "low" });
    expect(r.decision).toBe("ENTER"); // 0.65 vs 0.42 = 0.23 edge after calibration
  });

  it("edge_below_threshold when calibrated edge is tiny", () => {
    // calibrated(0.45) ≈ 0.45 + tiny adjustment; market 0.44 → edge < 5%
    const r = evaluateMarketWithClaude({ ...market, currentPrice: 0.44 }, verdict(0.45));
    expect(r.decision).toBe("PASS");
    if (r.decision === "PASS") expect(r.reason).toBe("edge_below_threshold");
  });

  it("bad_market_price when price is 0 or 1", () => {
    expect(evaluateMarketWithClaude({ ...market, currentPrice: 0 }, verdict(0.5)).decision).toBe("PASS");
    expect(evaluateMarketWithClaude({ ...market, currentPrice: 1 }, verdict(0.5)).decision).toBe("PASS");
  });
});

describe("evaluateMarketWithClaude — ENTER paths", () => {
  it("YES side when calibrated prob > market price by ≥ minEdge", () => {
    // Brain 0.65, market 0.42 → calibrated ≈ 0.715 → edge ~0.30 > 5%.
    const r = evaluateMarketWithClaude(market, verdict(0.65, "medium"));
    expect(r.decision).toBe("ENTER");
    if (r.decision === "ENTER") {
      expect(r.side).toBe("YES");
      expect(r.edge).toBeGreaterThanOrEqual(0.05);
      expect(r.calibratedProbYes).toBeGreaterThan(r.marketPrice);
      expect(r.title).toContain("Fed");
      expect(r.model).toBe("claude-haiku-4-5");
    }
  });

  it("NO side when calibrated prob < market price by ≥ minEdge", () => {
    // Brain 0.20, market 0.50 → calibrated ≈ 0.181 → edge ~-0.32.
    const r = evaluateMarketWithClaude({ ...market, currentPrice: 0.50 }, verdict(0.20, "high"));
    expect(r.decision).toBe("ENTER");
    if (r.decision === "ENTER") {
      expect(r.side).toBe("NO");
      expect(r.edge).toBeLessThan(0);
    }
  });

  it("passes through rationale + model + confidence", () => {
    const v: ProbabilityVerdict = {
      probability: 0.7,
      confidence: "high",
      rationale: "Strong base rate signal",
      model: "claude-haiku-4-5",
    };
    const r = evaluateMarketWithClaude(market, v);
    expect(r.decision).toBe("ENTER");
    if (r.decision === "ENTER") {
      expect(r.confidence).toBe("high");
      expect(r.rationale).toBe("Strong base rate signal");
    }
  });
});

describe("evaluateMarketWithClaude — custom minEdge", () => {
  it("respects a stricter minEdge", () => {
    // Brain 0.55, market 0.50 → calibrated ≈ 0.50 → edge ~0 (well below 10%)
    const r = evaluateMarketWithClaude({ ...market, currentPrice: 0.50 }, verdict(0.55), { minEdge: 0.10 });
    expect(r.decision).toBe("PASS");
    if (r.decision === "PASS") expect(r.reason).toBe("edge_below_threshold");
  });
});
