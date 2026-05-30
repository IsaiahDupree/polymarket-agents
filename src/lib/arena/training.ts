/**
 * Training helpers — backtest + parameter sweep for arena agents.
 *
 * simulateAgentReplay(agentId, fromIso, toIso) clones the agent into a
 * sandboxed in-memory state and replays a historical window through its
 * genome, returning PnL + trades + drawdown without touching the live DB.
 *
 * sweepAgentVariants(agentId, fromIso, toIso, perParamSteps) generates
 * variant genomes by perturbing each numeric parameter ±20%, runs each
 * through simulateAgentReplay, and returns variants ranked by PnL.
 *
 * Both functions are pure with respect to the persistent state — agent rows,
 * paper_trades, evolution_log are not written. The training_runs table is
 * the only persistence; callers handle that separately.
 */
import { db } from "@/lib/db/client";
import { iterTickContexts } from "./context";
import { applySignal, decide, markToMarket } from "./sim";
import type { LiveAgent, Position } from "./types";
import { parseGenome, type Genome, type GenomeKind } from "./genome";
import { toLiveAgent } from "./db";
import { setPreloadedCandles, type Candle } from "./momentum";
import { loadCandleRange, openHistoricalDbRO } from "@/lib/historical/db";

export type ReplaySummary = {
  pnl_usd: number;
  pnl_pct: number;
  trades_count: number;
  wins_count: number;
  win_rate: number;
  max_dd_usd: number;
  max_dd_pct: number;
  fitness: number;                  // pnl_pct − 2 * max_dd_pct
  starting_cash: number;
  ending_equity: number;
  ticks: number;
  signals_emitted: { entries: number; exits: number; holds: number };
  equity_curve: Array<{ ts: string; equity: number }>;
};

export type ReplayInput = {
  agentId: number;
  fromIso: string;
  toIso: string;
  tickIntervalMin?: number;        // default 5
  startingCash?: number;           // override; defaults to agent.cash_usd_start
  genomeOverride?: Genome;         // sweep mode passes a perturbed genome
  equityCurveStride?: number;      // 1 = every tick (default), 10 = every 10th
  /** Hard cap on ticks. If set, replay stops once `maxTicks` is reached even
   *  if the window has more time left. Useful for fast probes (quickProbe). */
  maxTicks?: number;
  /** Fires every `progressEveryNTicks` ticks with the running stats. Lets
   *  long-running backtests stream visible progress to a wrapping script. */
  onProgress?: (s: { tick: number; entries: number; exits: number; holds: number; cash: number; positions: number; elapsedMs: number }) => void;
  progressEveryNTicks?: number;     // default 200
};

/** Fast 12-tick smoke-probe. If 0 trades after the probe, the caller knows the
 *  agent is inert in current conditions and can bail before a 9-min full run.
 *  Returns the probe summary (same shape as simulateAgentReplay). */
export function quickProbeAgent(input: Omit<ReplayInput, "maxTicks">): ReplaySummary {
  return simulateAgentReplay({ ...input, maxTicks: 12, equityCurveStride: 9999 });
}

/**
 * Replay a historical window through an agent's genome, sandboxed.
 *
 * Mutates an in-memory clone of the agent — does NOT write to paper_agents,
 * paper_trades, or evolution_log. Callers wanting persistence go through
 * training_runs.
 */
export function simulateAgentReplay(input: ReplayInput): ReplaySummary {
  const { agentId, fromIso, toIso, tickIntervalMin = 5, equityCurveStride = 1, maxTicks, onProgress, progressEveryNTicks = 200 } = input;
  const startMs = Date.now();

  // Load the live row + parse its genome.
  const row = db()
    .prepare("SELECT * FROM paper_agents WHERE id = ?")
    .get(agentId) as Parameters<typeof toLiveAgent>[0] | undefined;
  if (!row) throw new Error(`agent ${agentId} not found`);
  const baseAgent = toLiveAgent(row);

  // Sandbox: fresh state, optional genome override.
  const startingCash = input.startingCash ?? baseAgent.cash_usd_start;
  const genome: Genome = input.genomeOverride ?? baseAgent.genome;
  const agent: LiveAgent = {
    ...baseAgent,
    genome,
    cash_usd_current: startingCash,
    realized_pnl_usd: 0,
    unrealized_pnl_usd: 0,
    peak_equity_usd: startingCash,
    max_drawdown_usd: 0,
    trades_count: 0,
    entries_count: 0,
    wins_count: 0,
    positions: [] as Position[],
  };

  // Replay
  const rng = Math.random;
  let ticks = 0;
  let entries = 0;
  let exits = 0;
  let holds = 0;
  let peakEquity = startingCash;
  let maxDdUsd = 0;
  const equityCurve: Array<{ ts: string; equity: number }> = [];

  // SPEED-FIX EXPERIMENT — disabled by default.
  //
  // Attempt: pre-load historical-candles.db into an in-memory cache so
  // loadRecentCandles short-circuits the per-tick SQL hot-path. Two issues
  // showed up on first benchmark:
  //   1. With time-freezing on, decide() saw inconsistent context (historical
  //      candles + current Polymarket binaries — findBinaryWindow uses
  //      wall-clock 'now' in SQL) and returned hold every tick → 0 trades.
  //   2. Without time-freezing, the preload returned empty arrays for windows
  //      where data/historical-candles.db doesn't have data through "now"
  //      (backfill was run earlier in the day; test window is [now-14d, now]
  //      which extends past the DB's latest candle).
  //
  // Real fix needed: extend the backfill to be continuous + add time-scoping
  // to findBinaryWindow too. Both are non-trivial. For now leave the SQL path
  // intact so backtests at least produce real trade activity.
  //
  // To re-enable for experimentation: set BACKTEST_PRELOAD_CANDLES=1.
  if (process.env.BACKTEST_PRELOAD_CANDLES === "1") {
    const fromMs = new Date(fromIso).getTime();
    const toMs = new Date(toIso).getTime();
    const lookbackBufferSec = 4 * 60 * 60;
    const fromTs = Math.floor(fromMs / 1000) - lookbackBufferSec;
    const toTs = Math.floor(toMs / 1000);
    const preloadProducts = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"];
    const preloadMap = new Map<string, Candle[]>();
    if (openHistoricalDbRO()) {
      for (const productId of preloadProducts) {
        const rawCandles = loadCandleRange(productId, 60, fromTs, toTs);
        if (rawCandles.length === 0) continue;
        preloadMap.set(
          productId,
          rawCandles.map((c) => ({
            product_id: productId,
            start_unix: c.start_ts_unix,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
        );
      }
    }
    setPreloadedCandles(preloadMap.size > 0 ? preloadMap : null);
  }

  try {
  for (const ctx of iterTickContexts({ start: fromIso, end: toIso, tickIntervalMin })) {
    ticks += 1;
    // Hard ceiling for quick-probe mode — bail out after maxTicks even if
    // the window has more time left.
    if (maxTicks != null && ticks > maxTicks) break;

    const signal = decide(agent, ctx, rng);
    if (signal.kind === "hold") {
      holds += 1;
    } else {
      const r = applySignal(agent, signal, ctx, /*generation*/ 0);
      if (r.trade) {
        if (r.trade.intent === "entry") entries += 1;
        else exits += 1;
      }
    }
    markToMarket(agent, ctx);

    // Live-progress callback — lets a wrapper script print "tick X/Y holds=N
    // entries=M" so 5-min hangs aren't invisible. Fires every N ticks.
    if (onProgress && ticks % progressEveryNTicks === 0) {
      onProgress({
        tick: ticks,
        entries,
        exits,
        holds,
        cash: agent.cash_usd_current,
        positions: agent.positions.length,
        elapsedMs: Date.now() - startMs,
      });
    }

    // Equity = cash + unrealized PnL (markToMarket sets agent.unrealized_pnl_usd)
    //
    // applySignal subtracts notional from cash on entry and adds back on exit,
    // so cash already accounts for locked principal. Adding unrealized PnL
    // overlays mark-to-market gains/losses on open positions.
    const equity = agent.cash_usd_current
      + agent.positions.reduce((s, p) => s + p.size_usd, 0)
      + agent.unrealized_pnl_usd;
    if (equity > peakEquity) peakEquity = equity;
    const ddUsd = peakEquity - equity;
    if (ddUsd > maxDdUsd) maxDdUsd = ddUsd;

    if (ticks % equityCurveStride === 0) {
      equityCurve.push({ ts: ctx.now, equity });
    }
  }

  // Force-close at the end so PnL is fully realized for reporting purposes.
  // Use the LAST snapshot from the most recent ctx since we don't have one
  // here — instead, treat unrealized as realized for summary purposes.
  const endingEquity = agent.cash_usd_current
    + agent.positions.reduce((s, p) => s + p.size_usd, 0)
    + agent.unrealized_pnl_usd;
  const pnlUsd = endingEquity - startingCash;
  const pnlPct = startingCash > 0 ? pnlUsd / startingCash : 0;
  const maxDdPct = peakEquity > 0 ? maxDdUsd / peakEquity : 0;
  // TradingBot-style fitness: pnl_pct − 2 × max_dd_pct
  const fitness = pnlPct - 2 * maxDdPct;
  const winRate = agent.trades_count > 0 ? agent.wins_count / agent.trades_count : 0;

  return {
    pnl_usd: pnlUsd,
    pnl_pct: pnlPct,
    trades_count: agent.trades_count,
    wins_count: agent.wins_count,
    win_rate: winRate,
    max_dd_usd: maxDdUsd,
    max_dd_pct: maxDdPct,
    fitness,
    starting_cash: startingCash,
    ending_equity: endingEquity,
    ticks,
    signals_emitted: { entries, exits, holds },
    equity_curve: equityCurve,
  };
  } finally {
    // Always clear the preload — leaving it set would corrupt subsequent
    // live arena ticks (they'd see frozen-time data from the last backtest).
    setPreloadedCandles(null, null);
  }
}

// ---------------------------------------------------------------------------
// Parameter sweep

export type SweepVariant = {
  param_key: string;            // which genome key was perturbed ("vel_entry_pct", etc.)
  param_from: number;
  param_to: number;
  summary: ReplaySummary;
};

export type SweepResult = {
  base: ReplaySummary;
  variants: SweepVariant[];     // ranked by pnl_usd DESC
};

/**
 * Run N variants of an agent's genome: for each numeric parameter, perturb
 * by ±perPct (default 20%) and replay. Returns all variants ranked by PnL.
 *
 * Skips non-numeric params (strings, enums, arrays) and the entry_size_usd
 * key (controlled separately). Multi-strategy composite genomes are not
 * supported in this first cut — sweep on their sub-genomes individually.
 */
export function sweepAgentVariants(
  input: ReplayInput & { perPct?: number },
): SweepResult {
  const perPct = input.perPct ?? 0.20;
  const base = simulateAgentReplay(input);

  // Load the base genome
  const row = db()
    .prepare("SELECT genome_json FROM paper_agents WHERE id = ?")
    .get(input.agentId) as { genome_json: string } | undefined;
  if (!row) throw new Error(`agent ${input.agentId} not found`);
  const baseGenome = input.genomeOverride ?? parseGenome(row.genome_json);

  if ((baseGenome as any).kind === "multi_strategy") {
    return { base, variants: [] };
  }
  const params = (baseGenome as any).params as Record<string, unknown>;
  const variants: SweepVariant[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (key === "entry_size_usd") continue; // sized via capsule risk envelope, not strategy
    if (typeof value !== "number") continue;
    if (!Number.isFinite(value) || value === 0) continue;
    for (const direction of [-1, +1] as const) {
      const newValue = value * (1 + direction * perPct);
      const newParams = { ...params, [key]: newValue };
      const newGenome = { kind: (baseGenome as any).kind as GenomeKind, params: newParams } as Genome;
      try {
        const summary = simulateAgentReplay({ ...input, genomeOverride: newGenome });
        variants.push({ param_key: key, param_from: value, param_to: newValue, summary });
      } catch (err) {
        // Skip variants that crash (invalid param combo) — don't fail the whole sweep.
        console.error(`[sweep] variant ${key}=${newValue.toFixed(4)} failed: ${(err as Error).message}`);
      }
    }
  }

  // Rank by PnL desc
  variants.sort((a, b) => b.summary.pnl_usd - a.summary.pnl_usd);
  return { base, variants };
}

// ---------------------------------------------------------------------------
// Persistence helpers

export type TrainingRunInsert = {
  agent_id: number;
  mode: "backtest" | "sweep" | "forward";
  from_iso: string;
  to_iso: string;
  status: "queued" | "running" | "done" | "failed";
  pnl_usd?: number;
  trades_count?: number;
  wins_count?: number;
  max_dd_pct?: number;
  fitness?: number;
  summary_json?: string;
  error?: string;
  ended_at?: string;
};

export function insertTrainingRun(run: TrainingRunInsert): number {
  const result = db()
    .prepare(
      `INSERT INTO training_runs
         (agent_id, mode, from_iso, to_iso, status,
          pnl_usd, trades_count, wins_count, max_dd_pct, fitness,
          summary_json, error, ended_at)
       VALUES
         (@agent_id, @mode, @from_iso, @to_iso, @status,
          @pnl_usd, @trades_count, @wins_count, @max_dd_pct, @fitness,
          @summary_json, @error, @ended_at)`,
    )
    .run({
      agent_id: run.agent_id,
      mode: run.mode,
      from_iso: run.from_iso,
      to_iso: run.to_iso,
      status: run.status,
      pnl_usd: run.pnl_usd ?? null,
      trades_count: run.trades_count ?? null,
      wins_count: run.wins_count ?? null,
      max_dd_pct: run.max_dd_pct ?? null,
      fitness: run.fitness ?? null,
      summary_json: run.summary_json ?? null,
      error: run.error ?? null,
      ended_at: run.ended_at ?? null,
    });
  return Number(result.lastInsertRowid);
}

export type TrainingRunRow = {
  id: number;
  agent_id: number;
  mode: string;
  from_iso: string;
  to_iso: string;
  status: string;
  pnl_usd: number | null;
  trades_count: number | null;
  wins_count: number | null;
  max_dd_pct: number | null;
  fitness: number | null;
  summary_json: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

export function listTrainingRunsForAgent(agentId: number, limit = 20): TrainingRunRow[] {
  return db()
    .prepare(`SELECT * FROM training_runs WHERE agent_id = ? ORDER BY id DESC LIMIT ?`)
    .all(agentId, limit) as TrainingRunRow[];
}

export function getTrainingRun(id: number): TrainingRunRow | null {
  return (db().prepare(`SELECT * FROM training_runs WHERE id = ?`).get(id) as TrainingRunRow | undefined) ?? null;
}
