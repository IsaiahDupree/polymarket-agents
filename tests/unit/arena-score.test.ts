import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DD_PENALTY,
  WINRATE_DD_PENALTY,
  WINRATE_LOSER_SENTINEL,
  WINRATE_UNRANKED_SENTINEL,
  partitionSurvivors,
  rankAgents,
  scoreAgent,
} from "@/lib/arena/score";
import type { PaperAgentRow } from "@/lib/arena/types";

function agent(overrides: Partial<PaperAgentRow> = {}): PaperAgentRow {
  return {
    id: 1, name: "a", generation: 0, parent_paper_agent_id: null,
    genome_json: "{}", introduced_by: "init",
    cash_usd_start: 1000, cash_usd_current: 1000, position_basket_json: "[]",
    realized_pnl_usd: 0, unrealized_pnl_usd: 0,
    peak_equity_usd: 1000, max_drawdown_usd: 0,
    trades_count: 0, wins_count: 0, alive: 1, retire_reason: null, retired_at: null,
    created_at: "", updated_at: "",
    ...overrides,
  };
}

// The legacy formula tests pin ARENA_FITNESS_MODE=pnl_dd. After the
// 2026-05-30 switch the default is "winrate", so each describe block sets
// the mode it expects rather than relying on the global default.
describe("scoreAgent — legacy pnl_dd mode: fitness = pnl_pct − 2 × max_dd_pct", () => {
  const savedMode = process.env.ARENA_FITNESS_MODE;
  beforeEach(() => { process.env.ARENA_FITNESS_MODE = "pnl_dd"; });
  afterEach(() => {
    if (savedMode === undefined) delete process.env.ARENA_FITNESS_MODE;
    else process.env.ARENA_FITNESS_MODE = savedMode;
  });


  it("zero pnl + zero drawdown → fitness 0", () => {
    const s = scoreAgent(agent());
    expect(s.pnl_pct).toBe(0);
    expect(s.max_dd_pct).toBe(0);
    expect(s.fitness).toBe(0);
  });

  it("+10% pnl, 0 drawdown → fitness = +0.10", () => {
    const s = scoreAgent(agent({ cash_usd_current: 1100 }));
    expect(s.pnl_pct).toBeCloseTo(0.10, 6);
    expect(s.fitness).toBeCloseTo(0.10, 6);
  });

  it("+5% pnl with 10% drawdown → fitness = 0.05 − 0.20 = −0.15", () => {
    const s = scoreAgent(agent({ cash_usd_current: 1050, peak_equity_usd: 1100, max_drawdown_usd: 110 }));
    expect(s.pnl_pct).toBeCloseTo(0.05, 6);
    expect(s.max_dd_pct).toBeCloseTo(0.10, 6);
    expect(s.fitness).toBeCloseTo(0.05 - DD_PENALTY * 0.10, 6);
  });

  it("win_rate divides wins_count by trades_count", () => {
    const s = scoreAgent(agent({ trades_count: 10, wins_count: 7 }));
    expect(s.win_rate).toBeCloseTo(0.7);
  });

  it("includes unrealized pnl in the equity used for pnl_pct", () => {
    const s = scoreAgent(agent({ cash_usd_current: 800, unrealized_pnl_usd: 250 })); // equity 1050
    expect(s.pnl_pct).toBeCloseTo(0.05, 6);
  });
});

describe("rankAgents + partitionSurvivors", () => {
  const savedMode = process.env.ARENA_FITNESS_MODE;
  beforeEach(() => { process.env.ARENA_FITNESS_MODE = "pnl_dd"; });
  afterEach(() => {
    if (savedMode === undefined) delete process.env.ARENA_FITNESS_MODE;
    else process.env.ARENA_FITNESS_MODE = savedMode;
  });

  it("ranks by fitness descending and breaks ties by realized PnL", () => {
    const a = agent({ id: 1, cash_usd_current: 1100, realized_pnl_usd: 100 });
    const b = agent({ id: 2, cash_usd_current: 1100, realized_pnl_usd: 50 }); // same fitness, lower realized
    const c = agent({ id: 3, cash_usd_current: 900, realized_pnl_usd: -100 });
    const ranked = rankAgents([c, b, a]);
    expect(ranked[0].agent.id).toBe(1);
    expect(ranked[1].agent.id).toBe(2);
    expect(ranked[2].agent.id).toBe(3);
  });

  it("partitionSurvivors at 50% picks top half", () => {
    const ranked = rankAgents([
      agent({ id: 1, cash_usd_current: 1500 }),
      agent({ id: 2, cash_usd_current: 1200 }),
      agent({ id: 3, cash_usd_current: 1000 }),
      agent({ id: 4, cash_usd_current: 700 }),
    ]);
    const { survivors, cull } = partitionSurvivors(ranked, 0.5);
    expect(survivors.map((r) => r.agent.id)).toEqual([1, 2]);
    expect(cull.map((r) => r.agent.id)).toEqual([3, 4]);
  });

  it("partitionSurvivors leaves at least 1 survivor", () => {
    const ranked = rankAgents([agent({ id: 9 })]);
    const { survivors, cull } = partitionSurvivors(ranked, 0.0);
    expect(survivors.length).toBe(1);
    expect(cull.length).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// Win-rate fitness mode (default since 2026-05-30, BTC Up/Down loop)
// ---------------------------------------------------------------------------

describe("scoreAgent — winrate mode", () => {
  const savedMode = process.env.ARENA_FITNESS_MODE;
  const savedMin = process.env.ARENA_MIN_TRADES_FOR_RANKING;
  const savedPow = process.env.ARENA_WINRATE_POWER;
  beforeEach(() => {
    process.env.ARENA_FITNESS_MODE = "winrate";
    // Lower the data-starvation floor so tests can stay small.
    process.env.ARENA_MIN_TRADES_FOR_RANKING = "10";
    // Default power=2 (steepens gradient near 1.0). Set explicitly to
    // detach from any env that might be configured for these tests.
    process.env.ARENA_WINRATE_POWER = "2";
  });
  afterEach(() => {
    if (savedMode === undefined) delete process.env.ARENA_FITNESS_MODE;
    else process.env.ARENA_FITNESS_MODE = savedMode;
    if (savedMin === undefined) delete process.env.ARENA_MIN_TRADES_FOR_RANKING;
    else process.env.ARENA_MIN_TRADES_FOR_RANKING = savedMin;
    if (savedPow === undefined) delete process.env.ARENA_WINRATE_POWER;
    else process.env.ARENA_WINRATE_POWER = savedPow;
  });

  it("agents below MIN_TRADES_FOR_RANKING get the data-starved sentinel", () => {
    const s = scoreAgent(agent({ trades_count: 3, wins_count: 3, cash_usd_current: 1100 }));
    expect(s.mode).toBe("winrate");
    expect(s.fitness).toBeLessThan(WINRATE_UNRANKED_SENTINEL + 100);  // ~ -1M + 3 - 0 = -999997
  });

  it("at the trade-count floor, fitness ≈ win_rate^2 · log1p(n) · (1 + pnl_pct) − 0.5·dd", () => {
    const a = agent({
      trades_count: 20, wins_count: 18, cash_usd_current: 1050,
    });
    const s = scoreAgent(a);
    const expected = Math.pow(18 / 20, 2) * Math.log1p(20) * 1.05;  // dd = 0
    expect(s.fitness).toBeCloseTo(expected, 4);
  });

  it("90% win rate beats 55% win rate at equal trade count + dd", () => {
    const sniper = agent({ id: 1, trades_count: 50, wins_count: 45, cash_usd_current: 1050 });
    const flipper = agent({ id: 2, trades_count: 50, wins_count: 28, cash_usd_current: 1050 });
    expect(scoreAgent(sniper).fitness).toBeGreaterThan(scoreAgent(flipper).fitness);
  });

  it("rewards data accumulation: more trades at same win rate scores higher (log1p)", () => {
    const a = agent({ id: 1, trades_count: 20, wins_count: 18, cash_usd_current: 1050 });
    const b = agent({ id: 2, trades_count: 200, wins_count: 180, cash_usd_current: 1050 });
    expect(scoreAgent(b).fitness).toBeGreaterThan(scoreAgent(a).fitness);
  });

  it("gambler with one huge win and many losses loses to steady sniper", () => {
    // Gambler: 50 trades, 5 wins (10% win rate), but big PnL from one outlier
    const gambler = agent({ id: 1, trades_count: 50, wins_count: 5, cash_usd_current: 1500 });
    // Sniper: 50 trades, 45 wins (90%), modest PnL
    const sniper = agent({ id: 2, trades_count: 50, wins_count: 45, cash_usd_current: 1100 });
    // The whole point of winrate mode: sniper wins despite worse PnL.
    expect(scoreAgent(sniper).fitness).toBeGreaterThan(scoreAgent(gambler).fitness);
  });

  it("drawdown penalty reduces fitness by 0.5 · max_dd_pct", () => {
    const clean = agent({ id: 1, trades_count: 20, wins_count: 18, cash_usd_current: 1050 });
    const drawn = agent({ id: 2, trades_count: 20, wins_count: 18, cash_usd_current: 1050,
                          peak_equity_usd: 1100, max_drawdown_usd: 110 }); // 10% dd
    const delta = scoreAgent(clean).fitness - scoreAgent(drawn).fitness;
    expect(delta).toBeCloseTo(WINRATE_DD_PENALTY * 0.10, 4);
  });

  it("exposes mode in the returned Score object", () => {
    const s = scoreAgent(agent({ trades_count: 20, wins_count: 18 }));
    expect(s.mode).toBe("winrate");
  });

  it("squared win_rate term: 90% sniper at 100 trades beats 60% flipper at 1000 trades", () => {
    // With linear win_rate, the volume-advantaged 60% flipper would win
    // (0.60·log1p(1000) ≈ 4.15 vs 0.90·log1p(100) ≈ 4.16 — basically tied).
    // With win_rate² the 90% wins decisively:
    //   90% sniper: 0.81 · log1p(100) ≈ 3.74
    //   60% flipper: 0.36 · log1p(1000) ≈ 2.49
    // This is the survival pressure that pushes evolution toward 90 %+.
    const sniper = agent({ id: 1, trades_count: 100, wins_count: 90, cash_usd_current: 1000 });
    const flipper = agent({ id: 2, trades_count: 1000, wins_count: 600, cash_usd_current: 1000 });
    expect(scoreAgent(sniper).fitness).toBeGreaterThan(scoreAgent(flipper).fitness);
  });

  it("ARENA_WINRATE_POWER=1 (linear) — back-compat with the original linear formula", () => {
    process.env.ARENA_WINRATE_POWER = "1";
    const a = agent({ trades_count: 20, wins_count: 18, cash_usd_current: 1050 });
    const s = scoreAgent(a);
    const expected = (18 / 20) * Math.log1p(20) * 1.05;
    expect(s.fitness).toBeCloseTo(expected, 4);
  });

  // ── HARD CUTOFF for negative P&L (added 2026-06-05) ─────────────────────
  // The poly_near_resolution failure mode: 90 % wr agents with negative P&L
  // were outranking profitable 60 % wr agents because the (1 + pnl_pct) term
  // was too weak. The cutoff sends every losing agent below every profit one.

  it("losing high-win-rate agent ranks BELOW profitable lower-win-rate agent", () => {
    // The exact failure mode observed 2026-06-05:
    //   - 90.6 % wr, 32 trades, pnl_pct = -0.139 → CUR fitness = +2.412 (TOP!)
    //   - 60.4 % wr, 48 trades, pnl_pct = +0.017 → CUR fitness = +1.438 (below)
    // After the cutoff fix, the losing agent goes deep negative and the
    // profitable agent wins.
    const losingHighWr = agent({
      id: 1, trades_count: 32, wins_count: 29,        // 90.6 % wr
      cash_usd_current: 861, peak_equity_usd: 1000,   // pnl_pct = -0.139
    });
    const profitableLowerWr = agent({
      id: 2, trades_count: 48, wins_count: 29,        // 60.4 % wr
      cash_usd_current: 1017, peak_equity_usd: 1017,  // pnl_pct = +0.017
    });
    const losingFitness = scoreAgent(losingHighWr).fitness;
    const profitableFitness = scoreAgent(profitableLowerWr).fitness;
    expect(profitableFitness).toBeGreaterThan(losingFitness);
    expect(losingFitness).toBeLessThan(WINRATE_LOSER_SENTINEL + 1);
    expect(profitableFitness).toBeGreaterThan(0);
  });

  it("losing agents are ordered by pnl_pct: mild loser ranks above catastrophic loser", () => {
    // From the live data: 90.6 % wr -$96 (pnl -13.9 %) vs 84.4 % wr -$811 (pnl -84 %).
    // Among losers, the milder loss should rank higher.
    const mildLoss = agent({ id: 1, trades_count: 32, wins_count: 29, cash_usd_current: 861 });
    const catLoss  = agent({ id: 2, trades_count: 224, wins_count: 189, cash_usd_current: 156 });
    expect(scoreAgent(mildLoss).fitness).toBeGreaterThan(scoreAgent(catLoss).fitness);
  });

  it("losing agent (pnl_pct < 0) ranks BELOW the data-starved sentinel", () => {
    // A known loser is worse than an unknown newcomer.
    // Newcomer: 3 trades, 100 % win rate, profitable → data-starved sentinel.
    // Loser: 30 trades, 90 % win rate, but pnl_pct < 0 → loser sentinel.
    const newcomer = agent({ id: 1, trades_count: 3, wins_count: 3, cash_usd_current: 1050 });
    const knownLoser = agent({ id: 2, trades_count: 30, wins_count: 27, cash_usd_current: 900 });
    expect(scoreAgent(newcomer).fitness).toBeGreaterThan(scoreAgent(knownLoser).fitness);
  });

  it("pnl_pct = 0 (break-even) does NOT trigger the loser cutoff", () => {
    // Edge case: exactly break-even agent should use the normal formula,
    // not the loser sentinel. (1 + 0) = 1.0 so fitness = win_rate² · log1p(n).
    const breakEven = agent({ trades_count: 20, wins_count: 18, cash_usd_current: 1000 });
    const s = scoreAgent(breakEven);
    expect(s.fitness).toBeCloseTo(Math.pow(0.9, 2) * Math.log1p(20), 4);
    expect(s.fitness).toBeGreaterThan(0);
  });

  it("pnl_pct = -0.001 (barely negative) DOES trigger the cutoff (strict <0)", () => {
    const barelyNegative = agent({ trades_count: 20, wins_count: 18, cash_usd_current: 999 });
    const s = scoreAgent(barelyNegative);
    expect(s.fitness).toBeLessThan(WINRATE_LOSER_SENTINEL + 1);
  });
});
