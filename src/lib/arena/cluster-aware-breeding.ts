/**
 * Cluster-aware breeding pressure (Self-evolving improvement B).
 *
 * Penalizes the breeding score of parents whose strategy_family was
 * recently cluster-killswitched. The mutator + parent selector multiplies
 * each survivor's fitness by `clusterAwareWeight(family)` so the next
 * generation tilts AWAY from over-explored failing clusters.
 *
 * Pure module. Inputs: recent cluster-killswitch-trip events from
 * evolution_log + the candidate parent's strategy_family. Output: a
 * weight multiplier in [0.1, 1.0] that the caller multiplies into the
 * parent's fitness during selection.
 *
 * The penalty decays exponentially with time-since-trip so a one-off
 * cluster failure doesn't permanently shut down breeding for that family.
 * After ~7 days the weight returns to 1.0.
 *
 * Algorithm:
 *   For each parent's strategy_family:
 *     trip_events = cluster-killswitch-trip events in last 7d that
 *                   mentioned strategy_family_cluster OR mentioned this
 *                   family in the payload
 *     If no trips: weight = 1.0
 *     Else: weight = max(MIN_WEIGHT, exp(-decay × days_since_most_recent_trip))
 *           × (1 - severity_per_trip × trip_events.length)
 *
 *   MIN_WEIGHT = 0.10 (a family is never zeroed out — meta-evolution can
 *                       still rescue it; we just under-weight it)
 *
 * Env override:
 *   - CLUSTER_AWARE_BREEDING=0 — disable; weights always 1.0
 *   - ARENA_CLUSTER_BREEDING_DECAY_DAYS=7 — exp decay half-life-ish
 *   - ARENA_CLUSTER_BREEDING_SEVERITY=0.30 — penalty per trip event
 */

export type ClusterTripEvent = {
  /** ISO timestamp of the cluster-killswitch-trip. */
  ts: string;
  /** Reason — 'strategy_family_cluster' or 'asset_class_cluster' or 'global_*'. */
  reason: string;
  /** The strategy_family that tripped (parsed from event summary/payload). */
  strategy_family: string | null;
};

export type BreedingWeightThresholds = {
  /** Decay constant in days (per-day damping of the penalty). Default 7. */
  decayDays: number;
  /** Per-event severity factor — multiplier reduction per trip. Default 0.30. */
  severity: number;
  /** Min weight floor — a family is never under-weighted below this. Default 0.10. */
  minWeight: number;
  /** Look-back window for relevant trips. Default 14 days. */
  windowDays: number;
};

export const DEFAULT_BREEDING_THRESHOLDS: BreedingWeightThresholds = {
  decayDays: 7,
  severity: 0.30,
  minWeight: 0.10,
  windowDays: 14,
};

export function readBreedingThresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): BreedingWeightThresholds {
  return {
    decayDays: numFromEnv(env.ARENA_CLUSTER_BREEDING_DECAY_DAYS, DEFAULT_BREEDING_THRESHOLDS.decayDays),
    severity: numFromEnv(env.ARENA_CLUSTER_BREEDING_SEVERITY, DEFAULT_BREEDING_THRESHOLDS.severity),
    minWeight: numFromEnv(env.ARENA_CLUSTER_BREEDING_MIN_WEIGHT, DEFAULT_BREEDING_THRESHOLDS.minWeight),
    windowDays: numFromEnv(env.ARENA_CLUSTER_BREEDING_WINDOW_DAYS, DEFAULT_BREEDING_THRESHOLDS.windowDays),
  };
}

export function isClusterAwareBreedingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CLUSTER_AWARE_BREEDING;
  if (raw === undefined) return true; // default ON
  const cleaned = raw.replace(/\s*#.*$/, "").trim().replace(/^["']|["']$/g, "");
  return cleaned !== "0" && cleaned.toLowerCase() !== "false";
}

/**
 * Compute breeding weights per strategy_family from a list of recent
 * cluster trip events. Returns Map<family, weight in [minWeight, 1.0]>.
 *
 *   weight(family) = max(minWeight,
 *     (1 - severity × n_trips) × exp(-days_since_most_recent / decayDays))
 *
 *   - n_trips: number of trips in the window for this family
 *   - days_since_most_recent: how long ago the LAST trip was
 *
 * Families with no trips get weight 1.0 (no penalty).
 */
export function computeBreedingWeights(
  trips: readonly ClusterTripEvent[],
  thresholds: BreedingWeightThresholds = DEFAULT_BREEDING_THRESHOLDS,
  nowMs: number = Date.now(),
): Map<string, number> {
  const out = new Map<string, number>();
  const cutoffMs = nowMs - thresholds.windowDays * 86_400_000;

  // Group trips by family within the window.
  const byFamily = new Map<string, ClusterTripEvent[]>();
  for (const t of trips) {
    if (!t.strategy_family) continue;
    const tsMs = Date.parse(t.ts);
    if (!Number.isFinite(tsMs) || tsMs < cutoffMs) continue;
    const list = byFamily.get(t.strategy_family) ?? [];
    list.push(t);
    byFamily.set(t.strategy_family, list);
  }

  for (const [family, events] of byFamily.entries()) {
    // Most recent trip ts.
    const mostRecentMs = Math.max(...events.map((e) => Date.parse(e.ts)));
    const daysSince = (nowMs - mostRecentMs) / 86_400_000;
    // Severity-based reduction (capped at 1.0).
    const severityFactor = Math.max(0, 1 - thresholds.severity * events.length);
    // Time-decay factor (1 right after the trip → ~0.37 at decayDays days).
    const decayFactor = Math.exp(-daysSince / thresholds.decayDays);
    // Combined weight, floored.
    const weight = Math.max(thresholds.minWeight, severityFactor * decayFactor);
    out.set(family, weight);
  }
  return out;
}

/** Convenience: weight for a single family. Returns 1.0 if no recent trips. */
export function breedingWeightFor(
  family: string | null | undefined,
  trips: readonly ClusterTripEvent[],
  thresholds: BreedingWeightThresholds = DEFAULT_BREEDING_THRESHOLDS,
  nowMs: number = Date.now(),
): number {
  if (!family) return 1.0;
  const weights = computeBreedingWeights(trips, thresholds, nowMs);
  return weights.get(family) ?? 1.0;
}

function numFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const cleaned = raw.replace(/\s*#.*$/, "").trim().replace(/^["']|["']$/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}
