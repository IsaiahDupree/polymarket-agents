/**
 * Tests for the fitness-weighted capital allocator.
 */
import { describe, expect, it } from "vitest";
import { allocateByFitness } from "@/lib/arena/fitness-allocation";

describe("allocateByFitness", () => {
  it("single elite → 100% of budget", () => {
    const r = allocateByFitness({
      agents: [{ id: 1, name: "solo", fitness: 0.5 }],
      totalBudgetUsd: 30,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.allocation_usd).toBe(30);
    expect(r[0]!.weight).toBe(1.0);
  });

  it("two agents, equal fitness → near-equal split", () => {
    const r = allocateByFitness({
      agents: [
        { id: 1, name: "a", fitness: 0.5 },
        { id: 2, name: "b", fitness: 0.5 },
      ],
      totalBudgetUsd: 30,
    });
    expect(r[0]!.allocation_usd).toBeCloseTo(15, 1);
    expect(r[1]!.allocation_usd).toBeCloseTo(15, 1);
  });

  it("winner takes more: agent with 2x fitness gets more than 50%", () => {
    const r = allocateByFitness({
      agents: [
        { id: 1, name: "winner", fitness: 1.0 },
        { id: 2, name: "loser", fitness: 0.0 },
      ],
      totalBudgetUsd: 100,
      minShare: 0.20,
    });
    expect(r[0]!.allocation_usd).toBeGreaterThan(50);
    expect(r[1]!.allocation_usd).toBeGreaterThanOrEqual(20); // floor honored
    expect(r[0]!.allocation_usd + r[1]!.allocation_usd).toBeCloseTo(100, 1);
  });

  it("3-elite typical case: top gets most, others get floor", () => {
    const r = allocateByFitness({
      agents: [
        { id: 1, name: "top", fitness: 1.0 },
        { id: 2, name: "mid", fitness: 0.3 },
        { id: 3, name: "bot", fitness: 0.0 },
      ],
      totalBudgetUsd: 30,
      minShare: 0.15,
    });
    expect(r[0]!.allocation_usd).toBeGreaterThan(r[1]!.allocation_usd);
    expect(r[1]!.allocation_usd).toBeGreaterThan(r[2]!.allocation_usd);
    // Floor: $30 × 15% = $4.50, every agent gets at least that
    for (const a of r) expect(a.allocation_usd).toBeGreaterThanOrEqual(4.5);
    // Sum matches budget
    const total = r.reduce((s, x) => s + x.allocation_usd, 0);
    expect(total).toBeCloseTo(30, 1);
  });

  it("negative fitness handled: shifted to positive before allocation", () => {
    // All negative — shouldn't crash, should still allocate
    const r = allocateByFitness({
      agents: [
        { id: 1, name: "a", fitness: -0.1 },
        { id: 2, name: "b", fitness: -0.5 },
        { id: 3, name: "c", fitness: -0.3 },
      ],
      totalBudgetUsd: 30,
    });
    // Agent with least-negative fitness (-0.1) gets the most
    expect(r[0]!.allocation_usd).toBeGreaterThan(r[1]!.allocation_usd);
    const total = r.reduce((s, x) => s + x.allocation_usd, 0);
    expect(total).toBeCloseTo(30, 1);
  });

  it("min_share is honored even when fitness diff is huge", () => {
    const r = allocateByFitness({
      agents: [
        { id: 1, name: "monster", fitness: 100 },
        { id: 2, name: "weak1", fitness: 0.01 },
        { id: 3, name: "weak2", fitness: 0.0 },
      ],
      totalBudgetUsd: 100,
      minShare: 0.20,
    });
    // weak1 and weak2 should each get at least 20% (= $20)
    expect(r[1]!.allocation_usd).toBeGreaterThanOrEqual(20);
    expect(r[2]!.allocation_usd).toBeGreaterThanOrEqual(20);
    // monster still gets most
    expect(r[0]!.allocation_usd).toBeGreaterThan(r[1]!.allocation_usd);
  });

  it("throws if minShare × N ≥ 1 (no room for weighting)", () => {
    expect(() =>
      allocateByFitness({
        agents: [
          { id: 1, name: "a", fitness: 1 },
          { id: 2, name: "b", fitness: 1 },
          { id: 3, name: "c", fitness: 1 },
        ],
        totalBudgetUsd: 30,
        minShare: 0.40, // 0.40 × 3 = 1.20
      }),
    ).toThrow(/minShare/);
  });

  it("empty input → empty output", () => {
    expect(allocateByFitness({ agents: [], totalBudgetUsd: 30 })).toEqual([]);
  });

  it("default minShare = 0.15", () => {
    const r = allocateByFitness({
      agents: [
        { id: 1, name: "a", fitness: 10 },
        { id: 2, name: "b", fitness: 0 },
      ],
      totalBudgetUsd: 100,
    });
    // Without explicit minShare, default 0.15 means weak agent gets ≥ $15
    expect(r[1]!.allocation_usd).toBeGreaterThanOrEqual(15);
  });

  it("preserves input order", () => {
    const r = allocateByFitness({
      agents: [
        { id: 10, name: "first", fitness: 0.5 },
        { id: 20, name: "second", fitness: 1.0 },
        { id: 30, name: "third", fitness: 0.0 },
      ],
      totalBudgetUsd: 30,
    });
    expect(r.map((x) => x.agent_id)).toEqual([10, 20, 30]);
  });
});
