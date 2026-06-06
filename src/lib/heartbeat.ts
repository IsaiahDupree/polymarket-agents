/**
 * Cross-subsystem heartbeat tracking.
 *
 * Every periodic job (arena tick, snapshot writer, portfolio worker,
 * reconciler) calls recordHeartbeat() on success. The supervisor script
 * reads back these heartbeats to detect stale subsystems and trigger
 * recovery.
 *
 * Heartbeats live in evolution_log with event_type='heartbeat' and a
 * subsystem-specific summary. Lightweight + searchable, no new tables.
 */
import { insertEvolutionEvent } from "@/lib/db/queries";
import { db } from "@/lib/db/client";

export type SubsystemName =
  | "arena-tick"
  | "arena-evolve"
  | "snapshot-evolution"
  | "portfolio-snapshot"
  | "reconcile"
  | "ws-realtime"
  | "late-scalp-observer"
  | "supervisor"
  | "audit-overfit"
  | "book-snapshot"
  | "updown-discovery"
  | "gpu-oracle";

export type HeartbeatStatus = {
  subsystem: SubsystemName;
  last_seen_ts: string | null;
  age_minutes: number | null;
  /** Stale threshold the supervisor uses to decide whether to recover. */
  stale_after_minutes: number;
  is_stale: boolean;
  payload?: Record<string, unknown>;
};

/**
 * Default stale thresholds — supervisor recovers when a subsystem's
 * latest heartbeat is older than this many minutes.
 *
 *  - arena-tick: 5min cron → 15min stale threshold (3 missed ticks)
 *  - arena-evolve: triggered every ARENA_EVOLVE_EVERY ticks → 60min
 *  - snapshot-evolution: 10min cron → 30min stale (3 missed)
 *  - portfolio-snapshot: daily → 28h stale
 *  - reconcile: 15min cron → 45min stale
 *  - ws-realtime: long-running → 5min (any gap ≥5min = restart needed)
 *  - supervisor: itself; if it goes stale, only manual recovery available
 */
export const DEFAULT_STALE_THRESHOLDS: Record<SubsystemName, number> = {
  "arena-tick": 15,
  "arena-evolve": 60,
  "snapshot-evolution": 30,
  "portfolio-snapshot": 28 * 60,
  reconcile: 45,
  "ws-realtime": 5,
  // Long-running observer scans every 30s + writes heartbeat each scan.
  // 10min stale = ~20 missed scans → process is dead. Supervisor flag
  // is informational only (Task Scheduler's supervised wrapper restarts it).
  "late-scalp-observer": 10,
  supervisor: 30,
  // Audit runs once per day → 28h stale (1h grace for scheduler drift).
  "audit-overfit": 28 * 60,
  // Book-snapshot worker writes a heartbeat each cycle (1s cadence). 10min
  // stale flags a dead process the same way ws-realtime does.
  "book-snapshot": 10,
  // Discovery scans every 60s → 10min stale.
  "updown-discovery": 10,
  // gpu-oracle worker writes a heartbeat per cycle (default 30s cadence).
  // 5min stale threshold = ~10 missed cycles → process is dead.
  "gpu-oracle": 5,
};

/**
 * Write one heartbeat for `subsystem`. Idempotent (just appends a row).
 * Payload may carry per-subsystem context (e.g. arena tick → which gen
 * was advanced + how many agents ticked).
 */
export function recordHeartbeat(
  subsystem: SubsystemName,
  payload: Record<string, unknown> = {},
): void {
  try {
    insertEvolutionEvent({
      event_type: "heartbeat",
      summary: `heartbeat: ${subsystem}`,
      payload_json: JSON.stringify({ subsystem, ts: new Date().toISOString(), ...payload }),
    });
  } catch (err) {
    // Heartbeat failure should never propagate to the caller — log only.
    console.warn(`[heartbeat] failed to record ${subsystem}: ${(err as Error).message?.slice(0, 100)}`);
  }
}

/**
 * Read the latest heartbeat per subsystem from the last 24h.
 * Returns one HeartbeatStatus per requested subsystem, with stale flag.
 */
export function readHeartbeatStatus(
  subsystems: readonly SubsystemName[] = Object.keys(DEFAULT_STALE_THRESHOLDS) as SubsystemName[],
  thresholds: Record<SubsystemName, number> = DEFAULT_STALE_THRESHOLDS,
  nowMs: number = Date.now(),
): HeartbeatStatus[] {
  const since = new Date(nowMs - 48 * 3600_000).toISOString();
  const rows = db()
    .prepare(
      `SELECT created_at, payload_json
         FROM evolution_log
        WHERE event_type = 'heartbeat'
          AND created_at >= ?
        ORDER BY created_at DESC`,
    )
    .all(since) as Array<{ created_at: string; payload_json: string }>;

  // Build subsystem → latest heartbeat row map. Rows already DESC so first
  // match wins.
  const latestBySubsystem = new Map<string, { ts: string; payload: Record<string, unknown> }>();
  for (const row of rows) {
    let parsed: { subsystem?: string } & Record<string, unknown>;
    try { parsed = JSON.parse(row.payload_json) as never; } catch { continue; }
    const sub = parsed.subsystem as string | undefined;
    if (!sub || latestBySubsystem.has(sub)) continue;
    latestBySubsystem.set(sub, { ts: row.created_at, payload: parsed });
  }

  return subsystems.map((subsystem) => {
    const latest = latestBySubsystem.get(subsystem);
    const staleAfterMin = thresholds[subsystem] ?? 30;
    if (!latest) {
      return {
        subsystem,
        last_seen_ts: null,
        age_minutes: null,
        stale_after_minutes: staleAfterMin,
        is_stale: true,
      };
    }
    // SQLite created_at is 'YYYY-MM-DD HH:MM:SS' (no T, no Z) — Date.parse
    // reads that as LOCAL time, which adds the operator's UTC offset back.
    // Force UTC by replacing space with 'T' and appending 'Z'.
    const tsParsed = latest.ts.includes("T") ? latest.ts : latest.ts.replace(" ", "T") + "Z";
    const ageMs = nowMs - Date.parse(tsParsed);
    const ageMin = ageMs / 60_000;
    return {
      subsystem,
      last_seen_ts: latest.ts,
      age_minutes: +ageMin.toFixed(1),
      stale_after_minutes: staleAfterMin,
      is_stale: ageMin > staleAfterMin,
      payload: latest.payload,
    };
  });
}
