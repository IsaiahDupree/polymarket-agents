/**
 * Arena scoring — two modes, env-selected.
 *
 *   "pnl_dd" (legacy): fitness = pnl_pct − 2.0 × max_dd_pct + activity_bonus
 *
 *   "winrate" (default for the BTC Up/Down loop): rewards agents that
 *   consistently win on real trade samples instead of optimising for one
 *   home-run trade per generation. Formula:
 *
 *     fitness = win_rate^POWER · log1p(trades_count) · (1 + pnl_pct)
 *               − WINRATE_DD_PENALTY × max_dd_pct
 *
 *   The win_rate term is RAISED TO A POWER (default 2) so the survival
 *   gradient steepens hard near 1.0 — a 90 % winner outscores a 60 %
 *   winner by 2.25×, not 1.5×. This is what biases evolution toward the
 *   user's "90 %+ win rate" target instead of settling for "profitable
 *   coin-flippers".
 *
 *   The three multiplicative terms encode the three goals:
 *     - win_rate^POWER         — quality (the "90 %+ win" target, dominant)
 *     - log1p(trades_count)    — data accumulation (rewards lots of trades,
 *                                 diminishing returns past ~50)
 *     - (1 + pnl_pct)          — profitability (a 90 % winner with flat PnL
 *                                 doesn't beat an 80 % winner that's up)
 *   Agents with fewer than MIN_TRADES_FOR_RANKING closed trades fall through
 *   to a sentinel score so a 3-trade lucky streak can't win a generation.
 *
 * Each paper agent maintains running `peak_equity_usd` and `max_drawdown_usd`
 * fields on its row. The score function reads the agent's current state and
 * returns a single number used to rank survivors at generation seal time.
 */
import type { PaperAgentRow } from "./types";

export type Score = {
  pnl_pct: number;          // (cash_current + unrealized − cash_start) / cash_start
  max_dd_pct: number;       // max_drawdown_usd / peak_equity_usd
  activity_bonus: number;   // min(entries, ACTIVITY_CAP) × ACTIVITY_BONUS_PER_ENTRY
  fitness: number;          // depends on FITNESS_MODE
  win_rate: number;         // wins / trades (0 if no trades)
  trades_count: number;
  entries_count: number;
  /** Which formula produced `fitness`. Surfaced for UI + audit logs. */
  mode: "pnl_dd" | "winrate";
};

export const DD_PENALTY = 2.0;
export const WINRATE_DD_PENALTY = 0.5;

/**
 * Sentinel returned for agents below MIN_TRADES_FOR_RANKING under winrate
 * mode. Large negative so they sort below every fully-tested agent. We add
 * trades_count back so data-starved agents still have *some* ordering among
 * themselves (newer agents drift up as they accumulate trades).
 */
export const WINRATE_UNRANKED_SENTINEL = -1_000_000;
/**
 * Activity bonus — rewards agents who *act*, breaks ties in favor of trading
 * over hold-forever. Capped so a spam-clicking agent can't dominate purely on
 * volume — quality still has to show up via pnl_pct.
 *
 * Bonus is per-entry (counts both open and closed positions), not per-round-
 * trip — otherwise an agent with positions still open at gen-seal time gets
 * no credit for taking action. Tuned 2026-05-25 per
 * `docs/prds/arena-agent-decision-framework.md` §6.1.R1.2.
 */
export const ACTIVITY_BONUS_PER_ENTRY = 0.005;  // +0.5 pp per entry
export const ACTIVITY_CAP = 5;                  // saturates at 5 entries → max +2.5 pp

/**
 * Sum of `size_usd` across the agent's currently-open positions. When an
 * agent enters a position, cash is debited by `size_usd`; the principal is
 * "locked" in the position until exit. True equity must include this locked
 * principal — otherwise every open position looks like a loss equal to its
 * own size. (Bug discovered 2026-05-25 when MM agents with $1 entries
 * appeared to lose 1% PnL despite price not moving.)
 *
 * Safe to JSON.parse here — position_basket_json is written by
 * persistAgentTick which always JSON.stringify's a typed array.
 */
function openPrincipalUsd(a: PaperAgentRow): number {
  if (!a.position_basket_json || a.position_basket_json === "[]") return 0;
  try {
    const positions = JSON.parse(a.position_basket_json) as Array<{ size_usd?: number }>;
    let s = 0;
    for (const p of positions) s += Number(p.size_usd ?? 0);
    return s;
  } catch {
    return 0;
  }
}

/**
 * True equity = cash + locked principal (open positions at entry value) +
 * unrealized PnL (mark-to-market change since entry).
 *
 * Equivalent formulation: cash + sum(size_usd × (1 + shareReturn)).
 */
export function liveEquity(a: PaperAgentRow): number {
  return a.cash_usd_current + openPrincipalUsd(a) + a.unrealized_pnl_usd;
}

/**
 * Read the active fitness mode + win-rate-mode thresholds from env. Pulled
 * fresh on every call so test monkey-patching of process.env works without
 * needing to re-import the module.
 */
function readFitnessConfig(env: NodeJS.ProcessEnv = process.env): {
  mode: "pnl_dd" | "winrate";
  minTradesForRanking: number;
  winratePower: number;
} {
  const raw = (env.ARENA_FITNESS_MODE ?? "winrate").toLowerCase().trim();
  const mode: "pnl_dd" | "winrate" = raw === "pnl_dd" ? "pnl_dd" : "winrate";
  const minTrades = Number(env.ARENA_MIN_TRADES_FOR_RANKING ?? "30");
  // Power applied to the win_rate term in winrate mode. Default 2 steepens
  // the gradient near 1.0 so evolution races toward 90 %+ instead of
  // settling at "profitable but coin-flippy". 1.0 = linear (back-compat).
  const power = Number(env.ARENA_WINRATE_POWER ?? "2");
  return {
    mode,
    minTradesForRanking: Number.isFinite(minTrades) && minTrades > 0 ? minTrades : 30,
    winratePower: Number.isFinite(power) && power > 0 ? power : 2,
  };
}

export function scoreAgent(a: PaperAgentRow): Score {
  const equity = liveEquity(a);
  const pnl_pct = a.cash_usd_start > 0 ? (equity - a.cash_usd_start) / a.cash_usd_start : 0;
  const peak = a.peak_equity_usd > 0 ? a.peak_equity_usd : a.cash_usd_start;
  const max_dd_pct = peak > 0 ? a.max_drawdown_usd / peak : 0;
  const entries = a.entries_count ?? 0; // older fixtures + persisted rows pre-migration
  const activity_bonus = Math.min(entries, ACTIVITY_CAP) * ACTIVITY_BONUS_PER_ENTRY;
  const win_rate = a.trades_count > 0 ? a.wins_count / a.trades_count : 0;

  const { mode, minTradesForRanking, winratePower } = readFitnessConfig();
  let fitness: number;
  if (mode === "winrate") {
    if (a.trades_count < minTradesForRanking) {
      // Sentinel: rank below every fully-tested agent. Add trades_count so
      // newer agents drift up as they accumulate data instead of all tying.
      fitness = WINRATE_UNRANKED_SENTINEL + a.trades_count - max_dd_pct;
    } else {
      fitness =
        Math.pow(win_rate, winratePower) * Math.log1p(a.trades_count) * (1 + pnl_pct)
        - WINRATE_DD_PENALTY * max_dd_pct;
    }
  } else {
    fitness = pnl_pct - DD_PENALTY * max_dd_pct + activity_bonus;
  }

  return { pnl_pct, max_dd_pct, activity_bonus, fitness, win_rate, trades_count: a.trades_count, entries_count: entries, mode };
}

/**
 * Rank a list of agents by descending fitness; ties broken by realized PnL,
 * then by *whether the agent has traded at all* (agents that fired at least
 * once outrank pure-0-trade agents), then by id ASC (older agents win on
 * complete ties so newly-injected ones don't get culled before they've had
 * a chance to fire).
 */
export function rankAgents(agents: PaperAgentRow[]): Array<{ agent: PaperAgentRow; score: Score }> {
  return agents
    .map((agent) => ({ agent, score: scoreAgent(agent) }))
    .sort((a, b) => {
      if (b.score.fitness !== a.score.fitness) return b.score.fitness - a.score.fitness;
      if (b.agent.realized_pnl_usd !== a.agent.realized_pnl_usd) return b.agent.realized_pnl_usd - a.agent.realized_pnl_usd;
      // Both 0 PnL → prefer agents that have at least placed a trade
      const aHasTraded = a.agent.trades_count > 0 ? 1 : 0;
      const bHasTraded = b.agent.trades_count > 0 ? 1 : 0;
      if (aHasTraded !== bHasTraded) return bHasTraded - aHasTraded;
      // Still tied → older agent wins (lower id) so fresh injections aren't
      // automatically culled before they've taken a tick.
      return a.agent.id - b.agent.id;
    });
}

/** Pick top-K and bottom-N from a ranked list. Used by `arena:evolve`. */
export function partitionSurvivors(
  ranked: Array<{ agent: PaperAgentRow; score: Score }>,
  survivorPct = 0.5,
): { survivors: typeof ranked; cull: typeof ranked } {
  const k = Math.max(1, Math.floor(ranked.length * survivorPct));
  return { survivors: ranked.slice(0, k), cull: ranked.slice(k) };
}
