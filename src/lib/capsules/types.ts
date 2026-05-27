/**
 * Capsule — bounded capital allocation around a single agent/strategy.
 * Ported from TradingBot/src/capsules/capsule.py for the Polymarket+Coinbase
 * workspace. Status lifecycle: draft → paper/live ⇄ paused → stopped|closed.
 */

export type CapsuleStatus = "draft" | "paper" | "live" | "paused" | "stopped" | "closed";

export type Capsule = {
  id: string;
  agent_id: number | null;
  strategy_id: number | null;
  name: string;
  status: CapsuleStatus;

  capital_allocated_usd: number;
  capital_deployed_usd: number;
  capital_available_usd: number;

  max_daily_loss_usd: number;
  max_total_drawdown_usd: number;
  max_position_pct: number;       // 0..1
  max_open_positions: number;
  max_trades_per_day: number;

  allowed_venues: string[];        // ['polymarket','coinbase']
  allowed_symbols: string[] | null;
  min_seconds_between_trades: number;

  current_pnl_usd: number;
  daily_pnl_usd: number;
  open_positions: number;
  trades_today: number;

  // Cost-basis tracking (single-symbol-accurate aggregate).
  open_position_qty: number;
  open_position_cost_usd: number;
  daily_pnl_reset_date: string | null;

  created_at: string;
  updated_at: string;
  activated_at: string | null;
};

export type CapBreachSeverity = "warning" | "breach";

export type CapBreach = {
  cap_name: string;
  current_value: number;
  limit: number;
  severity: CapBreachSeverity;
};

export type CapsuleCheckCode =
  | "CAPSULE_NOT_FOUND"
  | "CAPSULE_NOT_ACTIVE"
  | "CAPSULE_VENUE_NOT_ALLOWED"
  | "CAPSULE_SYMBOL_NOT_ALLOWED"
  | "CAPSULE_MAX_OPEN_POSITIONS"
  | "CAPSULE_MAX_TRADES_PER_DAY"
  | "CAPSULE_MAX_POSITION_PCT"
  | "CAPSULE_COOLDOWN"
  | "CAPSULE_DAILY_LOSS"
  | "CAPSULE_TOTAL_DRAWDOWN";

export type CapsuleCheckResult =
  | { ok: true }
  | { ok: false; code: CapsuleCheckCode; reason: string };
