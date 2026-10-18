/**
 * Unit tests for src/lib/quant/ofi.ts — the Cont-Kukanov-Stoikov OFI port.
 */
import { describe, expect, it } from "vitest";

import {
  OFICalculator,
  runOfiOverHistory,
  normalizeOfi,
  type TopOfBookSample,
} from "@/lib/quant/ofi";

// ---------------------------------------------------------------------------
// Class behavior

describe("OFICalculator", () => {
  it("returns 0 on the first update (no prior event to compare)", () => {
    const c = new OFICalculator(1);
    expect(c.update(0, 0.50, 100, 0.51, 100)).toBe(0);
    expect(c.eventCount()).toBe(0);
  });

  it("bid price IMPROVING adds the new bid size to OFI", () => {
    const c = new OFICalculator(10);
    c.update(0, 0.50, 100, 0.51, 50);
    // bid improves from 0.50 → 0.51, ask stays the same.
    // eBid = +new_bid_size = +200
    // eAsk = -(new_ask_size - prev_ask_size) = -(50 - 50) = 0
    const ofi = c.update(1, 0.51, 200, 0.51, 50);
    expect(ofi).toBe(200);
  });

  it("bid price WORSENING subtracts the prev bid size from OFI", () => {
    const c = new OFICalculator(10);
    c.update(0, 0.50, 100, 0.51, 50);
    // bid drops from 0.50 → 0.49 → eBid = -prev_bid_size = -100. Ask stays.
    const ofi = c.update(1, 0.49, 80, 0.51, 50);
    expect(ofi).toBe(-100);
  });

  it("ask price IMPROVING (falling) is a NEGATIVE event", () => {
    const c = new OFICalculator(10);
    c.update(0, 0.50, 100, 0.51, 50);
    // Ask falls 0.51 → 0.50 (improves for buyers). eAsk = -new_ask_size = -80.
    // bid same so eBid = bid_now − bid_prev = 0.
    const ofi = c.update(1, 0.50, 100, 0.50, 80);
    expect(ofi).toBe(-80);
  });

  it("same-price refresh: eBid = bid_now − bid_prev", () => {
    const c = new OFICalculator(10);
    c.update(0, 0.50, 100, 0.51, 50);
    // Bid stays at 0.50 but size grows 100 → 150. eBid = +50.
    // Ask unchanged 0.51 same size 50. eAsk = -(50 - 50) = 0.
    const ofi = c.update(1, 0.50, 150, 0.51, 50);
    expect(ofi).toBe(50);
  });

  it("rolling window evicts events older than windowSec", () => {
    const c = new OFICalculator(1);  // 1-second window
    c.update(0, 0.50, 100, 0.51, 50);
    c.update(0.5, 0.51, 200, 0.51, 50);  // OFI = +200
    expect(c.value()).toBe(200);
    // Push time forward beyond the window — the +200 event should drop.
    c.update(2.0, 0.51, 200, 0.51, 50);  // OFI = current event only (0, no change)
    expect(c.eventCount()).toBe(1);
  });

  it("value() reports the same as the final update() return", () => {
    const c = new OFICalculator(10);
    c.update(0, 0.50, 100, 0.51, 50);
    const ofi = c.update(1, 0.51, 200, 0.51, 50);
    expect(c.value()).toBe(ofi);
  });
});

// ---------------------------------------------------------------------------
// runOfiOverHistory

describe("runOfiOverHistory", () => {
  const sample = (ts: number, bidPx: number, bidSz: number, askPx: number, askSz: number): TopOfBookSample => ({
    ts, bidPx, bidSz, askPx, askSz,
  });

  it("returns 0 for <2 samples (no event possible)", () => {
    expect(runOfiOverHistory([])).toBe(0);
    expect(runOfiOverHistory([sample(0, 0.5, 100, 0.51, 50)])).toBe(0);
  });

  it("returns the same value as feeding a fresh calculator manually", () => {
    const hist = [
      sample(0, 0.50, 100, 0.51, 50),
      sample(0.5, 0.51, 200, 0.51, 50),
      sample(0.8, 0.51, 250, 0.51, 50),
    ];
    const c = new OFICalculator(10);
    let manual = 0;
    for (const s of hist) manual = c.update(s.ts, s.bidPx, s.bidSz, s.askPx, s.askSz);
    expect(runOfiOverHistory(hist, 10)).toBe(manual);
  });

  it("honors the windowSec argument (different windows → different OFI)", () => {
    const hist = [
      sample(0, 0.50, 100, 0.51, 50),
      sample(0.5, 0.51, 200, 0.51, 50),  // +200
      sample(2.0, 0.51, 200, 0.51, 50),  // 0
    ];
    expect(runOfiOverHistory(hist, 10)).toBe(200);  // wide window keeps both events
    expect(runOfiOverHistory(hist, 1)).toBe(0);     // narrow window drops first
  });
});

// ---------------------------------------------------------------------------
// normalizeOfi

describe("normalizeOfi", () => {
  it("returns 0 when scaleSize <= 0", () => {
    expect(normalizeOfi(100, 0)).toBe(0);
    expect(normalizeOfi(100, -50)).toBe(0);
  });

  it("returns ofi/scale within bounds", () => {
    expect(normalizeOfi(50, 100)).toBe(0.5);
    expect(normalizeOfi(-25, 100)).toBe(-0.25);
  });

  it("saturates to ±1 when |ofi| exceeds scaleSize", () => {
    expect(normalizeOfi(500, 100)).toBe(1);
    expect(normalizeOfi(-9999, 100)).toBe(-1);
  });

  it("handles ofi = 0 cleanly", () => {
    expect(normalizeOfi(0, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-check: bullish vs bearish sequences

describe("OFI bullish vs bearish sequences", () => {
  it("a steadily-improving bid produces strongly POSITIVE OFI", () => {
    const c = new OFICalculator(100);
    c.update(0, 0.50, 100, 0.55, 100);
    c.update(1, 0.51, 100, 0.55, 100);
    c.update(2, 0.52, 100, 0.55, 100);
    c.update(3, 0.53, 100, 0.55, 100);
    expect(c.value()).toBeGreaterThan(0);
  });

  it("a steadily-improving ask (falling) produces NEGATIVE OFI", () => {
    const c = new OFICalculator(100);
    c.update(0, 0.45, 100, 0.50, 100);
    c.update(1, 0.45, 100, 0.49, 100);
    c.update(2, 0.45, 100, 0.48, 100);
    c.update(3, 0.45, 100, 0.47, 100);
    expect(c.value()).toBeLessThan(0);
  });

  it("a no-op sequence keeps OFI at 0", () => {
    const c = new OFICalculator(100);
    c.update(0, 0.50, 100, 0.51, 100);
    c.update(1, 0.50, 100, 0.51, 100);
    c.update(2, 0.50, 100, 0.51, 100);
    expect(c.value()).toBe(0);
  });
});
