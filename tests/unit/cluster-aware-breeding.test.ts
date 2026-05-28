/**
 * Tests for the cluster-aware breeding weights module (Self-evolving fix B).
 */
import { describe, expect, it } from "vitest";
import {
  breedingWeightFor,
  computeBreedingWeights,
  DEFAULT_BREEDING_THRESHOLDS,
  isClusterAwareBreedingEnabled,
  readBreedingThresholdsFromEnv,
  type ClusterTripEvent,
} from "@/lib/arena/cluster-aware-breeding";

const NOW = Date.parse("2026-05-28T00:00:00Z");

function tripDaysAgo(family: string, daysAgo: number, reason = "strategy_family_cluster"): ClusterTripEvent {
  return {
    ts: new Date(NOW - daysAgo * 86_400_000).toISOString(),
    reason,
    strategy_family: family,
  };
}

describe("computeBreedingWeights", () => {
  it("no trips → empty weights map (callers default to 1.0)", () => {
    const w = computeBreedingWeights([], DEFAULT_BREEDING_THRESHOLDS, NOW);
    expect(w.size).toBe(0);
  });

  it("one fresh trip → weight ≈ (1 - severity) × 1.0", () => {
    // Fresh trip (0 days ago), severity 0.30 → expect 0.70 × 1.0 = 0.70
    const w = computeBreedingWeights(
      [tripDaysAgo("directional", 0)],
      DEFAULT_BREEDING_THRESHOLDS,
      NOW,
    );
    expect(w.get("directional")!).toBeCloseTo(0.70, 2);
  });

  it("multiple trips in window compound severity", () => {
    // 2 fresh trips → (1 - 0.30 × 2) = 0.40 × 1.0 = 0.40
    const w = computeBreedingWeights(
      [tripDaysAgo("directional", 0), tripDaysAgo("directional", 1)],
      DEFAULT_BREEDING_THRESHOLDS,
      NOW,
    );
    expect(w.get("directional")!).toBeLessThan(0.50);
  });

  it("time decay: trip 7 days ago → ~37% of fresh penalty", () => {
    // exp(-7/7) ≈ 0.368 × (1 - 0.30) = ~0.257
    const w = computeBreedingWeights(
      [tripDaysAgo("directional", 7)],
      DEFAULT_BREEDING_THRESHOLDS,
      NOW,
    );
    // 0.70 × 0.368 ≈ 0.258 (above min floor 0.10)
    expect(w.get("directional")!).toBeGreaterThan(0.15);
    expect(w.get("directional")!).toBeLessThan(0.30);
  });

  it("trip outside window → ignored", () => {
    const w = computeBreedingWeights(
      [tripDaysAgo("directional", 30)], // beyond default 14-day window
      DEFAULT_BREEDING_THRESHOLDS,
      NOW,
    );
    expect(w.has("directional")).toBe(false);
  });

  it("weight is floored at minWeight (0.10 default)", () => {
    // 10 trips compounding → would go negative; floor at 0.10
    const trips: ClusterTripEvent[] = Array.from({ length: 10 }, () => tripDaysAgo("directional", 0));
    const w = computeBreedingWeights(trips, DEFAULT_BREEDING_THRESHOLDS, NOW);
    expect(w.get("directional")!).toBeGreaterThanOrEqual(0.10);
    expect(w.get("directional")!).toBe(0.10);
  });

  it("multiple families tracked independently", () => {
    const w = computeBreedingWeights(
      [
        tripDaysAgo("directional", 0),
        tripDaysAgo("momentum", 0),
        tripDaysAgo("momentum", 1),
      ],
      DEFAULT_BREEDING_THRESHOLDS,
      NOW,
    );
    // directional: 1 trip → 0.70
    // momentum: 2 trips → ~0.40
    expect(w.get("directional")!).toBeGreaterThan(w.get("momentum")!);
  });

  it("custom severity = 0.10 → softer penalty", () => {
    const w = computeBreedingWeights(
      [tripDaysAgo("directional", 0)],
      { ...DEFAULT_BREEDING_THRESHOLDS, severity: 0.10 },
      NOW,
    );
    expect(w.get("directional")!).toBeCloseTo(0.90, 2);
  });

  it("filters events without strategy_family", () => {
    const w = computeBreedingWeights(
      [
        { ts: new Date(NOW).toISOString(), reason: "global_kill_switch", strategy_family: null },
        tripDaysAgo("directional", 0),
      ],
      DEFAULT_BREEDING_THRESHOLDS,
      NOW,
    );
    expect(w.size).toBe(1);
    expect(w.has("directional")).toBe(true);
  });
});

describe("breedingWeightFor (single-family convenience)", () => {
  it("returns 1.0 for null/undefined family", () => {
    expect(breedingWeightFor(null, [])).toBe(1.0);
    expect(breedingWeightFor(undefined, [])).toBe(1.0);
  });

  it("returns 1.0 for family with no trips", () => {
    expect(breedingWeightFor("scrape", [tripDaysAgo("directional", 0)])).toBe(1.0);
  });

  it("returns reduced weight for tripped family", () => {
    expect(breedingWeightFor("directional", [tripDaysAgo("directional", 0)], DEFAULT_BREEDING_THRESHOLDS, NOW))
      .toBeCloseTo(0.70, 2);
  });
});

describe("readBreedingThresholdsFromEnv", () => {
  it("returns defaults on empty env", () => {
    expect(readBreedingThresholdsFromEnv({})).toEqual(DEFAULT_BREEDING_THRESHOLDS);
  });

  it("respects all env overrides", () => {
    const t = readBreedingThresholdsFromEnv({
      ARENA_CLUSTER_BREEDING_DECAY_DAYS: "14",
      ARENA_CLUSTER_BREEDING_SEVERITY: "0.50",
      ARENA_CLUSTER_BREEDING_MIN_WEIGHT: "0.05",
      ARENA_CLUSTER_BREEDING_WINDOW_DAYS: "30",
    });
    expect(t.decayDays).toBe(14);
    expect(t.severity).toBe(0.50);
    expect(t.minWeight).toBe(0.05);
    expect(t.windowDays).toBe(30);
  });

  it("strips inline comments", () => {
    expect(readBreedingThresholdsFromEnv({ ARENA_CLUSTER_BREEDING_SEVERITY: "0.40 # harsh" }).severity).toBe(0.40);
  });
});

describe("isClusterAwareBreedingEnabled", () => {
  it("default ON", () => {
    expect(isClusterAwareBreedingEnabled({})).toBe(true);
  });

  it("CLUSTER_AWARE_BREEDING=0 disables", () => {
    expect(isClusterAwareBreedingEnabled({ CLUSTER_AWARE_BREEDING: "0" })).toBe(false);
  });

  it("CLUSTER_AWARE_BREEDING=false disables", () => {
    expect(isClusterAwareBreedingEnabled({ CLUSTER_AWARE_BREEDING: "false" })).toBe(false);
  });
});
