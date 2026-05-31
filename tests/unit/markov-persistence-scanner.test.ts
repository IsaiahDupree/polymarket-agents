import { describe, expect, it } from "vitest";
import {
  evaluateMarket,
  evaluateMarketWithPool,
  inferFidelitySec,
  type PriceSample,
  type ScanMarket,
} from "@/lib/strategies/markov-persistence-scanner";

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sticky price history: 90% return to `level`, 10% step to an adjacent
 * BUCKET (full bucket width 0.10 at nStates=10). Avoids drift while still
 * producing real off-diagonal transitions (persistence ≈ 0.90, not 1.0).
 */
function stickyHistory(startTsSec: number, intervalSec: number, n: number, level: number): PriceSample[] {
  const out: PriceSample[] = [];
  let seed = 7777;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const u = (seed % 10000) / 10000;
    let p: number;
    if (u < 0.9) {
      p = level;
    } else {
      const j = ((seed >> 4) % 3) - 1;
      p = Math.max(0.05, Math.min(0.95, level + j * 0.10));
    }
    out.push({ t: startTsSec + i * intervalSec, p });
  }
  return out;
}

describe("inferFidelitySec", () => {
  it("returns the median gap between samples in seconds", () => {
    const h: PriceSample[] = [
      { t: 1000, p: 0.5 },
      { t: 1060, p: 0.5 },
      { t: 1120, p: 0.5 },
      { t: 1180, p: 0.5 },
    ];
    expect(inferFidelitySec(h)).toBe(60);
  });

  it("returns 60s default when fewer than 2 samples", () => {
    expect(inferFidelitySec([])).toBe(60);
    expect(inferFidelitySec([{ t: 100, p: 0.5 }])).toBe(60);
  });

  it("ignores non-monotonic gaps (negative-gap pairs filtered out)", () => {
    // gaps: -1 (filtered), +61 (the 999→1060 recovery), +60 → median ≈ 60s
    const h: PriceSample[] = [
      { t: 1000, p: 0.5 },
      { t: 999, p: 0.5 }, // bad timestamp
      { t: 1060, p: 0.5 },
      { t: 1120, p: 0.5 },
    ];
    const fid = inferFidelitySec(h);
    expect(fid).toBeGreaterThanOrEqual(60);
    expect(fid).toBeLessThanOrEqual(61);
  });
});

describe("evaluateMarket — PASS paths", () => {
  const market: ScanMarket = {
    tokenId: "TOK-1",
    conditionId: "COND-1",
    title: "BTC up 5m",
    asset: "BTC",
    durationKind: "5M",
    currentPrice: 0.5,
    expiryIso: new Date(Date.now() + 60_000).toISOString(),
  };

  it("PASS too_few_samples when history is shorter than min", () => {
    const h: PriceSample[] = Array.from({ length: 5 }, (_, i) => ({ t: 1000 + i * 60, p: 0.5 }));
    const v = evaluateMarket(market, h);
    expect(v.decision).toBe("PASS");
    if (v.decision === "PASS") expect(v.reason).toBe("too_few_samples");
  });

  it("PASS expired when expiry is in the past", () => {
    const h = stickyHistory(1000, 60, 200, 0.85);
    const expired = { ...market, expiryIso: new Date(Date.now() - 60_000).toISOString() };
    const v = evaluateMarket(expired, h, { nowEpochSec: Math.floor(Date.now() / 1000) });
    expect(v.decision).toBe("PASS");
    if (v.decision === "PASS") expect(v.reason).toBe("expired");
  });

  it("PASS filter_data_too_sparse when market price is in an unobserved bucket", () => {
    // History glued at 0.85 (state 8). Market price at 0.50 (state 5) → row 5 empty.
    const h = stickyHistory(1000, 60, 200, 0.85);
    const m: ScanMarket = {
      ...market,
      currentPrice: 0.5,
      expiryIso: new Date(Date.now() + 600_000).toISOString(),
    };
    const v = evaluateMarket(m, h, { nowEpochSec: Math.floor(Date.now() / 1000), rng: seededRng(11) });
    expect(v.decision).toBe("PASS");
    if (v.decision === "PASS") expect(v.reason).toBe("filter_data_too_sparse");
  });

  it("PASS filter_persistence_below_threshold on a choppy history", () => {
    // Alternating state 4 ↔ state 5 every step → persistence near 0.
    const h: PriceSample[] = [];
    for (let i = 0; i < 500; i++) {
      h.push({ t: 1000 + i * 60, p: i % 2 === 0 ? 0.45 : 0.55 });
    }
    const m: ScanMarket = {
      ...market,
      currentPrice: 0.45,
      expiryIso: new Date(Date.now() + 600_000).toISOString(),
    };
    const v = evaluateMarket(m, h, { nowEpochSec: Math.floor(Date.now() / 1000), rng: seededRng(13) });
    expect(v.decision).toBe("PASS");
    if (v.decision === "PASS") {
      expect(v.reason).toBe("filter_persistence_below_threshold");
      expect(v.persistence).toBeLessThan(0.1);
    }
  });
});

describe("evaluateMarketWithPool — cross-window aggregation", () => {
  const futureExpiry = (): string => new Date(Date.now() + 5 * 60_000).toISOString();

  it("PASS too_few_samples when OWN history is too short, even with rich pool", () => {
    const own: PriceSample[] = Array.from({ length: 5 }, (_, i) => ({ t: 1000 + i * 60, p: 0.45 }));
    const pool: PriceSample[][] = [stickyHistory(2000, 60, 500, 0.45)];
    const m: ScanMarket = {
      tokenId: "TOK-1",
      conditionId: "C-1",
      currentPrice: 0.45,
      expiryIso: futureExpiry(),
    };
    const v = evaluateMarketWithPool(m, own, pool, { nowEpochSec: Math.floor(Date.now() / 1000) });
    expect(v.decision).toBe("PASS");
    if (v.decision === "PASS") expect(v.reason).toBe("too_few_samples");
  });

  it("ENTER with mode=pooled when own history alone wouldn't suffice but the pool is dense", () => {
    // Own history: just enough samples to clear min-samples (40), all near 0.85.
    const own: PriceSample[] = Array.from({ length: 40 }, (_, i) => ({ t: 1000 + i * 60, p: 0.85 }));
    // Pool: 1000 samples from 3 same-asset markets, all sticky near 0.85.
    const pool: PriceSample[][] = [
      stickyHistory(10_000, 60, 400, 0.85),
      stickyHistory(20_000, 60, 400, 0.85),
      stickyHistory(30_000, 60, 400, 0.85),
    ];
    const m: ScanMarket = {
      tokenId: "TOK-2",
      conditionId: "C-2",
      title: "BTC pooled",
      asset: "BTC",
      durationKind: "5M",
      currentPrice: 0.85,
      expiryIso: futureExpiry(),
    };
    const v = evaluateMarketWithPool(m, own, pool, {
      nowEpochSec: Math.floor(Date.now() / 1000),
      rng: seededRng(42),
    });
    expect(v.decision).toBe("ENTER");
    if (v.decision === "ENTER") {
      expect(v.mode).toBe("pooled");
      expect(v.pooledMarkets).toBe(4); // own + 3 pooled
      expect(v.pooledTransitions).toBeGreaterThan(1000);
      expect(v.side).toBe("YES");
      expect(v.persistence).toBeGreaterThanOrEqual(0.87);
    }
  });

  it("Empty pool falls back to own-history-only behavior", () => {
    const own = stickyHistory(1000, 60, 1000, 0.85);
    const m: ScanMarket = {
      tokenId: "TOK-3",
      conditionId: "C-3",
      currentPrice: 0.85,
      expiryIso: futureExpiry(),
    };
    const v = evaluateMarketWithPool(m, own, [], {
      nowEpochSec: Math.floor(Date.now() / 1000),
      rng: seededRng(7),
    });
    expect(v.decision).toBe("ENTER");
    if (v.decision === "ENTER") {
      expect(v.mode).toBe("pooled");
      expect(v.pooledMarkets).toBe(1); // just own history
    }
  });
});

describe("evaluateMarket — ENTER path", () => {
  it("ENTER YES when sticky-high history and market still mid-priced", () => {
    // Sticky at 0.85 (state 8). currentPrice 0.85 — same bucket, well-observed.
    const h = stickyHistory(1000, 60, 1000, 0.85);
    const m: ScanMarket = {
      tokenId: "TOK-1",
      conditionId: "COND-1",
      title: "BTC up 5m",
      asset: "BTC",
      durationKind: "5M",
      currentPrice: 0.85,
      expiryIso: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
    const v = evaluateMarket(m, h, {
      nowEpochSec: Math.floor(Date.now() / 1000),
      rng: seededRng(42),
    });
    expect(v.decision).toBe("ENTER");
    if (v.decision === "ENTER") {
      expect(v.side).toBe("YES");
      expect(v.persistence).toBeGreaterThanOrEqual(0.87);
      expect(v.edge).toBeGreaterThanOrEqual(0.05);
      expect(v.calibratedProbYes).toBeGreaterThan(v.marketPrice);
      expect(v.stepsToExpiry).toBeGreaterThan(0);
      expect(v.inferredFidelitySec).toBe(60);
      expect(v.historySamples).toBe(1000);
      expect(v.asset).toBe("BTC");
      expect(v.durationKind).toBe("5M");
    }
  });
});
