import { describe, expect, it } from "vitest";
import {
  aggregateTransitions,
  buildPooledMatrix,
  pooledRowObservations,
  pooledTotalTransitions,
} from "@/lib/quant/markov-cross-window";

describe("aggregateTransitions", () => {
  it("sums counts across multiple histories", () => {
    // History A: 0.45→0.45→0.55  (state 4→4, 4→5)
    // History B: 0.55→0.55→0.45  (state 5→5, 5→4)
    const counts = aggregateTransitions([[0.45, 0.45, 0.55], [0.55, 0.55, 0.45]], 10);
    expect(counts[4][4]).toBe(1);
    expect(counts[4][5]).toBe(1);
    expect(counts[5][5]).toBe(1);
    expect(counts[5][4]).toBe(1);
    expect(counts[0][0]).toBe(0);
  });

  it("does NOT count fake transitions across history boundaries", () => {
    // A ends at state 4 (0.45), B starts at state 9 (0.95).
    // A naive concat would record a 4→9 transition. We must not.
    const counts = aggregateTransitions([[0.45, 0.45], [0.95, 0.95]], 10);
    expect(counts[4][9]).toBe(0);
    expect(counts[4][4]).toBe(1); // within A
    expect(counts[9][9]).toBe(1); // within B
  });

  it("skips empty / single-sample histories without error", () => {
    const counts = aggregateTransitions([[], [0.5], [0.4, 0.4, 0.4]], 10);
    expect(counts[4][4]).toBe(2);
    // (no error on the empty / 1-sample inputs)
  });

  it("throws on nStates < 2", () => {
    expect(() => aggregateTransitions([[0.4, 0.5]], 1)).toThrow(/nStates must be ≥ 2/);
  });
});

describe("buildPooledMatrix", () => {
  it("returns row-stochastic; rows for observed states sum to 1", () => {
    const histories = [
      Array.from({ length: 50 }, (_, i) => (i % 2 ? 0.45 : 0.55)),
      Array.from({ length: 50 }, (_, i) => (i % 2 ? 0.45 : 0.55)),
    ];
    const T = buildPooledMatrix(histories, 10);
    // States 4 + 5 are populated; rows must sum to 1.
    const row4 = T[4].reduce((a, b) => a + b, 0);
    const row5 = T[5].reduce((a, b) => a + b, 0);
    expect(row4).toBeCloseTo(1, 6);
    expect(row5).toBeCloseTo(1, 6);
  });

  it("identity row for never-visited states", () => {
    const T = buildPooledMatrix([[0.45, 0.55, 0.45, 0.55]], 10);
    for (const i of [0, 1, 2, 3, 6, 7, 8, 9]) {
      expect(T[i][i]).toBe(1);
      const sum = T[i].reduce((a, b, j) => (j === i ? a : a + b), 0);
      expect(sum).toBe(0);
    }
  });

  it("pooling two markets gives a denser matrix than either alone (proves the point)", () => {
    // Two markets, each glued near state 8, but with slightly different drift.
    const A = Array.from({ length: 80 }, (_, i) => 0.8 + (i % 4 ? 0 : 0.02));
    const B = Array.from({ length: 80 }, (_, i) => 0.85 + (i % 5 ? 0 : -0.02));
    const TPooled = buildPooledMatrix([A, B], 10);
    const obsPooled = pooledRowObservations([A, B], 10);
    const obsSolo = pooledRowObservations([A], 10);
    // The state 8 row should have strictly more observations after pooling.
    expect(obsPooled[8]).toBeGreaterThan(obsSolo[8]);
    // And the pooled matrix should still be row-stochastic on populated rows.
    const row8 = TPooled[8].reduce((a, b) => a + b, 0);
    expect(row8).toBeCloseTo(1, 6);
  });
});

describe("pooledTotalTransitions", () => {
  it("sums (length - 1) across all histories", () => {
    expect(pooledTotalTransitions([[1, 2, 3], [4, 5], [6]])).toBe(2 + 1 + 0);
  });
  it("treats undefined / null safely", () => {
    expect(pooledTotalTransitions([null as any, undefined as any, [0.4, 0.5]])).toBe(1);
  });
});

describe("pooledRowObservations", () => {
  it("returns per-row counts across the pool", () => {
    const counts = pooledRowObservations(
      [[0.45, 0.45, 0.55], [0.45, 0.55, 0.55, 0.55]],
      10,
    );
    expect(counts[4]).toBe(3); // A: 4→4, 4→5 (2 leaves from 4); B: 4→5 (1)
    expect(counts[5]).toBe(2); // A: none; B: 5→5, 5→5
    expect(counts[0]).toBe(0);
  });
});
