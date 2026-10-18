/**
 * Hermes nightly review — @0xRicker article #2, Section 06: Self-learning loop.
 *
 * Article snippet (verbatim):
 *
 *   Every day at midnight, read the trade journal from today.
 *   Analyze:
 *     - Which Markov states had the highest win rate
 *     - Which entry price ranges performed best (EV per trade)
 *     - Whether current MIN_PROB should be adjusted up or down
 *     - Whether Kelly f* is correctly sized given recent results
 *   Then update the .env config and strategy parameters accordingly.
 *
 * This module is the HEURISTIC implementation. A separate LLM-augmented
 * version in nightly-review-llm.ts can produce richer rationale; the
 * heuristic here is the floor — it always runs, doesn't need auth, and
 * is unit-testable.
 *
 * IMPORTANT: This produces *proposals*, not auto-updates. The article
 * suggests "update the .env config automatically" but on this codebase
 * we never silently rewrite a strategy spec. The proposal flows into
 * evolution_log as a `markov-threshold-proposal` event for an operator
 * to review.
 *
 * Pure function. The caller supplies the journal rows + current
 * thresholds; this module decides what to suggest.
 */

export type ExecRow = {
  /** evolution_log row id. */
  id: number;
  /** ISO timestamp. */
  createdAt: string;
  /** Parsed payload — fields: orderUsd, persistence, calibratedProbYes, marketPrice, side, verdict, etc. */
  payload: {
    orderUsd?: number;
    persistence?: number;
    calibratedProbYes?: number;
    marketPrice?: number;
    side?: "YES" | "NO";
    pTrueUsed?: number;
    kelly?: number;
    verdict?: { status?: string; brokerOrderId?: string; reason?: string };
    [k: string]: unknown;
  };
};

export type CurrentThresholds = {
  /** Article default 0.87. */
  minPersistence: number;
  /** Article default 0.99. */
  maxPersistence: number;
  /** Article default 0.05. */
  minEdge: number;
  /** Quarter-Kelly = 0.25. */
  kellyFraction: number;
};

export type ThresholdProposal = {
  /** Computed counts + rates. */
  stats: {
    totalExecs: number;
    filledCount: number;
    skippedCount: number;
    rejectedCount: number;
    fillRate: number;
    avgPersistence: number;
    avgEdgePctPp: number;
    avgKelly: number;
    totalUsdDeployed: number;
  };
  /** Suggested new threshold values (caller decides whether to apply). */
  proposed: Partial<CurrentThresholds>;
  /** Human-readable rationale. */
  rationale: string;
  /** "no_change" if the data doesn't justify a tweak. */
  outcome: "tighten" | "loosen" | "no_change" | "insufficient_data";
};

/**
 * Compute a threshold proposal from the last N hours of execution rows.
 *
 *   - If fill rate is low (< 30%) → loosen (lower minEdge or minPersistence)
 *   - If fill rate is high (> 80%) AND avg edge per fill was thin → tighten
 *   - If we don't have enough data (< 10 rows) → no_change with insufficient_data
 *
 * The thresholds we propose are bounded: minPersistence in [0.70, 0.95],
 * minEdge in [0.02, 0.20], etc. — so a runaway loop can't push the system
 * into a degenerate state.
 */
export function buildNightlyReview(
  rows: ExecRow[],
  current: CurrentThresholds,
): ThresholdProposal {
  const totalExecs = rows.length;
  const filled = rows.filter((r) => r.payload.verdict?.status === "filled" || r.payload.verdict?.status === "partially_filled");
  const skipped = rows.filter((r) => typeof (r.payload as any).skipped === "string");
  const rejected = rows.filter((r) => r.payload.verdict?.status && !["filled", "partially_filled"].includes(r.payload.verdict.status));
  const filledCount = filled.length;
  const skippedCount = skipped.length;
  const rejectedCount = rejected.length;
  const fillRate = totalExecs > 0 ? filledCount / totalExecs : 0;

  function avg(xs: number[]): number {
    return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  }

  const persistences = filled
    .map((r) => Number(r.payload.persistence))
    .filter((x): x is number => Number.isFinite(x));
  const edgesPp = filled
    .map((r) => {
      const cal = Number(r.payload.calibratedProbYes);
      const px = Number(r.payload.marketPrice);
      if (!Number.isFinite(cal) || !Number.isFinite(px)) return Number.NaN;
      return Math.abs(cal - px) * 100;
    })
    .filter((x): x is number => Number.isFinite(x));
  const kellies = filled
    .map((r) => Number(r.payload.kelly))
    .filter((x): x is number => Number.isFinite(x));
  const usdDeployed = rows
    .map((r) => Number(r.payload.orderUsd ?? 0))
    .reduce((a, b) => a + b, 0);

  const stats = {
    totalExecs,
    filledCount,
    skippedCount,
    rejectedCount,
    fillRate,
    avgPersistence: avg(persistences),
    avgEdgePctPp: avg(edgesPp),
    avgKelly: avg(kellies),
    totalUsdDeployed: usdDeployed,
  };

  // Insufficient data — refuse to suggest anything.
  if (totalExecs < 10) {
    return {
      stats,
      proposed: {},
      rationale: `Only ${totalExecs} exec rows in window — need at least 10 for a meaningful sample.`,
      outcome: "insufficient_data",
    };
  }

  const proposals: Partial<CurrentThresholds> = {};
  const reasons: string[] = [];

  // Bounds + step sizes.
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const minPersistenceBounds: [number, number] = [0.70, 0.95];
  const minEdgeBounds: [number, number] = [0.02, 0.20];

  if (fillRate < 0.3 && totalExecs >= 20) {
    // Too restrictive — loosen.
    if (current.minPersistence > minPersistenceBounds[0]) {
      proposals.minPersistence = clamp(current.minPersistence - 0.02, minPersistenceBounds[0], minPersistenceBounds[1]);
      reasons.push(
        `Fill rate ${(fillRate * 100).toFixed(0)}% (n=${totalExecs}) — lower minPersistence from ${current.minPersistence.toFixed(2)} to ${proposals.minPersistence.toFixed(2)}.`,
      );
    }
    if (current.minEdge > minEdgeBounds[0]) {
      proposals.minEdge = clamp(current.minEdge - 0.005, minEdgeBounds[0], minEdgeBounds[1]);
      reasons.push(
        `Also lower minEdge from ${(current.minEdge * 100).toFixed(1)}pp to ${(proposals.minEdge * 100).toFixed(1)}pp.`,
      );
    }
    if (Object.keys(proposals).length === 0) {
      return {
        stats,
        proposed: {},
        rationale: `Fill rate low (${(fillRate * 100).toFixed(0)}%) but thresholds already at their bounds; can't loosen further.`,
        outcome: "no_change",
      };
    }
    return {
      stats,
      proposed: proposals,
      rationale: reasons.join(" "),
      outcome: "loosen",
    };
  }

  if (fillRate > 0.8 && stats.avgEdgePctPp < current.minEdge * 100 * 1.5 && totalExecs >= 20) {
    // Plenty of fills but the per-fill edge is barely above the threshold —
    // we're scraping the bottom of the barrel. Tighten.
    if (current.minPersistence < minPersistenceBounds[1]) {
      proposals.minPersistence = clamp(current.minPersistence + 0.01, minPersistenceBounds[0], minPersistenceBounds[1]);
      reasons.push(
        `Fill rate ${(fillRate * 100).toFixed(0)}% with avg edge only ${stats.avgEdgePctPp.toFixed(1)}pp — raise minPersistence from ${current.minPersistence.toFixed(2)} to ${proposals.minPersistence.toFixed(2)}.`,
      );
    }
    if (current.minEdge < minEdgeBounds[1]) {
      proposals.minEdge = clamp(current.minEdge + 0.005, minEdgeBounds[0], minEdgeBounds[1]);
      reasons.push(
        `Also raise minEdge from ${(current.minEdge * 100).toFixed(1)}pp to ${(proposals.minEdge * 100).toFixed(1)}pp.`,
      );
    }
    if (Object.keys(proposals).length === 0) {
      return {
        stats,
        proposed: {},
        rationale: `Fill rate high with thin per-fill edge but thresholds already at their bounds.`,
        outcome: "no_change",
      };
    }
    return {
      stats,
      proposed: proposals,
      rationale: reasons.join(" "),
      outcome: "tighten",
    };
  }

  return {
    stats,
    proposed: {},
    rationale: `Fill rate ${(fillRate * 100).toFixed(0)}% (n=${totalExecs}), avg edge ${stats.avgEdgePctPp.toFixed(1)}pp, avg persistence ${stats.avgPersistence.toFixed(2)} — within healthy band.`,
    outcome: "no_change",
  };
}
