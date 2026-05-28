/**
 * Tests for the late-window-scalp detector.
 *
 * Mirrors the operator's manual winning pattern: buy heavily-favored side
 * (ask ≥ $0.85) in last 1-3 min of a 5m binary.
 */
import { describe, expect, it } from "vitest";
import {
  detectLateWindowScalp,
  type BinaryBookSnapshot,
} from "@/lib/strategies/late-window-scalp";

const NOW = Date.parse("2026-05-28T05:00:00Z");
const PLUS_90_SEC = NOW + 90_000;

function snap(over: Partial<BinaryBookSnapshot> = {}): BinaryBookSnapshot {
  return {
    conditionId: "0xCOND",
    title: "BTC Up or Down 5m",
    asset: "BTC",
    windowCloseMs: PLUS_90_SEC,
    nowMs: NOW,
    upBestAsk: 0.92,    // heavily favored UP
    downBestAsk: 0.08,
    upDepthUsd: 10,
    downDepthUsd: 10,
    ...over,
  };
}

describe("detectLateWindowScalp — happy path", () => {
  it("fires when favored side ≥0.85, time + depth fine", () => {
    const op = detectLateWindowScalp(snap());
    expect(op).not.toBeNull();
    expect(op!.side).toBe("UP");
    expect(op!.entry_price).toBe(0.92);
    expect(op!.payoff_per_share).toBeCloseTo(0.08 - 0.002, 4); // 1-0.92 - fee
    expect(op!.max_shares).toBeGreaterThan(0);
    expect(op!.capital_required_usd).toBeGreaterThan(0);
    expect(op!.reason).toMatch(/BTC UP/);
  });

  it("picks the side with higher ask as the favored side", () => {
    const up = detectLateWindowScalp(snap({ upBestAsk: 0.92, downBestAsk: 0.08 }));
    expect(up!.side).toBe("UP");
    const down = detectLateWindowScalp(snap({ upBestAsk: 0.08, downBestAsk: 0.92 }));
    expect(down!.side).toBe("DOWN");
    expect(down!.entry_price).toBe(0.92);
  });

  it("reports max payoff = max_shares × payoff_per_share", () => {
    const op = detectLateWindowScalp(snap({ upDepthUsd: 100, downDepthUsd: 100 }))!;
    expect(op.max_payoff_usd).toBeCloseTo(op.max_shares * op.payoff_per_share, 2);
  });
});

describe("detectLateWindowScalp — gates", () => {
  it("rejects when favored ask below minAsk (default 0.85)", () => {
    // gap 0.50 (>0.30 tieThreshold) but favored is only 0.75
    expect(detectLateWindowScalp(snap({ upBestAsk: 0.75, downBestAsk: 0.25 }))).toBeNull();
  });

  it("rejects when favored ask above maxAsk (default 0.98) — no profit room", () => {
    expect(detectLateWindowScalp(snap({ upBestAsk: 0.99, downBestAsk: 0.01 }))).toBeNull();
  });

  it("rejects when time-remaining below min (default 30s)", () => {
    expect(detectLateWindowScalp(snap({ windowCloseMs: NOW + 20_000 }))).toBeNull();
  });

  it("rejects when time-remaining above max (default 180s)", () => {
    expect(detectLateWindowScalp(snap({ windowCloseMs: NOW + 200_000 }))).toBeNull();
  });

  it("rejects when depth on chosen side below min (default $2)", () => {
    expect(detectLateWindowScalp(snap({ upDepthUsd: 1.0 }))).toBeNull();
  });

  it("rejects when sides too close (no clear favorite)", () => {
    // gap 0.20 < 0.30 default
    expect(detectLateWindowScalp(snap({ upBestAsk: 0.55, downBestAsk: 0.35 }))).toBeNull();
  });

  it("rejects when payoff/share below min (default $0.02)", () => {
    // entry 0.97 + fee 0.002 = 0.972; payoff 0.028 ≥ 0.02 — fires
    expect(detectLateWindowScalp(snap({ upBestAsk: 0.97, downBestAsk: 0.03 }))).not.toBeNull();
    // entry 0.98 → payoff 0.018 < 0.02 — rejected
    expect(detectLateWindowScalp(snap({ upBestAsk: 0.98, downBestAsk: 0.02 }))).toBeNull();
  });
});

describe("detectLateWindowScalp — custom options", () => {
  it("custom minAsk loosens the threshold", () => {
    // 0.75 favored — rejected at default 0.85, accepted at 0.70
    expect(detectLateWindowScalp(snap({ upBestAsk: 0.75, downBestAsk: 0.25 }), { minAsk: 0.70 })).not.toBeNull();
  });

  it("custom maxRemainingSec extends the entry window", () => {
    // 4 min remaining — rejected at default 180s, accepted at 300s
    expect(detectLateWindowScalp(snap({ windowCloseMs: NOW + 240_000 }), { maxRemainingSec: 300 })).not.toBeNull();
  });

  it("custom feeBps reduces payoff/share", () => {
    const cheap = detectLateWindowScalp(snap(), { feeBps: 0 });
    const expensive = detectLateWindowScalp(snap(), { feeBps: 100 });
    expect(cheap!.payoff_per_share).toBeGreaterThan(expensive!.payoff_per_share);
  });
});

describe("detectLateWindowScalp — invalid input", () => {
  it("rejects NaN / out-of-range prices", () => {
    expect(detectLateWindowScalp(snap({ upBestAsk: NaN }))).toBeNull();
    expect(detectLateWindowScalp(snap({ upBestAsk: 0 }))).toBeNull();
    expect(detectLateWindowScalp(snap({ downBestAsk: 1.5 }))).toBeNull();
  });

  it("rejects expired market", () => {
    expect(detectLateWindowScalp(snap({ windowCloseMs: NOW - 1 }))).toBeNull();
  });

  it("rejects on NaN depth", () => {
    expect(detectLateWindowScalp(snap({ upDepthUsd: NaN }))).toBeNull();
  });
});

describe("detectLateWindowScalp — output payload", () => {
  it("implied_breakeven_win_rate equals entry_price", () => {
    const op = detectLateWindowScalp(snap({ upBestAsk: 0.90 }))!;
    expect(op.implied_breakeven_win_rate).toBeCloseTo(0.90, 4);
  });

  it("reason mentions side, asset, payoff", () => {
    const op = detectLateWindowScalp(snap())!;
    expect(op.reason).toMatch(/UP/);
    expect(op.reason).toMatch(/BTC/);
    expect(op.reason).toMatch(/payoff/);
    expect(op.reason).toMatch(/break.?even|EV/i);
  });

  it("max_shares is integer", () => {
    const op = detectLateWindowScalp(snap())!;
    expect(Number.isInteger(op.max_shares)).toBe(true);
  });
});
