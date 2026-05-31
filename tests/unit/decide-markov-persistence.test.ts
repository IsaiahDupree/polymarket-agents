/**
 * Unit tests for decideMarkovPersistence() (in src/lib/arena/sim.ts).
 *
 * The strategy fires when:
 *   1. There is enough price history (>= min_history snapshots)
 *   2. The transition-matrix diagonal at the current state is within
 *      [min_persistence, max_persistence] — committed but not frozen
 *   3. |modelProb - marketPrice| >= min_edge after optional Becker correction
 *
 * Tests build price histories deterministically by clustering most prices in
 * one state (which produces a high-persistence diagonal at that state) and
 * varying the entry market price + the rest of the genome params to hit
 * each branch of the decision tree.
 */
import { describe, expect, it } from "vitest";
import { decide } from "@/lib/arena/sim";
import type { Genome } from "@/lib/arena/genome";
import type { LiveAgent, Snapshot, SnapshotWindow, TickContext } from "@/lib/arena/types";

// ── helpers ───────────────────────────────────────────────────────────────

const BASE_TIME = new Date("2026-05-30T20:00:00Z").getTime();

/**
 * Build a SnapshotWindow whose history places `clusterPct` of its samples in
 * a single price bucket (default 95%) and the rest scattered uniformly. This
 * gives the transition matrix a very high diagonal at the cluster state,
 * which is exactly what the strategy looks for.
 */
function makeClusteredWindow(
  marketId: string,
  clusterPrice: number,
  historyLen: number,
  latestPrice: number,
  clusterPct = 0.95,
): SnapshotWindow {
  const history: Snapshot[] = [];
  // Use a seeded-ish PRNG so the "scatter" prices are repeatable across runs.
  let seed = 1;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let i = 0; i < historyLen; i++) {
    const isCluster = rand() < clusterPct;
    const p = isCluster
      ? clusterPrice + (rand() - 0.5) * 0.01  // tight band around clusterPrice
      : rand();                                 // uniform scatter
    history.push({
      venue: "sim-poly", market_id: marketId, price: Math.max(0.01, Math.min(0.99, p)),
      captured_at: new Date(BASE_TIME + i * 60_000).toISOString(),
    });
  }
  const latest: Snapshot = {
    venue: "sim-poly", market_id: marketId, price: latestPrice,
    captured_at: new Date(BASE_TIME + historyLen * 60_000).toISOString(),
  };
  return { history: [...history, latest], latest };
}

function makeCtx(window: SnapshotWindow): TickContext {
  return {
    now: new Date(BASE_TIME + (window.history.length + 1) * 60_000).toISOString(),
    snapshots: new Map([[window.latest.market_id, window]]),
  };
}

function makeAgent(genome: Genome, cash = 1000): LiveAgent {
  return {
    id: 1, name: "test", generation: 0, parent_paper_agent_id: null,
    genome_json: JSON.stringify(genome), introduced_by: "test",
    cash_usd_start: 1000, cash_usd_current: cash, position_basket_json: "[]",
    realized_pnl_usd: 0, unrealized_pnl_usd: 0,
    peak_equity_usd: 1000, max_drawdown_usd: 0,
    trades_count: 0, entries_count: 0, wins_count: 0,
    alive: 1, retire_reason: null, retired_at: null,
    created_at: "", updated_at: "",
    genome,
    positions: [],
  };
}

const baseParams = {
  min_persistence: 0.80,
  max_persistence: 0.999,
  min_edge: 0.05,
  n_states: 10,
  n_sims: 500,
  time_horizon_steps: 5,
  min_history: 30,
  use_becker_calibration: "no" as const,
  entry_size_usd: 20,
};

function makeGenome(overrides: Partial<typeof baseParams> = {}): Genome {
  return { kind: "markov_persistence", params: { ...baseParams, ...overrides } };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("decideMarkovPersistence", () => {
  it("HOLD when history is below min_history", () => {
    const win = makeClusteredWindow("m1", 0.75, 10, 0.50);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome({ min_history: 50 }));
    expect(decide(agent, ctx, () => 0.5).kind).toBe("hold");
  });

  it("HOLD when persistence is too low (uniform price scatter)", () => {
    // clusterPct=0 → all prices uniformly scattered. No state will have
    // a high diagonal, so persistence < min_persistence everywhere.
    const win = makeClusteredWindow("m1", 0.5, 60, 0.50, 0);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome({ min_persistence: 0.80 }));
    expect(decide(agent, ctx, () => 0.5).kind).toBe("hold");
  });

  it("BUY when persistence high AND modelProb > marketPrice + min_edge", () => {
    // Cluster prices around 0.75 (state 7 in a 10-state matrix, ABOVE the
    // midpoint state 5). Latest price must ALSO be in the cluster — else
    // the current state's row has 0 observations and gets an identity row
    // (persistence = 1.0, frozen-chain HOLD). So latest = clusterPrice.
    // The "edge" then comes from probYes ≈ 1.0 (chain stays above midpoint)
    // vs the market price ≈ 0.75 → edge = +0.25 → BUY.
    const win = makeClusteredWindow("m1", 0.75, 60, 0.75);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome());
    const sig = decide(agent, ctx, () => 0.5);
    expect(sig.kind).toBe("entry");
    if (sig.kind === "entry") {
      expect(sig.side).toBe("BUY");
      expect(sig.venue).toBe("sim-poly");
      expect(sig.market_id).toBe("m1");
      expect(sig.rationale).toContain("markov");
      expect(sig.rationale).toContain("persistence=");
    }
  });

  it("SELL when persistence high AND modelProb < marketPrice − min_edge", () => {
    // Cluster around 0.20 (state 2, BELOW midpoint). Latest = 0.20 keeps
    // currentState=2 with real observations (non-identity row). MC walks
    // stay near state 2 → probYes ≈ 0 → edge = 0 − 0.20 = −0.20 → SELL.
    const win = makeClusteredWindow("m1", 0.25, 60, 0.25);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome());
    const sig = decide(agent, ctx, () => 0.5);
    expect(sig.kind).toBe("entry");
    if (sig.kind === "entry") {
      expect(sig.side).toBe("SELL");
    }
  });

  it("HOLD when persistence above max_persistence (frozen chain)", () => {
    // Set clusterPct=1.0 — every transition is a self-loop, diagonal ≈ 1.0.
    // max_persistence at 0.95 should fail this.
    const win = makeClusteredWindow("m1", 0.75, 60, 0.30, 1.0);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome({ max_persistence: 0.95 }));
    expect(decide(agent, ctx, () => 0.5).kind).toBe("hold");
  });

  it("HOLD when edge is below min_edge", () => {
    // Strong persistence at state 7 (cluster at 0.75). probYes ≈ 1.0;
    // market = 0.75 → expected edge ≈ 0.25. Push min_edge above that
    // expected gap so no entry fires.
    const win = makeClusteredWindow("m1", 0.75, 60, 0.75);
    const ctx = makeCtx(win);
    const tightAgent = makeAgent(makeGenome({ min_edge: 0.50 }));
    expect(decide(tightAgent, ctx, () => 0.5).kind).toBe("hold");
    // Sanity: confirm a regular-edge agent fires on the same window so
    // we know the only difference was min_edge, not some other gate.
    const regularAgent = makeAgent(makeGenome({ min_edge: 0.05 }));
    expect(decide(regularAgent, ctx, () => 0.5).kind).toBe("entry");
  });

  it("HOLD when agent already holds a position in the only qualifying market", () => {
    const win = makeClusteredWindow("m1", 0.25, 60, 0.25);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome());
    agent.positions.push({
      venue: "sim-poly", market_id: "m1", side: "SELL",
      size_usd: 10, entry_price: 0.20, opened_at: ctx.now,
    });
    expect(decide(agent, ctx, () => 0.5).kind).toBe("hold");
  });

  it("HOLD when agent has $0 cash", () => {
    const win = makeClusteredWindow("m1", 0.25, 60, 0.25);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome(), 0);
    expect(decide(agent, ctx, () => 0.5).kind).toBe("hold");
  });

  it("rationale string contains key diagnostic numbers", () => {
    const win = makeClusteredWindow("m1", 0.25, 60, 0.25);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome());
    const sig = decide(agent, ctx, () => 0.5);
    expect(sig.kind).toBe("entry");
    if (sig.kind === "entry") {
      expect(sig.rationale).toMatch(/persistence=0\.\d+/);
      expect(sig.rationale).toMatch(/edge=-?\d+(\.\d+)?pp/);
      expect(sig.rationale).toMatch(/n_states=10/);
      expect(sig.rationale).toMatch(/horizon=5/);
    }
  });

  it("Becker calibration label appears in rationale when enabled", () => {
    const win = makeClusteredWindow("m1", 0.25, 60, 0.25);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome({ use_becker_calibration: "yes" }));
    const sig = decide(agent, ctx, () => 0.5);
    expect(sig.kind).toBe("entry");
    if (sig.kind === "entry") {
      expect(sig.rationale).toContain("p_calibrated=");
    }
  });

  it("size_usd is clamped to cash when agent is low on funds", () => {
    const win = makeClusteredWindow("m1", 0.25, 60, 0.25);
    const ctx = makeCtx(win);
    const agent = makeAgent(makeGenome({ entry_size_usd: 100 }), /* cash */ 7);
    const sig = decide(agent, ctx, () => 0.5);
    expect(sig.kind).toBe("entry");
    if (sig.kind === "entry") {
      expect(sig.size_usd).toBe(7);
    }
  });
});
