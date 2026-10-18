/**
 * Unit tests for src/lib/quant/microstructure.ts — TS port of
 * polymarket-2dollar-bot/polybot/microstructure.py. Same test shape:
 * pure functions, no DB, deterministic.
 */
import { describe, expect, it } from "vitest";

import {
  arbitrageEdge,
  directionalArbTilt,
  nearResolutionEdge,
  orderbookImbalance,
  repricingEdge,
} from "@/lib/quant/microstructure";

// ---------------------------------------------------------------------------
// arbitrageEdge

describe("arbitrageEdge", () => {
  it("returns null when YES + NO >= $1 (no free profit)", () => {
    expect(arbitrageEdge(0.55, 0.50)).toBeNull();
    expect(arbitrageEdge(0.50, 0.50)).toBeNull();
  });

  it("returns opportunity when YES + NO < $1 by min_edge", () => {
    // 0.40 + 0.50 = 0.90 → profit 0.10 → edge 0.10/0.90 ≈ 0.111
    const op = arbitrageEdge(0.40, 0.50, 0, 0.05);
    expect(op).not.toBeNull();
    if (op) {
      expect(op.kind).toBe("arbitrage");
      expect(op.side).toBe("BOTH");
      expect(op.edge).toBeCloseTo(0.10 / 0.90, 5);
      expect(op.meta.cost).toBeCloseTo(0.90, 5);
      expect(op.meta.profit_per_set).toBeCloseTo(0.10, 5);
    }
  });

  it("respects min_edge gate (profit exists but edge too small)", () => {
    // 0.49 + 0.50 = 0.99 → profit 0.01 → edge ≈ 0.0101. min_edge 0.05 → null.
    expect(arbitrageEdge(0.49, 0.50, 0, 0.05)).toBeNull();
  });

  it("subtracts fees from profit before computing edge", () => {
    // 100 bps fee on $0.90 cost = 0.009; remaining profit 0.10 - 0.009 = 0.091
    const op = arbitrageEdge(0.40, 0.50, 100, 0);
    expect(op).not.toBeNull();
    if (op) {
      expect(op.edge).toBeCloseTo(0.091 / 0.90, 4);
    }
  });

  it("returns null when either price is at the boundary 0 or 1", () => {
    expect(arbitrageEdge(0, 0.50)).toBeNull();
    expect(arbitrageEdge(1, 0.50)).toBeNull();
    expect(arbitrageEdge(0.50, 0)).toBeNull();
    expect(arbitrageEdge(0.50, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// directionalArbTilt

describe("directionalArbTilt", () => {
  it("returns null when no arb base exists (YES+NO >= 1)", () => {
    expect(directionalArbTilt(0.55, 0.50, 0.60)).toBeNull();
  });

  it("tilts YES when model_p > yes_ask", () => {
    const op = directionalArbTilt(0.40, 0.50, 0.70);
    expect(op).not.toBeNull();
    if (op) {
      expect(op.side).toBe("YES");
      expect(op.meta.tilt).toBe("YES");
      expect(op.meta.model_p_yes).toBe(0.70);
    }
  });

  it("tilts NO when model_p <= yes_ask", () => {
    const op = directionalArbTilt(0.40, 0.50, 0.30);
    expect(op).not.toBeNull();
    if (op) {
      expect(op.side).toBe("NO");
    }
  });
});

// ---------------------------------------------------------------------------
// nearResolutionEdge

describe("nearResolutionEdge", () => {
  it("fires when price in [0.95, 0.995] AND time-left <= 120s", () => {
    const op = nearResolutionEdge(0.97, 30);
    expect(op).not.toBeNull();
    if (op) {
      expect(op.kind).toBe("near_resolution");
      expect(op.side).toBe("YES");
      // reward = (1 - 0.97) / 0.97 = 0.0309...
      expect(op.edge).toBeCloseTo(0.03 / 0.97, 4);
    }
  });

  it("skips when too much time left", () => {
    expect(nearResolutionEdge(0.97, 200)).toBeNull();
  });

  it("skips when price below the band (too uncertain)", () => {
    expect(nearResolutionEdge(0.80, 30)).toBeNull();
  });

  it("skips when price above the band (already too expensive)", () => {
    expect(nearResolutionEdge(0.999, 30)).toBeNull();
  });

  it("honors custom thresholds", () => {
    expect(nearResolutionEdge(0.80, 30, { minPrice: 0.75, maxPrice: 0.90 })).not.toBeNull();
    expect(nearResolutionEdge(0.97, 200, { maxSeconds: 300 })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// orderbookImbalance

describe("orderbookImbalance", () => {
  it("returns 0 for empty book", () => {
    expect(orderbookImbalance([], [])).toBe(0);
  });

  it("returns 0 when bid and ask depth are equal", () => {
    const bids = [{ size: 100 }, { size: 50 }];
    const asks = [{ size: 100 }, { size: 50 }];
    expect(orderbookImbalance(bids, asks, 5)).toBe(0);
  });

  it("returns +1 for ask-empty (max bid pressure)", () => {
    expect(orderbookImbalance([{ size: 100 }], [])).toBe(1);
  });

  it("returns -1 for bid-empty (max ask pressure)", () => {
    expect(orderbookImbalance([], [{ size: 100 }])).toBe(-1);
  });

  it("returns +0.5 for 3:1 bid:ask ratio", () => {
    expect(orderbookImbalance([{ size: 300 }], [{ size: 100 }])).toBeCloseTo(0.5, 5);
  });

  it("only sums the top-N levels (truncation)", () => {
    // depth=2 — counts first two of each side, ignores the rest
    const bids = [{ size: 100 }, { size: 100 }, { size: 9999 }];
    const asks = [{ size: 100 }, { size: 100 }, { size: 9999 }];
    expect(orderbookImbalance(bids, asks, 2)).toBe(0);
  });

  it("tolerates missing size fields by treating them as 0", () => {
    const bids = [{ size: 100 }, {} as { size: number }];
    const asks = [{ size: 100 }];
    expect(orderbookImbalance(bids, asks, 5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// repricingEdge

describe("repricingEdge", () => {
  it("returns null when |edge| < min_edge", () => {
    expect(repricingEdge(0.50, 0.52, 0.05)).toBeNull();
  });

  it("fires YES when fair > market by min_edge", () => {
    const op = repricingEdge(0.40, 0.55, 0.10);
    expect(op).not.toBeNull();
    if (op) {
      expect(op.kind).toBe("repricing");
      expect(op.side).toBe("YES");
      expect(op.edge).toBeCloseTo(0.15, 5);
    }
  });

  it("fires NO when fair < market by min_edge", () => {
    const op = repricingEdge(0.70, 0.55, 0.10);
    expect(op).not.toBeNull();
    if (op) {
      expect(op.side).toBe("NO");
      expect(op.edge).toBeCloseTo(0.15, 5);
    }
  });

  it("returns null for invalid (NaN, out-of-range) input", () => {
    expect(repricingEdge(NaN, 0.50)).toBeNull();
    expect(repricingEdge(0.50, NaN)).toBeNull();
    expect(repricingEdge(-0.1, 0.50)).toBeNull();
    expect(repricingEdge(0.50, 1.1)).toBeNull();
  });

  it("detail string shows sign of edge correctly", () => {
    const opY = repricingEdge(0.40, 0.60, 0.10);
    const opN = repricingEdge(0.60, 0.40, 0.10);
    if (opY && opN) {
      expect(opY.detail).toContain("+0.200");
      expect(opN.detail).toContain("-0.200");
    }
  });
});
