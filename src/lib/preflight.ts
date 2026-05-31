/**
 * Time-consistency + system-health preflight. The operator's explicit ask:
 * "know ahead of time if we get time errors." See
 * docs/prds/max-trades-and-winrate-then-stakeup-2026-05-30.md (F4).
 *
 * Checks are observation-only — no DB writes besides a single
 * `time-consistency-check` evolution event per run. The trade-gate file
 * (`data/.trade-gate`) is updated by the caller after each run.
 *
 * Levels:
 *   - pass: silently OK
 *   - warn: log + emit event, worker continues
 *   - abort: log + emit event + caller exits / closes trade-gate
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "@/lib/db/client";
import { insertEvolutionEvent } from "@/lib/db/queries";
import { readHeartbeatStatus } from "@/lib/heartbeat";

const __thisFile = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__thisFile), "..", "..");
const TRADE_GATE_PATH = resolve(REPO_ROOT, "data", ".trade-gate");
const TRADE_GATE_HISTORY_PATH = resolve(REPO_ROOT, "data", ".trade-gate-history.json");
const CONSECUTIVE_PASSES_TO_OPEN = 3;

export type CheckLevel = "pass" | "warn" | "abort";

export type PreflightCheck = {
  name: string;
  level: CheckLevel;
  message: string;
  detail?: Record<string, unknown>;
};

export type PreflightResult = {
  ranAt: string;
  level: CheckLevel;
  checks: PreflightCheck[];
  summary: string;
};

function check(name: string, level: CheckLevel, message: string, detail?: Record<string, unknown>): PreflightCheck {
  return { name, level, message, ...(detail ? { detail } : {}) };
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Individual checks

function checkBusyTimeout(): PreflightCheck {
  try {
    const row = db().prepare(`PRAGMA busy_timeout`).get() as { timeout: number } | undefined;
    const timeout = row?.timeout ?? 0;
    if (timeout >= 10_000) return check("busy_timeout", "pass", `busy_timeout=${timeout}ms`, { timeout });
    return check("busy_timeout", "warn", `busy_timeout=${timeout}ms < 10000 — concurrent writers may BUSY out`, { timeout });
  } catch (e) {
    return check("busy_timeout", "warn", `pragma read failed: ${(e as Error).message}`);
  }
}

function checkOpenGeneration(): PreflightCheck {
  try {
    const row = db()
      .prepare(`SELECT id, gen_number, started_at FROM paper_generations WHERE sealed_at IS NULL ORDER BY gen_number DESC LIMIT 1`)
      .get() as { id: number; gen_number: number; started_at: string } | undefined;
    if (row) return check("open_generation", "pass", `gen ${row.gen_number} open (id=${row.id})`, { ...row });
    return check("open_generation", "warn", "no open generation — arena:tick will auto-open on next run (F1)", {});
  } catch (e) {
    return check("open_generation", "abort", `paper_generations read failed: ${(e as Error).message}`);
  }
}

function checkRealtimeTickFreshness(): PreflightCheck {
  try {
    const row = db()
      .prepare(`SELECT MAX(ts_unix) AS max_ts, COUNT(*) AS n FROM realtime_ticks WHERE ts_unix >= ?`)
      .get(nowSec() - 600) as { max_ts: number | null; n: number };
    if (!row.max_ts) {
      return check("realtime_tick_freshness", "abort", "no realtime_ticks in last 10min — WS worker is dead", { rows_last_10m: 0 });
    }
    const ageSec = nowSec() - row.max_ts;
    const detail = { age_sec: ageSec, rows_last_10m: row.n };
    if (ageSec > 1800) return check("realtime_tick_freshness", "abort", `last tick ${ageSec}s ago (>30min) — WS feed dead`, detail);
    if (ageSec > 300)  return check("realtime_tick_freshness", "warn",  `last tick ${ageSec}s ago (>5min) — WS feed degrading`, detail);
    return check("realtime_tick_freshness", "pass", `last tick ${ageSec}s ago, ${row.n} rows in last 10min`, detail);
  } catch (e) {
    return check("realtime_tick_freshness", "abort", `realtime_ticks read failed: ${(e as Error).message}`);
  }
}

function checkSystemClockSanity(): PreflightCheck {
  // If the system clock has jumped backwards (laptop sleep + clock skew), the
  // max realtime_tick ts_unix will be GREATER than the current system clock —
  // a strong signal of clock drift. Allow up to +60s slop.
  try {
    const row = db().prepare(`SELECT MAX(ts_unix) AS max_ts FROM realtime_ticks`).get() as { max_ts: number | null };
    if (!row.max_ts) return check("system_clock_sanity", "pass", "no tick rows yet — skipping clock comparison");
    const skew = row.max_ts - nowSec();
    if (skew > 60)  return check("system_clock_sanity", "abort", `system clock is ${skew}s BEHIND last tick — clock drift / sleep recovery`, { skew_sec: skew });
    if (skew > 10)  return check("system_clock_sanity", "warn",  `system clock is ${skew}s behind last tick (slight skew)`, { skew_sec: skew });
    return check("system_clock_sanity", "pass", `system clock within ${Math.max(0, -skew)}s of newest tick`, { skew_sec: skew });
  } catch (e) {
    return check("system_clock_sanity", "warn", `clock check failed: ${(e as Error).message}`);
  }
}

function checkSubsystemHeartbeats(): PreflightCheck[] {
  const statuses = readHeartbeatStatus(["arena-tick", "ws-realtime"]);
  return statuses.map((s) => {
    const ageMin = s.age_minutes;
    const detail = { age_minutes: ageMin, last_seen: s.last_seen_ts };
    if (s.last_seen_ts === null) {
      return check(`heartbeat_${s.subsystem}`, "warn", `${s.subsystem}: no heartbeat in 48h`, detail);
    }
    if (s.is_stale) {
      const level: CheckLevel = s.subsystem === "ws-realtime" ? "abort" : "warn";
      return check(`heartbeat_${s.subsystem}`, level, `${s.subsystem} stale: ${ageMin}min > ${s.stale_after_minutes}min`, detail);
    }
    return check(`heartbeat_${s.subsystem}`, "pass", `${s.subsystem}: ${ageMin}min ago`, detail);
  });
}

// ---------------------------------------------------------------------------
// Orchestrator

export function runPreflight(opts: { emitEvent?: boolean } = {}): PreflightResult {
  const emitEvent = opts.emitEvent ?? true;
  const checks: PreflightCheck[] = [
    checkBusyTimeout(),
    checkOpenGeneration(),
    checkRealtimeTickFreshness(),
    checkSystemClockSanity(),
    ...checkSubsystemHeartbeats(),
  ];

  const aborts = checks.filter((c) => c.level === "abort");
  const warns = checks.filter((c) => c.level === "warn");
  const level: CheckLevel = aborts.length > 0 ? "abort" : warns.length > 0 ? "warn" : "pass";
  const summary = level === "pass"
    ? `pass (${checks.length} checks)`
    : level === "warn"
    ? `warn — ${warns.length} warning${warns.length > 1 ? "s" : ""}: ${warns.map((w) => w.name).join(", ")}`
    : `abort — ${aborts.length} fatal: ${aborts.map((a) => a.name).join(", ")}`;

  const ranAt = new Date().toISOString();
  if (emitEvent) {
    try {
      insertEvolutionEvent({
        event_type: "time-consistency-check",
        summary: `preflight ${level}: ${summary}`,
        payload_json: JSON.stringify({ level, ran_at: ranAt, checks }),
      });
    } catch (err) {
      console.warn(`[preflight] event write failed: ${(err as Error).message}`);
    }
  }

  return { ranAt, level, checks, summary };
}

// ---------------------------------------------------------------------------
// Trade-gate file management

export type TradeGateState =
  | { state: "OPEN" }
  | { state: "CLOSED"; reason: string; closedAt: string };

export function readTradeGate(): TradeGateState {
  try {
    if (!existsSync(TRADE_GATE_PATH)) return { state: "OPEN" };
    const raw = readFileSync(TRADE_GATE_PATH, "utf8").trim();
    if (raw === "OPEN" || raw === "") return { state: "OPEN" };
    if (raw.startsWith("CLOSED:")) {
      const parts = raw.split(":");
      return { state: "CLOSED", reason: parts[1] ?? "unknown", closedAt: parts[2] ?? "" };
    }
    return { state: "OPEN" };
  } catch {
    return { state: "OPEN" };
  }
}

function writeTradeGate(state: TradeGateState): void {
  mkdirSync(dirname(TRADE_GATE_PATH), { recursive: true });
  const body = state.state === "OPEN" ? "OPEN" : `CLOSED:${state.reason}:${state.closedAt}`;
  writeFileSync(TRADE_GATE_PATH, body, "utf8");
}

type GateHistory = { consecutivePasses: number; lastUpdateAt: string };

function readHistory(): GateHistory {
  try {
    if (!existsSync(TRADE_GATE_HISTORY_PATH)) return { consecutivePasses: 0, lastUpdateAt: "" };
    return JSON.parse(readFileSync(TRADE_GATE_HISTORY_PATH, "utf8")) as GateHistory;
  } catch {
    return { consecutivePasses: 0, lastUpdateAt: "" };
  }
}

function writeHistory(h: GateHistory): void {
  mkdirSync(dirname(TRADE_GATE_HISTORY_PATH), { recursive: true });
  writeFileSync(TRADE_GATE_HISTORY_PATH, JSON.stringify(h, null, 2), "utf8");
}

/** Update the trade-gate file based on a preflight result.
 *  - abort → close immediately with the first abort's name as reason
 *  - pass  → increment consecutive-pass counter; open when ≥ CONSECUTIVE_PASSES_TO_OPEN
 *  - warn  → leave gate as-is, reset counter to 0 so warnings don't accidentally reopen */
export function applyPreflightToGate(result: PreflightResult): TradeGateState {
  const history = readHistory();
  const now = new Date().toISOString();
  if (result.level === "abort") {
    const reason = result.checks.find((c) => c.level === "abort")?.name ?? "unknown";
    const state: TradeGateState = { state: "CLOSED", reason, closedAt: now };
    writeTradeGate(state);
    writeHistory({ consecutivePasses: 0, lastUpdateAt: now });
    return state;
  }
  if (result.level === "warn") {
    writeHistory({ consecutivePasses: 0, lastUpdateAt: now });
    return readTradeGate();
  }
  // pass
  const consecutive = history.consecutivePasses + 1;
  writeHistory({ consecutivePasses: consecutive, lastUpdateAt: now });
  if (consecutive >= CONSECUTIVE_PASSES_TO_OPEN) {
    const state: TradeGateState = { state: "OPEN" };
    writeTradeGate(state);
    return state;
  }
  return readTradeGate();
}

/** For workers that should refuse to start when preflight is fatal. Logs a
 *  one-line summary, applies trade-gate, and exits 1 on abort. */
export function requirePreflightOrExit(): PreflightResult {
  const result = runPreflight();
  const gate = applyPreflightToGate(result);
  console.log(`[preflight] ${result.level.toUpperCase()} — ${result.summary} | trade-gate=${gate.state}`);
  for (const c of result.checks) {
    if (c.level !== "pass") console.log(`  ${c.level === "abort" ? "✗" : "⚠"} ${c.name}: ${c.message}`);
  }
  if (result.level === "abort") {
    console.error("[preflight] abort — refusing to continue. trade-gate CLOSED.");
    process.exit(1);
  }
  return result;
}
