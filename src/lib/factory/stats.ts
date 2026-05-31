/**
 * Pure stats helpers for the factory dashboard. No DB / FS — all
 * functions take in arrays + numbers and return data shapes that the
 * renderer can print directly. Unit-tested in
 * tests/unit/factory-stats.test.ts.
 */

export type AgentRow = {
  id: number;
  name: string;
  /** Closed-trade count. Wins / losses are NOT classified individually here — the agent row carries an aggregate wins_count. */
  trades_count: number;
  wins_count: number;
  realized_pnl_usd: number;
  /** Genome kind, used for per-kind histograms. */
  kind: string;
};

export type WinRateBucket = {
  /** Lower bound, inclusive. Upper bound is the next bucket's lower; the last bucket caps at 1.0. */
  lo: number;
  hi: number;
  label: string;
  count: number;
};

/**
 * Default win-rate buckets used by the dashboard:
 *   <50%, 50-60%, 60-70%, 70-80%, 80-90%, 90-100%.
 * Buckets are returned top-down (90-100 first) so the histogram reads
 * from "great" to "bad" — matching how the operator scans it.
 */
export const DEFAULT_WINRATE_BUCKETS: ReadonlyArray<{ lo: number; hi: number; label: string }> = [
  { lo: 0.90, hi: 1.0001, label: "90-100%" },
  { lo: 0.80, hi: 0.90,   label: "80-90% " },
  { lo: 0.70, hi: 0.80,   label: "70-80% " },
  { lo: 0.60, hi: 0.70,   label: "60-70% " },
  { lo: 0.50, hi: 0.60,   label: "50-60% " },
  { lo: 0.00, hi: 0.50,   label: "<50%   " },
];

/** Win rate for one row (returns 0 when trades_count is 0). */
export function winRate(row: Pick<AgentRow, "trades_count" | "wins_count">): number {
  return row.trades_count > 0 ? row.wins_count / row.trades_count : 0;
}

/**
 * Bucket alive agents by win rate. Rows with `trades_count < minTrades`
 * are excluded entirely — a 100 %-win-rate-on-2-trades agent is not
 * meaningful signal toward the 90 % target and would distort the picture.
 */
export function winRateHistogram(
  rows: AgentRow[],
  minTrades: number,
  buckets: ReadonlyArray<{ lo: number; hi: number; label: string }> = DEFAULT_WINRATE_BUCKETS,
): WinRateBucket[] {
  const result: WinRateBucket[] = buckets.map((b) => ({ ...b, count: 0 }));
  for (const row of rows) {
    if (row.trades_count < minTrades) continue;
    const wr = winRate(row);
    for (const b of result) {
      if (wr >= b.lo && wr < b.hi) { b.count += 1; break; }
    }
  }
  return result;
}

/**
 * Top-K agents by win rate, ties broken by realized_pnl_usd then trades_count.
 * Agents below the trade floor are excluded (same reasoning as the histogram).
 */
export function topAgents(
  rows: AgentRow[],
  k: number,
  minTrades: number,
): Array<AgentRow & { win_rate: number }> {
  return rows
    .filter((r) => r.trades_count >= minTrades)
    .map((r) => ({ ...r, win_rate: winRate(r) }))
    .sort((a, b) => {
      if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
      if (b.realized_pnl_usd !== a.realized_pnl_usd) return b.realized_pnl_usd - a.realized_pnl_usd;
      return b.trades_count - a.trades_count;
    })
    .slice(0, k);
}

/**
 * Best win rate across qualifying agents (returns 0 when none qualify).
 * This is the value the "progress to 90%" bar tracks.
 */
export function bestWinRate(rows: AgentRow[], minTrades: number): number {
  let best = 0;
  for (const row of rows) {
    if (row.trades_count < minTrades) continue;
    const wr = winRate(row);
    if (wr > best) best = wr;
  }
  return best;
}

/**
 * ASCII progress bar.
 *
 *   progressBar(0.67, 0.90, 30) → "█████████████████████░░░░░░░░░"
 *
 * Inputs are clamped: negative / NaN value → 0, value > target → bar is full.
 * Width is the total column count (filled + empty cells).
 */
export function progressBar(value: number, target: number, width: number): string {
  if (width <= 0) return "";
  if (target <= 0) return "█".repeat(width);
  const v = Number.isFinite(value) && value > 0 ? value : 0;
  const ratio = Math.min(1, v / target);
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

/**
 * Estimated time until the next cycle, in milliseconds.
 *
 *   nextCycleEtaMs(lastRunAtMs, intervalMs, nowMs)
 *
 * Returns 0 if the cycle is overdue (so the renderer prints "GO" or "now").
 * Returns intervalMs when lastRunAt is 0 (never ran).
 */
export function nextCycleEtaMs(lastRunAtMs: number, intervalMs: number, nowMs = Date.now()): number {
  if (lastRunAtMs <= 0) return intervalMs;
  const elapsed = nowMs - lastRunAtMs;
  return Math.max(0, intervalMs - elapsed);
}

/**
 * Format an ETA in ms as "5h12m" / "23m" / "GO". Used by the dashboard
 * next-cycle column.
 */
export function formatEta(ms: number): string {
  if (ms <= 0) return "GO";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h${m}m`;
}

/**
 * Linear projection of when the best win rate will hit the target. Uses a
 * recent-window delta to compute pts/day, then divides the remaining gap.
 *
 * Returns null when:
 *   - the rate has not improved (delta ≤ 0) — projection would be infinite/nonsense
 *   - the best is already above target
 *   - the window is too short to be reliable (operator decides minimum)
 */
export function projectDaysToTarget(
  bestNow: number,
  bestEarlier: number,
  windowHours: number,
  target: number,
): number | null {
  if (windowHours <= 0) return null;
  if (bestNow >= target) return null;
  const delta = bestNow - bestEarlier;
  if (delta <= 0) return null;
  const ptsPerHour = delta / windowHours;
  if (ptsPerHour <= 0) return null;
  const remaining = target - bestNow;
  const hours = remaining / ptsPerHour;
  return hours / 24;
}
