import { describe, expect, it } from "vitest";
import {
  buildNightlyReview,
  type CurrentThresholds,
  type ExecRow,
} from "@/lib/agents/nightly-review";

const baseThresholds: CurrentThresholds = {
  minPersistence: 0.87,
  maxPersistence: 0.99,
  minEdge: 0.05,
  kellyFraction: 0.25,
};

function row(
  payload: Partial<ExecRow["payload"]>,
  id = 0,
): ExecRow {
  return {
    id,
    createdAt: new Date(2026, 4, 30, 10, id).toISOString(),
    payload: { orderUsd: 5, ...payload },
  };
}

function filled(persistence: number, cal: number, mkt: number, kelly = 0.15): ExecRow {
  return row({
    persistence,
    calibratedProbYes: cal,
    marketPrice: mkt,
    kelly,
    verdict: { status: "filled", brokerOrderId: "SIM-1" },
  });
}

function rejected(reason = "capsule_max_position_pct"): ExecRow {
  return row({ verdict: { status: reason } });
}

function skipped(reason = "pTrue not > pMarket"): ExecRow {
  return row({ skipped: reason });
}

describe("buildNightlyReview", () => {
  it("returns insufficient_data when fewer than 10 rows", () => {
    const rows = [filled(0.9, 0.82, 0.55), filled(0.9, 0.82, 0.55)];
    const r = buildNightlyReview(rows, baseThresholds);
    expect(r.outcome).toBe("insufficient_data");
    expect(r.proposed).toEqual({});
    expect(r.stats.totalExecs).toBe(2);
  });

  it("computes stats correctly when n ≥ 10", () => {
    const rows: ExecRow[] = [];
    for (let i = 0; i < 10; i++) rows.push(filled(0.9, 0.82, 0.55, 0.15));
    const r = buildNightlyReview(rows, baseThresholds);
    expect(r.stats.filledCount).toBe(10);
    expect(r.stats.fillRate).toBeCloseTo(1, 6);
    expect(r.stats.avgPersistence).toBeCloseTo(0.9, 6);
    expect(r.stats.avgEdgePctPp).toBeCloseTo(27, 4); // |0.82 - 0.55| * 100
    expect(r.stats.avgKelly).toBeCloseTo(0.15, 6);
  });

  it("returns no_change when fill rate is healthy and edge is robust", () => {
    const rows: ExecRow[] = [];
    for (let i = 0; i < 15; i++) rows.push(filled(0.9, 0.82, 0.55, 0.15));
    const r = buildNightlyReview(rows, baseThresholds);
    expect(r.outcome).toBe("no_change");
    expect(r.proposed).toEqual({});
  });

  it("proposes loosen when fill rate is < 30% and we have ≥ 20 rows", () => {
    const rows: ExecRow[] = [];
    for (let i = 0; i < 4; i++) rows.push(filled(0.9, 0.82, 0.55, 0.15));
    for (let i = 0; i < 16; i++) rows.push(rejected("capsule"));
    const r = buildNightlyReview(rows, baseThresholds);
    expect(r.outcome).toBe("loosen");
    expect(r.proposed.minPersistence).toBeLessThan(baseThresholds.minPersistence);
    expect(r.proposed.minEdge).toBeLessThan(baseThresholds.minEdge);
    expect(r.rationale).toContain("Fill rate");
  });

  it("proposes tighten when fill rate is > 80% but per-fill edge is thin", () => {
    const rows: ExecRow[] = [];
    // 100% fill rate but every fill has only 6pp edge (just over minEdge*1.5=7.5pp)... let's make it thinner
    for (let i = 0; i < 25; i++) rows.push(filled(0.88, 0.56, 0.50, 0.10)); // edge = 6pp, minEdge*1.5 = 7.5pp
    const r = buildNightlyReview(rows, baseThresholds);
    expect(r.outcome).toBe("tighten");
    expect(r.proposed.minPersistence).toBeGreaterThan(baseThresholds.minPersistence);
    expect(r.proposed.minEdge).toBeGreaterThan(baseThresholds.minEdge);
  });

  it("clamps proposals so a runaway loop can't push thresholds out of bounds", () => {
    const tightExisting: CurrentThresholds = { ...baseThresholds, minPersistence: 0.95, minEdge: 0.20 };
    const rows: ExecRow[] = [];
    for (let i = 0; i < 25; i++) rows.push(filled(0.95, 0.56, 0.50, 0.10));
    const r = buildNightlyReview(rows, tightExisting);
    // Already at the upper bound — can't tighten further → no_change.
    expect(r.outcome).toBe("no_change");
  });

  it("ignores skipped + rejected rows when computing avg persistence / edge / kelly", () => {
    const rows: ExecRow[] = [];
    // 12 filled with edge 30pp
    for (let i = 0; i < 12; i++) rows.push(filled(0.9, 0.85, 0.55, 0.15));
    // 8 skipped — these should NOT pollute the avg-persistence/edge stats
    for (let i = 0; i < 8; i++) rows.push(skipped("low edge"));
    const r = buildNightlyReview(rows, baseThresholds);
    expect(r.stats.totalExecs).toBe(20);
    expect(r.stats.filledCount).toBe(12);
    expect(r.stats.skippedCount).toBe(8);
    expect(r.stats.avgPersistence).toBeCloseTo(0.9, 6);
    expect(r.stats.avgEdgePctPp).toBeCloseTo(30, 4);
  });

  it("totalUsdDeployed sums orderUsd across ALL rows (including skipped 0-USD)", () => {
    const rows: ExecRow[] = [];
    for (let i = 0; i < 5; i++) rows.push(filled(0.9, 0.82, 0.55, 0.15)); // 5×$5 = $25
    rows[0].payload.orderUsd = 10;
    rows[1].payload.orderUsd = 10;
    for (let i = 0; i < 5; i++) rows.push(row({ orderUsd: 0, skipped: "x" }));
    const r = buildNightlyReview(rows, baseThresholds);
    expect(r.stats.totalUsdDeployed).toBeCloseTo(35, 6);
  });
});
