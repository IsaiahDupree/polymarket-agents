/**
 * Unit tests for src/lib/factory/stats.ts — the helpers behind the
 * progress dashboard. The dashboard renders these straight to the
 * terminal, so any silent rounding bug or off-by-one shows up as a
 * wrong "progress to 90%" number to the operator.
 */
import { describe, expect, it } from "vitest";

import {
  winRate,
  winRateHistogram,
  topAgents,
  bestWinRate,
  progressBar,
  nextCycleEtaMs,
  formatEta,
  projectDaysToTarget,
  DEFAULT_WINRATE_BUCKETS,
  type AgentRow,
} from "../../src/lib/factory/stats";

const agent = (overrides: Partial<AgentRow> = {}): AgentRow => ({
  id: 1, name: "test", trades_count: 0, wins_count: 0,
  realized_pnl_usd: 0, kind: "poly_fade_spike",
  ...overrides,
});

// ---------------------------------------------------------------------------
// winRate

describe("winRate", () => {
  it("returns 0 for an agent with no trades", () => {
    expect(winRate(agent())).toBe(0);
  });
  it("returns wins/trades as a fraction", () => {
    expect(winRate(agent({ trades_count: 10, wins_count: 7 }))).toBe(0.7);
  });
  it("handles a 100% winner cleanly", () => {
    expect(winRate(agent({ trades_count: 5, wins_count: 5 }))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// winRateHistogram

describe("winRateHistogram", () => {
  it("buckets agents into the 6 default bands, top-down", () => {
    const rows = [
      agent({ id: 1, trades_count: 100, wins_count: 95 }),  // 95% → 90-100
      agent({ id: 2, trades_count: 100, wins_count: 85 }),  // 85% → 80-90
      agent({ id: 3, trades_count: 100, wins_count: 75 }),  // 75% → 70-80
      agent({ id: 4, trades_count: 100, wins_count: 65 }),  // 65% → 60-70
      agent({ id: 5, trades_count: 100, wins_count: 55 }),  // 55% → 50-60
      agent({ id: 6, trades_count: 100, wins_count: 30 }),  // 30% → <50
      agent({ id: 7, trades_count: 100, wins_count: 49 }),  // 49% → <50
    ];
    const h = winRateHistogram(rows, 30);
    expect(h.map((b) => b.label)).toEqual(DEFAULT_WINRATE_BUCKETS.map((b) => b.label));
    expect(h[0].count).toBe(1);  // 90-100
    expect(h[1].count).toBe(1);  // 80-90
    expect(h[2].count).toBe(1);  // 70-80
    expect(h[3].count).toBe(1);  // 60-70
    expect(h[4].count).toBe(1);  // 50-60
    expect(h[5].count).toBe(2);  // <50
  });

  it("excludes agents below the minTrades floor (data-starvation)", () => {
    const rows = [
      agent({ id: 1, trades_count: 2, wins_count: 2 }),     // 100% but only 2 trades — excluded
      agent({ id: 2, trades_count: 50, wins_count: 45 }),   // 90% with real sample — included
    ];
    const h = winRateHistogram(rows, 30);
    const total = h.reduce((acc, b) => acc + b.count, 0);
    expect(total).toBe(1);
    expect(h[0].count).toBe(1);  // the 90% one
  });

  it("returns an all-zero histogram when no agent qualifies", () => {
    const h = winRateHistogram([], 30);
    expect(h.every((b) => b.count === 0)).toBe(true);
    expect(h).toHaveLength(DEFAULT_WINRATE_BUCKETS.length);
  });

  it("places 100% win rate in the 90-100 bucket (boundary)", () => {
    const h = winRateHistogram([
      agent({ trades_count: 100, wins_count: 100 }),
    ], 30);
    expect(h[0].count).toBe(1);
  });

  it("places exactly 90.0% in the 90-100 bucket, exactly 89.99% in 80-90", () => {
    // The bucket lo bound is inclusive — a 90% winner shouldn't be
    // misclassified as 80-90% because of an off-by-one.
    const at90 = winRateHistogram([agent({ trades_count: 100, wins_count: 90 })], 30);
    expect(at90[0].count).toBe(1);
    const below = winRateHistogram([agent({ trades_count: 10000, wins_count: 8999 })], 30);
    expect(below[1].count).toBe(1);  // 80-90 bucket
  });
});

// ---------------------------------------------------------------------------
// topAgents

describe("topAgents", () => {
  it("ranks by win rate desc, then PnL desc, then trades desc", () => {
    const rows = [
      agent({ id: 1, trades_count: 50, wins_count: 30, realized_pnl_usd: 10 }),  // 60%
      agent({ id: 2, trades_count: 50, wins_count: 40, realized_pnl_usd: 5 }),   // 80%
      agent({ id: 3, trades_count: 50, wins_count: 40, realized_pnl_usd: 20 }),  // 80%, higher PnL
    ];
    const top = topAgents(rows, 3, 30);
    expect(top.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(top[0].win_rate).toBe(0.8);
  });

  it("excludes agents below minTrades", () => {
    const rows = [
      agent({ id: 1, trades_count: 5, wins_count: 5 }),   // 100% but only 5 trades
      agent({ id: 2, trades_count: 50, wins_count: 30 }), // 60% but qualifies
    ];
    expect(topAgents(rows, 5, 30)).toHaveLength(1);
    expect(topAgents(rows, 5, 30)[0].id).toBe(2);
  });

  it("respects k and returns empty when no agent qualifies", () => {
    expect(topAgents([], 5, 30)).toEqual([]);
    const rows = [
      agent({ id: 1, trades_count: 50, wins_count: 30 }),
      agent({ id: 2, trades_count: 50, wins_count: 40 }),
    ];
    expect(topAgents(rows, 1, 30)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// bestWinRate

describe("bestWinRate", () => {
  it("returns the highest win rate among qualifying agents", () => {
    const rows = [
      agent({ trades_count: 50, wins_count: 30 }),  // 60%
      agent({ trades_count: 50, wins_count: 45 }),  // 90%
      agent({ trades_count: 50, wins_count: 25 }),  // 50%
    ];
    expect(bestWinRate(rows, 30)).toBeCloseTo(0.9);
  });

  it("returns 0 when no agent qualifies", () => {
    expect(bestWinRate([], 30)).toBe(0);
    expect(bestWinRate([agent({ trades_count: 2, wins_count: 2 })], 30)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// progressBar

describe("progressBar", () => {
  it("renders 0% as all empty cells", () => {
    expect(progressBar(0, 0.9, 10)).toBe("░".repeat(10));
  });
  it("renders 100%-of-target as all filled cells", () => {
    expect(progressBar(0.9, 0.9, 10)).toBe("█".repeat(10));
  });
  it("clamps values above the target to a full bar", () => {
    expect(progressBar(1.5, 0.9, 10)).toBe("█".repeat(10));
  });
  it("rounds to the nearest cell", () => {
    // 0.67 / 0.90 = 0.7444... → 7.44 cells → rounds to 7
    expect(progressBar(0.67, 0.90, 10)).toBe("█".repeat(7) + "░".repeat(3));
  });
  it("returns empty string when width is 0 or negative", () => {
    expect(progressBar(0.5, 0.9, 0)).toBe("");
    expect(progressBar(0.5, 0.9, -5)).toBe("");
  });
  it("treats NaN/negative value as 0", () => {
    expect(progressBar(Number.NaN, 0.9, 10)).toBe("░".repeat(10));
    expect(progressBar(-0.5, 0.9, 10)).toBe("░".repeat(10));
  });
  it("returns a full bar when target is 0 or negative (avoid divide-by-zero)", () => {
    expect(progressBar(0.5, 0, 10)).toBe("█".repeat(10));
    expect(progressBar(0.5, -1, 10)).toBe("█".repeat(10));
  });
});

// ---------------------------------------------------------------------------
// nextCycleEtaMs + formatEta

describe("nextCycleEtaMs", () => {
  it("returns the full interval when the cycle has never run", () => {
    expect(nextCycleEtaMs(0, 6 * 3_600_000, 1_000_000)).toBe(6 * 3_600_000);
  });
  it("subtracts elapsed time from the interval", () => {
    const now = 10_000_000;
    const lastRun = now - 3_600_000;   // 1h ago
    const interval = 6 * 3_600_000;     // 6h
    expect(nextCycleEtaMs(lastRun, interval, now)).toBe(5 * 3_600_000);
  });
  it("returns 0 when the cycle is overdue", () => {
    // Use a realistic epoch-millis `now` so subtracting 10h doesn't wrap
    // into negative territory (which the function reserves for "never ran").
    const now = Date.UTC(2026, 4, 30, 12, 0, 0);
    const lastRun = now - 10 * 3_600_000;
    expect(nextCycleEtaMs(lastRun, 6 * 3_600_000, now)).toBe(0);
  });
});

describe("formatEta", () => {
  it("prints GO when overdue", () => {
    expect(formatEta(0)).toBe("GO");
    expect(formatEta(-1)).toBe("GO");
  });
  it("prints minutes-only under 1h", () => {
    expect(formatEta(45 * 60_000)).toBe("45m");
    expect(formatEta(59 * 60_000)).toBe("59m");
  });
  it("prints h+m at 1h and above", () => {
    expect(formatEta(60 * 60_000)).toBe("1h0m");
    expect(formatEta((6 * 60 + 12) * 60_000)).toBe("6h12m");
  });
});

// ---------------------------------------------------------------------------
// projectDaysToTarget

describe("projectDaysToTarget", () => {
  it("returns null when the best win rate has not improved", () => {
    // No upward trend → projecting would lie about ETA.
    expect(projectDaysToTarget(0.50, 0.50, 24, 0.90)).toBeNull();
    expect(projectDaysToTarget(0.40, 0.50, 24, 0.90)).toBeNull();  // got worse
  });
  it("returns null when already at or above target", () => {
    expect(projectDaysToTarget(0.92, 0.50, 24, 0.90)).toBeNull();
    expect(projectDaysToTarget(0.90, 0.50, 24, 0.90)).toBeNull();
  });
  it("returns null when the window has no width", () => {
    expect(projectDaysToTarget(0.60, 0.50, 0, 0.90)).toBeNull();
  });
  it("linear projection: +5pp / 24h, gap 30pp → 6 days", () => {
    const days = projectDaysToTarget(0.55, 0.50, 24, 0.85);
    expect(days).toBeCloseTo(6, 5);  // (0.85 - 0.55) / (0.05 / 24) hours / 24 = 6 days
  });
  it("very slow rate produces a very large ETA (no crash on small deltas)", () => {
    const days = projectDaysToTarget(0.501, 0.500, 24, 0.90);
    expect(days).toBeGreaterThan(100);
    expect(Number.isFinite(days!)).toBe(true);
  });
});
