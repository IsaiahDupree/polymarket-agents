/**
 * Live per-agent diagnostic — mirrors the calculations in sim.ts:decide() but
 * returns the *numeric reading + threshold* instead of a Signal, so the UI can
 * show what each agent is waiting for when the market is too quiet to fire.
 *
 * Pure read; safe for SSR. Per-strategy logic intentionally duplicates a small
 * piece of sim.ts so the diagnostic stays accurate even if the dispatcher
 * grows. Keep this file in sync when adding new genome kinds.
 */
import { acceleration, loadRecentCandles, velocity } from "./momentum";
import type { LiveAgent, Snapshot, TickContext } from "./types";

export type DiagStatus = "in-position" | "would-enter" | "watching" | "no-data";

export type AgentDiagnostic = {
  status: DiagStatus;
  /** Short label for the column (~30 chars). */
  label: string;
  /** Optional detail for tooltip / future drawer. */
  detail?: string;
};

function minutesSince(iso: string, now: string): number {
  return (new Date(now).getTime() - new Date(iso).getTime()) / 60_000;
}
function meanStd(snaps: Snapshot[]): { mean: number; sd: number } {
  if (snaps.length === 0) return { mean: 0, sd: 0 };
  const mean = snaps.reduce((a, s) => a + s.price, 0) / snaps.length;
  if (snaps.length < 2) return { mean, sd: 0 };
  const variance = snaps.reduce((a, s) => a + (s.price - mean) ** 2, 0) / (snaps.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}
function nthFromEnd(history: Snapshot[], minutesAgo: number, now: string): Snapshot | undefined {
  const cutoffMs = new Date(now).getTime() - minutesAgo * 60_000;
  for (let i = history.length - 1; i >= 0; i--) {
    if (new Date(history[i].captured_at).getTime() <= cutoffMs) return history[i];
  }
  return history[0];
}

export function diagnoseAgent(agent: LiveAgent, ctx: TickContext): AgentDiagnostic {
  if (agent.positions.length > 0) {
    return { status: "in-position", label: `${agent.positions.length} open` };
  }
  const g = agent.genome;
  switch (g.kind) {
    case "cb_momentum_burst": {
      const p = g.params;
      const win = ctx.snapshots.get(p.product_id);
      if (!win) return { status: "no-data", label: `no ${p.product_id} snaps` };
      const cutoffUnix = Math.floor(new Date(ctx.now).getTime() / 1000);
      const lookbackMin = Math.max(p.vel_window_min * 2 + 5, 30);
      const candles = loadRecentCandles(p.product_id, lookbackMin, { cutoffUnix });
      if (candles.length < p.vel_window_min + 2) {
        return { status: "no-data", label: `${candles.length}/${p.vel_window_min + 2} candles` };
      }
      const v = velocity(candles, p.vel_window_min);
      const a = acceleration(candles, p.vel_window_min);
      const vPct = (v * 100).toFixed(3);
      const aPct = (a * 100).toFixed(3);
      const thrV = (p.vel_entry_pct * 100).toFixed(2);
      const thrA = (p.accel_min * 100).toFixed(3);
      const longFires = v >= p.vel_entry_pct && a >= p.accel_min;
      const shortFires = p.direction_bias === "long_short" && v <= -p.vel_entry_pct && a <= -p.accel_min;
      const fires = longFires || shortFires;
      return {
        status: fires ? "would-enter" : "watching",
        label: `v=${vPct}% / ≥${thrV}% · a=${aPct}% / ≥${thrA}%`,
        detail: `bias=${p.direction_bias}`,
      };
    }
    case "cb_mean_reversion": {
      const p = g.params;
      const win = ctx.snapshots.get(p.product_id);
      if (!win) return { status: "no-data", label: `no ${p.product_id} snaps` };
      const cutoffMs = new Date(ctx.now).getTime() - p.lookback_min * 60_000;
      const inWindow = win.history.filter((s) => new Date(s.captured_at).getTime() >= cutoffMs);
      if (inWindow.length < 12) return { status: "no-data", label: `${inWindow.length}/12 snaps` };
      const { mean, sd } = meanStd(inWindow);
      if (sd <= 0) return { status: "no-data", label: "σ=0" };
      const z = (win.latest.price - mean) / sd;
      const fires = z <= -p.z_entry;
      return {
        status: fires ? "would-enter" : "watching",
        label: `z=${z.toFixed(2)} / ≤${(-p.z_entry).toFixed(2)}`,
        detail: `μ=${mean.toFixed(2)} σ=${sd.toFixed(2)} window=${p.lookback_min}min`,
      };
    }
    case "poly_fade_spike": {
      const p = g.params;
      let best: { mid: string; pts: number; quietPts: number } | null = null;
      for (const [mid, win] of ctx.snapshots) {
        if (win.latest.venue !== "sim-poly") continue;
        const lookbackSnap = nthFromEnd(win.history, p.lookback_h * 60, ctx.now);
        const confirmSnap = nthFromEnd(win.history, p.confirm_quiet_h * 60, ctx.now);
        if (!lookbackSnap || !confirmSnap) continue;
        const pts = (win.latest.price - lookbackSnap.price) * 100;
        const quietPts = Math.abs((win.latest.price - confirmSnap.price) * 100);
        if (!best || Math.abs(pts) > Math.abs(best.pts)) best = { mid, pts, quietPts };
      }
      if (!best) return { status: "no-data", label: "no poly markets" };
      const fires = Math.abs(best.pts) >= p.threshold_pts && best.quietPts <= p.threshold_pts / 2;
      return {
        status: fires ? "would-enter" : "watching",
        label: `move=${best.pts.toFixed(1)}pt / ≥${p.threshold_pts.toFixed(1)}pt`,
        detail: `quiet=${best.quietPts.toFixed(1)}pt vs ≤${(p.threshold_pts / 2).toFixed(1)}pt`,
      };
    }
    case "poly_breakout": {
      const p = g.params;
      let best: { ratio: number } | null = null;
      for (const [, win] of ctx.snapshots) {
        if (win.latest.venue !== "sim-poly") continue;
        const inWindow = win.history.filter((s) => minutesSince(s.captured_at, ctx.now) <= p.lookback_h * 60);
        if (inWindow.length < 4) continue;
        const max = Math.max(...inWindow.map((s) => s.price));
        if (max <= 0) continue;
        const ratio = win.latest.price / max;
        if (!best || ratio > best.ratio) best = { ratio };
      }
      if (!best) return { status: "no-data", label: "thin poly history" };
      const fires = best.ratio > p.breakout_mult;
      return {
        status: fires ? "would-enter" : "watching",
        label: `top=${best.ratio.toFixed(3)}× / >${p.breakout_mult.toFixed(2)}×`,
      };
    }
    case "cb_breakout": {
      const p = g.params;
      const win = ctx.snapshots.get(p.product_id);
      if (!win) return { status: "no-data", label: `no ${p.product_id} snaps` };
      const inWindow = win.history.filter((s) => minutesSince(s.captured_at, ctx.now) <= p.lookback_min);
      if (inWindow.length < 4) return { status: "no-data", label: `${inWindow.length}/4 snaps` };
      const max = Math.max(...inWindow.map((s) => s.price));
      const ratio = max > 0 ? win.latest.price / max : 0;
      const fires = ratio > p.breakout_mult;
      return {
        status: fires ? "would-enter" : "watching",
        label: `ratio=${ratio.toFixed(4)} / >${p.breakout_mult.toFixed(3)}`,
      };
    }
    case "cross_venue_arb": {
      const p = g.params;
      const polyProb = ctx.polyImpliedProb?.get(p.poly_condition_id);
      const bsProb = ctx.bsImpliedProb?.get(p.poly_condition_id);
      if (polyProb === undefined || bsProb === undefined) {
        return { status: "no-data", label: "bs/poly prob missing" };
      }
      const spread = (polyProb - bsProb) * 100;
      const fires = Math.abs(spread) >= p.edge_pts;
      return {
        status: fires ? "would-enter" : "watching",
        label: `spread=${spread.toFixed(1)}pt / ≥${p.edge_pts.toFixed(0)}pt`,
        detail: `poly=${(polyProb * 100).toFixed(1)}% bs=${(bsProb * 100).toFixed(1)}%`,
      };
    }
    case "random_walk_baseline": {
      const p = g.params;
      return {
        status: "watching",
        label: `trade_prob=${(p.trade_prob * 100).toFixed(1)}% per tick`,
      };
    }
  }
}

/** Batched diagnostic for many agents — single ctx, no extra DB unless the
 *  strategy itself needs candles (which already caches in better-sqlite3). */
export function diagnoseAgents(agents: LiveAgent[], ctx: TickContext): Map<number, AgentDiagnostic> {
  const out = new Map<number, AgentDiagnostic>();
  for (const a of agents) out.set(a.id, diagnoseAgent(a, ctx));
  return out;
}
