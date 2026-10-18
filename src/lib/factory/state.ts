/**
 * Factory control — pure state + IO helpers extracted from
 * scripts/factory-ctl.ts so they can be unit-tested without spawning
 * real processes.
 *
 * What lives here:
 *   - State file shape + read/write (corruption-tolerant)
 *   - PID liveness probe (process.kill(pid, 0))
 *   - Log tail reader (bounded to last 64 KB)
 *   - Duration formatter
 *   - parseTargets (CLI factory-name validation)
 *
 * What stays in the script: actual child_process.spawn + the CLI dispatch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, statSync, readSync, closeSync } from "node:fs";
import { dirname } from "node:path";

export type FactoryName = "btc-5m" | "multi" | "updown";

export const FACTORY_NAMES: readonly FactoryName[] = ["btc-5m", "multi", "updown"];

export type FactoryState = {
  desired: "running" | "stopped";
  pid: number | null;
  startedAt: string | null;
  /** Increments on every successful spawn (start or resume). */
  startCount: number;
};

export type StateFile = {
  factories: Record<FactoryName, FactoryState>;
  updatedAt: string;
};

export function emptyState(): StateFile {
  return {
    factories: {
      "btc-5m": { desired: "stopped", pid: null, startedAt: null, startCount: 0 },
      multi:    { desired: "stopped", pid: null, startedAt: null, startCount: 0 },
      updown:   { desired: "stopped", pid: null, startedAt: null, startCount: 0 },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function readState(statePath: string): StateFile {
  if (!existsSync(statePath)) return emptyState();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    // Corrupt JSON → fresh state. Better than crashing on a malformed file.
    return emptyState();
  }
  if (typeof raw !== "object" || raw === null) return emptyState();
  const merged = emptyState();
  const factories = (raw as Partial<StateFile>).factories;
  if (factories && typeof factories === "object") {
    for (const k of FACTORY_NAMES) {
      const incoming = (factories as Record<string, unknown>)[k];
      if (incoming && typeof incoming === "object") {
        // Defensive merge: only carry over keys we recognize. Unknown
        // keys from a future version are dropped.
        const fs = incoming as Partial<FactoryState>;
        merged.factories[k] = {
          desired: fs.desired === "running" ? "running" : "stopped",
          pid: typeof fs.pid === "number" ? fs.pid : null,
          startedAt: typeof fs.startedAt === "string" ? fs.startedAt : null,
          startCount: typeof fs.startCount === "number" && fs.startCount >= 0
            ? Math.floor(fs.startCount)
            : 0,
        };
      }
    }
  }
  return merged;
}

export function writeState(statePath: string, state: StateFile): void {
  state.updatedAt = new Date().toISOString();
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * PID liveness — cross-platform alive check. process.kill(pid, 0)
 * throws ESRCH when the PID doesn't exist; succeeds (returns true with
 * no side effect) otherwise. Returns false for null/undefined PIDs.
 */
export function isAlive(pid: number | null | undefined): boolean {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Human-readable duration. Floors to: ms < 1s, s < 1m, m < 1h, h above.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.floor(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

/**
 * Read the last N lines of a log file, bounded to the trailing 64 KB so
 * a huge log doesn't blow process memory. Returns [] for missing or
 * empty files.
 */
export function lastLines(path: string, n: number): string[] {
  if (!existsSync(path)) return [];
  try {
    const stats = statSync(path);
    if (stats.size === 0) return [];
    const readBytes = Math.min(stats.size, 64 * 1024);
    const start = stats.size - readBytes;
    const fd = openSync(path, "r");
    const buf = Buffer.alloc(readBytes);
    readSync(fd, buf, 0, readBytes, start);
    closeSync(fd);
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

/**
 * Parse CLI positional args into a deduplicated list of valid factory
 * names. Unknown names emit a warning (via the supplied logger) and are
 * dropped. An empty input expands to all known factories.
 */
export function parseTargets(
  positional: string[],
  warn: (msg: string) => void = console.warn,
): FactoryName[] {
  if (positional.length === 0) return [...FACTORY_NAMES];
  const valid: FactoryName[] = [];
  const seen = new Set<string>();
  for (const p of positional) {
    if ((FACTORY_NAMES as readonly string[]).includes(p)) {
      if (!seen.has(p)) { valid.push(p as FactoryName); seen.add(p); }
    } else {
      warn(`[factory-ctl] unknown factory name: ${p} (valid: ${FACTORY_NAMES.join(", ")})`);
    }
  }
  return valid.length > 0 ? valid : [...FACTORY_NAMES];
}
