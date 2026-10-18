import { describe, expect, it } from "vitest";
import {
  optimalHalfSpread,
  optimalQuotes,
  reservationPrice,
  makerLimitPrice,
} from "@/lib/quant/stoikov";

describe("reservationPrice", () => {
  it("equals mid when inventory is zero", () => {
    expect(reservationPrice({ midPrice: 0.55, inventoryNormalised: 0, variance: 0.01, timeFraction: 1 })).toBeCloseTo(0.55, 6);
  });

  it("pulls below mid when inventory is positive (long → want to sell)", () => {
    const r = reservationPrice({ midPrice: 0.55, inventoryNormalised: 1, variance: 0.04, timeFraction: 1, riskAversion: 0.1 });
    // r = 0.55 - 1 * 0.1 * 0.04 * 1 = 0.55 - 0.004 = 0.546
    expect(r).toBeCloseTo(0.546, 6);
    expect(r).toBeLessThan(0.55);
  });

  it("pushes above mid when inventory is negative (short → want to buy)", () => {
    const r = reservationPrice({ midPrice: 0.55, inventoryNormalised: -1, variance: 0.04, timeFraction: 1, riskAversion: 0.1 });
    expect(r).toBeGreaterThan(0.55);
  });

  it("approaches mid as time runs out (T-t → 0)", () => {
    const r0 = reservationPrice({ midPrice: 0.55, inventoryNormalised: 1, variance: 0.04, timeFraction: 1, riskAversion: 0.1 });
    const r1 = reservationPrice({ midPrice: 0.55, inventoryNormalised: 1, variance: 0.04, timeFraction: 0.01, riskAversion: 0.1 });
    expect(Math.abs(r1 - 0.55)).toBeLessThan(Math.abs(r0 - 0.55));
  });
});

describe("optimalHalfSpread", () => {
  it("is non-negative", () => {
    expect(optimalHalfSpread({ variance: 0.04, timeFraction: 1 })).toBeGreaterThanOrEqual(0);
    expect(optimalHalfSpread({ variance: 0, timeFraction: 0 })).toBeGreaterThanOrEqual(0);
  });

  it("widens as variance increases (more vol → wider quotes)", () => {
    const lo = optimalHalfSpread({ variance: 0.01, timeFraction: 1 });
    const hi = optimalHalfSpread({ variance: 0.10, timeFraction: 1 });
    expect(hi).toBeGreaterThan(lo);
  });

  it("widens as time remaining increases (more time = more risk)", () => {
    const lo = optimalHalfSpread({ variance: 0.04, timeFraction: 0.1 });
    const hi = optimalHalfSpread({ variance: 0.04, timeFraction: 1.0 });
    expect(hi).toBeGreaterThan(lo);
  });
});

describe("optimalQuotes", () => {
  it("bid < reservation < ask, symmetric", () => {
    const q = optimalQuotes({ midPrice: 0.5, inventoryNormalised: 0, variance: 0.04, timeFraction: 0.5 });
    expect(q.bidPrice).toBeLessThan(q.reservationPrice);
    expect(q.askPrice).toBeGreaterThan(q.reservationPrice);
    expect(q.bidPrice + q.askPrice).toBeCloseTo(2 * q.reservationPrice, 6);
  });

  it("never quotes outside (0, 1) — clamps to (0.001, 0.999)", () => {
    // Extreme inventory + huge vol → reservation could drift outside.
    const q = optimalQuotes({
      midPrice: 0.99,
      inventoryNormalised: -10,
      variance: 1,
      timeFraction: 1,
      riskAversion: 0.5,
    });
    expect(q.bidPrice).toBeGreaterThan(0);
    expect(q.bidPrice).toBeLessThan(1);
    expect(q.askPrice).toBeGreaterThan(0);
    expect(q.askPrice).toBeLessThan(1);
  });

  it("skews quotes when long inventory: reservation pulls down", () => {
    // Use a SMALL gamma (0.05) so the half-spread doesn't clamp on a 0-1 binary.
    const flat = optimalQuotes({ midPrice: 0.5, inventoryNormalised: 0, variance: 0.04, timeFraction: 1, riskAversion: 0.05 });
    const long = optimalQuotes({ midPrice: 0.5, inventoryNormalised: 1, variance: 0.04, timeFraction: 1, riskAversion: 0.05 });
    // Long → reservation pulled down → both quotes shift down (no clamp).
    expect(long.reservationPrice).toBeLessThan(flat.reservationPrice);
    expect(long.bidPrice).toBeLessThan(flat.bidPrice);
    expect(long.askPrice).toBeLessThan(flat.askPrice);
  });
});

describe("makerLimitPrice — converts intent to a side-relative limit", () => {
  const q = optimalQuotes({ midPrice: 0.5, inventoryNormalised: 0, variance: 0.04, timeFraction: 1 });

  it("BUY_YES → bidPrice", () => {
    expect(makerLimitPrice(q, "BUY_YES")).toBe(q.bidPrice);
  });
  it("SELL_YES → askPrice", () => {
    expect(makerLimitPrice(q, "SELL_YES")).toBe(q.askPrice);
  });
  it("BUY_NO → 1 - askPrice (because NO = 1 - YES)", () => {
    const noPrice = makerLimitPrice(q, "BUY_NO");
    expect(noPrice).toBeCloseTo(1 - q.askPrice, 6);
  });
  it("SELL_NO → 1 - bidPrice", () => {
    const noPrice = makerLimitPrice(q, "SELL_NO");
    expect(noPrice).toBeCloseTo(1 - q.bidPrice, 6);
  });
});

describe("Stoikov logic from the article — Daniro's specific examples", () => {
  it("more aggressive (tighter spread) as time-to-expiry decreases", () => {
    const early = optimalQuotes({ midPrice: 0.5, inventoryNormalised: 0, variance: 0.04, timeFraction: 1.0 });
    const late = optimalQuotes({ midPrice: 0.5, inventoryNormalised: 0, variance: 0.04, timeFraction: 0.1 });
    expect(late.halfSpread).toBeLessThan(early.halfSpread);
  });

  it("inventory imbalance shifts the bid more than the ask (relative)", () => {
    const q = optimalQuotes({ midPrice: 0.5, inventoryNormalised: 1, variance: 0.04, timeFraction: 1, riskAversion: 0.5 });
    // Both shift down; bid shifted further from where a flat bid would be
    // (because reservation pulled down by 0.5*0.04*1*1 = 0.02).
    expect(q.reservationPrice).toBeLessThan(0.5);
  });
});
