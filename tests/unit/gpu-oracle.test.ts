/**
 * Unit tests for src/lib/arena/gpu-oracle.ts — pure logic only (ONNX
 * loading is not exercised here; that would require a real ONNX file
 * and is covered by the live smoke test in train/export_onnx.py).
 *
 * Coverage:
 *   - probabilityToSignal: BUY_YES / BUY_NO / HOLD threshold logic
 *   - probabilityToSignal: tie-breaking with market price
 *   - clearGpuOracleCache: cache invalidation surface for hot-reload
 */
import { describe, expect, it } from "vitest";
import { probabilityToSignal, clearGpuOracleCache } from "@/lib/arena/gpu-oracle";

const PARAMS = {
  threshold_buy_yes: 0.65,
  threshold_buy_no: 0.35,
  stake_usd: 2,
};

describe("probabilityToSignal — BUY_YES path", () => {
  it("emits BUY_YES when P >= threshold AND P > market price", () => {
    const sig = probabilityToSignal(0.72, 0.5, PARAMS, "mkt-1");
    expect(sig.action).toBe("BUY");
    if (sig.action !== "BUY") return;
    expect(sig.side).toBe("YES");
    expect(sig.market_id).toBe("mkt-1");
    expect(sig.size_usd).toBe(2);
    expect(sig.reason).toContain("P(YES)=0.720");
  });

  it("holds when P >= threshold but NOT > market price (no edge)", () => {
    const sig = probabilityToSignal(0.7, 0.75, PARAMS, "mkt-2");
    expect(sig.action).toBe("HOLD");
  });

  it("holds at exact threshold + exact market price (no strict gt)", () => {
    const sig = probabilityToSignal(0.65, 0.65, PARAMS, "mkt-x");
    expect(sig.action).toBe("HOLD");
  });
});

describe("probabilityToSignal — BUY_NO path", () => {
  it("emits BUY_NO when P <= threshold AND P < market price", () => {
    const sig = probabilityToSignal(0.25, 0.5, PARAMS, "mkt-3");
    expect(sig.action).toBe("BUY");
    if (sig.action !== "BUY") return;
    expect(sig.side).toBe("NO");
    expect(sig.size_usd).toBe(2);
    expect(sig.reason).toContain("P(YES)=0.250");
  });

  it("holds when P <= threshold but NOT < market price", () => {
    const sig = probabilityToSignal(0.30, 0.25, PARAMS, "mkt-4");
    expect(sig.action).toBe("HOLD");
  });

  it("holds at exact NO threshold + exact market price", () => {
    const sig = probabilityToSignal(0.35, 0.35, PARAMS, "mkt-y");
    expect(sig.action).toBe("HOLD");
  });
});

describe("probabilityToSignal — HOLD path", () => {
  it("holds in the middle range (no thresholds met)", () => {
    expect(probabilityToSignal(0.50, 0.50, PARAMS, "mkt-5").action).toBe("HOLD");
    expect(probabilityToSignal(0.55, 0.40, PARAMS, "mkt-5").action).toBe("HOLD");
    expect(probabilityToSignal(0.45, 0.55, PARAMS, "mkt-5").action).toBe("HOLD");
  });

  it("HOLD reason carries the predicted probability", () => {
    const sig = probabilityToSignal(0.503, 0.5, PARAMS, "mkt-5");
    expect(sig.action).toBe("HOLD");
    expect(sig.reason).toContain("0.503");
  });
});

describe("clearGpuOracleCache", () => {
  it("is callable and returns void", () => {
    // No models loaded → no-op, but should not throw
    expect(() => clearGpuOracleCache()).not.toThrow();
    // Second call also fine
    expect(() => clearGpuOracleCache()).not.toThrow();
  });
});

describe("probabilityToSignal — stake propagation", () => {
  it("uses the params.stake_usd as-is on BUY signals", () => {
    const custom = { ...PARAMS, stake_usd: 5 };
    const yesSig = probabilityToSignal(0.80, 0.5, custom, "x");
    const noSig = probabilityToSignal(0.20, 0.5, custom, "x");
    if (yesSig.action !== "BUY" || noSig.action !== "BUY") {
      throw new Error("expected BUY for both");
    }
    expect(yesSig.size_usd).toBe(5);
    expect(noSig.size_usd).toBe(5);
  });
});
