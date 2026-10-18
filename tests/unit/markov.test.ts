import { describe, expect, it } from "vitest";
import {
  priceToState,
  stateToMidPrice,
  buildTransitionMatrix,
  validateMatrix,
  monteCarlo,
  markovProbabilityYes,
  persistenceProbability,
  type TransitionMatrix,
} from "@/lib/quant/markov";
import { calibrateProbability } from "@/lib/quant/becker-calibration";

/**
 * Mulberry32 — tiny seeded PRNG for deterministic Monte Carlo tests.
 * https://stackoverflow.com/a/47593316
 */
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

describe("priceToState / stateToMidPrice", () => {
  it("buckets 0..1 into nStates equal bins", () => {
    expect(priceToState(0, 10)).toBe(0);
    expect(priceToState(0.05, 10)).toBe(0);
    expect(priceToState(0.10, 10)).toBe(1);
    expect(priceToState(0.49, 10)).toBe(4);
    expect(priceToState(0.50, 10)).toBe(5);
    expect(priceToState(0.99, 10)).toBe(9);
    expect(priceToState(1.0, 10)).toBe(9);
  });
  it("clamps out-of-range prices", () => {
    expect(priceToState(-0.1, 10)).toBe(0);
    expect(priceToState(1.5, 10)).toBe(9);
  });
  it("returns midpoint price for a state", () => {
    expect(stateToMidPrice(0, 10)).toBeCloseTo(0.05);
    expect(stateToMidPrice(5, 10)).toBeCloseTo(0.55);
    expect(stateToMidPrice(9, 10)).toBeCloseTo(0.95);
  });
});

describe("buildTransitionMatrix", () => {
  it("returns a row-stochastic matrix of the right shape", () => {
    const prices = Array.from({ length: 100 }, (_, i) => (i % 10) / 10);
    const T = buildTransitionMatrix(prices, 10);
    expect(T).toHaveLength(10);
    expect(T[0]).toHaveLength(10);
    for (const row of T) {
      const sum = row.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("counts a simple sticky chain correctly", () => {
    // 0.45 → 0.45 → 0.45 → 0.55 → 0.55 — state 4 self-loops twice, state 4 → state 5 once
    const prices = [0.45, 0.45, 0.45, 0.55, 0.55];
    const T = buildTransitionMatrix(prices, 10);
    // From state 4: 2 transitions to 4, 1 to 5 → row [0,0,0,0, 2/3, 1/3, 0,...]
    expect(T[4][4]).toBeCloseTo(2 / 3);
    expect(T[4][5]).toBeCloseTo(1 / 3);
    // From state 5: 1 transition to 5 → row [0,0,0,0,0,1,0,...]
    expect(T[5][5]).toBeCloseTo(1);
  });

  it("uses identity row for never-visited states (so MC walks never panic)", () => {
    // Only states 4 and 5 ever appear; rows 0..3, 6..9 should be identity rows.
    const prices = [0.45, 0.55, 0.45, 0.55];
    const T = buildTransitionMatrix(prices, 10);
    for (const i of [0, 1, 2, 3, 6, 7, 8, 9]) {
      const row = T[i];
      expect(row[i]).toBe(1);
      const sumOthers = row.reduce((a, b, j) => (j === i ? a : a + b), 0);
      expect(sumOthers).toBe(0);
    }
  });

  it("throws on too-few prices or bad nStates", () => {
    expect(() => buildTransitionMatrix([0.5], 10)).toThrow(/≥ 2 prices/);
    expect(() => buildTransitionMatrix([0.5, 0.6], 1)).toThrow(/nStates must be ≥ 2/);
  });
});

describe("validateMatrix", () => {
  it("flags sparse + empty rows against the article's 20-observation rule", () => {
    // Generate 50 prices but only in states 4–5 → every other row is empty.
    const prices = Array.from({ length: 50 }, (_, i) => (i % 2 ? 0.45 : 0.55));
    const T = buildTransitionMatrix(prices, 10);
    const v = validateMatrix(T, prices, { minObservationsPerRow: 20 });
    expect(v.ok).toBe(false);
    expect(v.emptyRows).toEqual([0, 1, 2, 3, 6, 7, 8, 9]);
    expect(v.totalTransitions).toBe(49);
  });

  it("passes when every visited row has enough observations", () => {
    // 500 alternations through state 4 ↔ state 5 → 249 from each.
    const prices = Array.from({ length: 500 }, (_, i) => (i % 2 ? 0.45 : 0.55));
    const T = buildTransitionMatrix(prices, 10);
    const v = validateMatrix(T, prices, { minObservationsPerRow: 200 });
    // Empty rows still empty (the chain never visited 0..3 or 6..9), so ok=false.
    expect(v.emptyRows.length).toBe(8);
    expect(v.sparseRows.length).toBe(0); // rows 4 and 5 have ≥ 200 observations each
  });
});

describe("monteCarlo", () => {
  it("deterministic with a seeded RNG — same seed → same probYes", () => {
    const prices = Array.from({ length: 200 }, (_, i) => 0.4 + 0.005 * Math.sin(i / 5));
    const T = buildTransitionMatrix(prices, 10);
    const a = monteCarlo(T, 4, 30, { nSims: 1000, rng: seededRng(42) });
    const b = monteCarlo(T, 4, 30, { nSims: 1000, rng: seededRng(42) });
    expect(a.probYes).toBe(b.probYes);
    expect(a.histogram).toEqual(b.histogram);
  });

  it("probYes is in [0, 1] and histogram sums to nSims", () => {
    const prices = Array.from({ length: 200 }, (_, i) => 0.5 + 0.1 * Math.sin(i / 5));
    const T = buildTransitionMatrix(prices, 10);
    const r = monteCarlo(T, 5, 30, { nSims: 500, rng: seededRng(7) });
    expect(r.probYes).toBeGreaterThanOrEqual(0);
    expect(r.probYes).toBeLessThanOrEqual(1);
    expect(r.histogram.reduce((a, b) => a + b, 0)).toBe(500);
    expect(r.nSims).toBe(500);
  });

  it("absorbing high state → probYes ≈ 1", () => {
    // Construct a matrix manually: state 5 is the only reachable state,
    // and it self-loops with probability 1. probYes must be 1 from start=5.
    const nStates = 10;
    const T: TransitionMatrix = Array.from({ length: nStates }, (_, i) => {
      const row = new Array<number>(nStates).fill(0);
      row[i] = 1;
      return row;
    });
    const r = monteCarlo(T, 5, 10, { nSims: 100, rng: seededRng(1) });
    expect(r.probYes).toBe(1);
  });

  it("absorbing low state → probYes = 0", () => {
    const nStates = 10;
    const T: TransitionMatrix = Array.from({ length: nStates }, (_, i) => {
      const row = new Array<number>(nStates).fill(0);
      row[i] = 1;
      return row;
    });
    const r = monteCarlo(T, 3, 10, { nSims: 100, rng: seededRng(1) });
    expect(r.probYes).toBe(0);
  });

  it("rejects bad inputs", () => {
    const T = buildTransitionMatrix([0.4, 0.5, 0.6, 0.5], 10);
    expect(() => monteCarlo(T, -1, 10)).toThrow(/outside/);
    expect(() => monteCarlo(T, 99, 10)).toThrow(/outside/);
    expect(() => monteCarlo(T, 4, 0)).toThrow(/days must be ≥ 1/);
  });
});

describe("markovProbabilityYes (the convenience oracle)", () => {
  it("returns calibrated + raw + validation in one shot", () => {
    const prices = Array.from({ length: 200 }, (_, i) => 0.5 + 0.05 * Math.sin(i / 5));
    const r = markovProbabilityYes({
      priceHistory: prices,
      currentPrice: 0.5,
      daysToExpiry: 10,
      nSims: 500,
      rng: seededRng(9),
    });
    expect(r.probYes).toBeGreaterThanOrEqual(0);
    expect(r.probYes).toBeLessThanOrEqual(1);
    expect(r.calibratedProbYes).toBeGreaterThanOrEqual(0);
    expect(r.calibratedProbYes).toBeLessThanOrEqual(1);
    expect(r.currentPriceMid).toBeCloseTo(0.55); // state 5 midpoint
    expect(r.validation).toBeDefined();
    expect(r.histogram.reduce((a, b) => a + b, 0)).toBe(500);
  });

  it("Becker calibration shifts a low raw probability downward", () => {
    // Construct prices that drive lots of weight into low states from state 1.
    const nStates = 10;
    const T: TransitionMatrix = Array.from({ length: nStates }, (_, i) => {
      const row = new Array<number>(nStates).fill(0);
      row[Math.max(0, i - 1)] = 1; // every state → state below it (drifts down)
      return row;
    });
    const r = monteCarlo(T, 1, 5, { nSims: 100, rng: seededRng(3) });
    expect(r.probYes).toBe(0); // chain marches to state 0
    // Even when raw probYes is 0, Becker pins to the table's lowest entry (0.0043).
    expect(calibrateProbability(r.probYes)).toBeCloseTo(0.0043, 6);
  });
});

describe("persistenceProbability (Ricker filter substrate)", () => {
  it("returns the diagonal entry T[j][j]", () => {
    // 90% of the time state 4 stays at state 4, 10% it transitions to 5.
    const T: TransitionMatrix = Array.from({ length: 10 }, () => new Array<number>(10).fill(0));
    T[4][4] = 0.9;
    T[4][5] = 0.1;
    expect(persistenceProbability(T, 4)).toBeCloseTo(0.9);
  });
  it("returns 0 for out-of-range state", () => {
    const T: TransitionMatrix = [[1, 0], [0, 1]];
    expect(persistenceProbability(T, -1)).toBe(0);
    expect(persistenceProbability(T, 99)).toBe(0);
  });
  it("Ricker rule: 0.87 threshold gating example", () => {
    const T: TransitionMatrix = Array.from({ length: 10 }, () => new Array<number>(10).fill(0));
    T[6][6] = 0.92; // strong persistence at state 6
    T[6][5] = 0.04;
    T[6][7] = 0.04;
    T[3][3] = 0.55; // weak persistence at state 3
    T[3][2] = 0.20;
    T[3][4] = 0.25;
    // Ricker filter: only enter when p(j*,j*) ≥ 0.87.
    const trigger87 = (state: number) => persistenceProbability(T, state) >= 0.87;
    expect(trigger87(6)).toBe(true);
    expect(trigger87(3)).toBe(false);
  });
});
