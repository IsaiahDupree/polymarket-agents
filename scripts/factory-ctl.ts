/**
 * factory-ctl — process manager + terminal UI for the strategy factories.
 *
 * Two factories:
 *   - btc-5m: scripts/worker-btc-5m-factory.ts   (BTC poly_short_binary_directional)
 *   - multi:  scripts/worker-multi-kind-factory.ts (the other 12 genome kinds)
 *
 * Subcommands:
 *   start [name]    — spawn one or both factories detached, persist PID + log path
 *   stop  [name]    — SIGTERM the factory, mark desired=stopped
 *   resume          — for every factory with desired=running but PID dead → restart
 *   status          — one-shot table (pid, uptime, last log lines)
 *   monitor         — live updating terminal dashboard (Ctrl-C to exit)
 *
 * State file: data/factory-state.json
 *   Tracks each factory's `desired` (running/stopped), pid, log path, last-start.
 *
 * Crash semantics:
 *   - If a factory crashes (PID exits but desired=running) it stays dead until
 *     someone runs `resume`. Resume re-spawns and logs an evolution event.
 *   - `start` after `stop` is fine — desired flips back to running.
 *   - `start` when already running is a no-op (returns the existing PID).
 *
 * Windows note: child processes are spawned `detached: true` + `unref()` so
 * the daemon keeps running after the controller exits. stdout/stderr are
 * appended to per-factory log files in logs/.
 *
 *   npm run factory:start              # start both
 *   npm run factory:start btc-5m       # start only BTC factory
 *   npm run factory:stop multi         # stop only multi factory
 *   npm run factory:status             # one-shot table
 *   npm run factory:monitor            # live dashboard
 *   npm run factory:resume             # bring back crashed ones
 */
import "./_env.ts";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import {
  FACTORY_NAMES,
  emptyState as _emptyState,  // re-exported for tests / future imports
  readState,
  writeState,
  isAlive,
  lastLines,
  formatDuration,
  parseTargets,
  type FactoryName,
  type FactoryState,
  type StateFile,
} from "../src/lib/factory/state.ts";

void _emptyState;  // suppress "unused" — re-export-only

type FactorySpec = {
  name: FactoryName;
  /** Path to the worker TS script, relative to repo root. Spawned directly via tsx. */
  scriptPath: string;
  logFile: string;
  /** Human-readable one-liner for status output. */
  desc: string;
};

const STATE_PATH = resolve("data/factory-state.json");
const LOGS_DIR = resolve("logs");

const IS_WIN = process.platform === "win32";

const FACTORIES: Record<FactoryName, FactorySpec> = {
  "btc-5m": {
    name: "btc-5m",
    scriptPath: resolve("scripts", "worker-btc-5m-factory.ts"),
    logFile: resolve("logs/factory-btc-5m.log"),
    desc: "BTC poly_short_binary_directional (tuned consistent-winner profile)",
  },
  multi: {
    name: "multi",
    scriptPath: resolve("scripts", "worker-multi-kind-factory.ts"),
    logFile: resolve("logs/factory-multi.log"),
    desc: "16 non-BTC-5m genome kinds (markov, repricing, near-resolution, …)",
  },
  updown: {
    name: "updown",
    scriptPath: resolve("scripts", "worker-updown-discovery.ts"),
    logFile: resolve("logs/factory-updown.log"),
    desc: "5m/15m Up-Down market discovery (BTC/ETH/SOL/XRP/DOGE × 5m,15m)",
  },
};

// State IO, PID liveness, log tail, parseTargets, formatDuration — all
// imported from ../src/lib/factory/state.ts (pure / unit-tested).

// ---------------------------------------------------------------------------
// Spawn / kill

function spawnFactory(spec: FactorySpec): number {
  mkdirSync(LOGS_DIR, { recursive: true });
  // Append mode so successive starts add to the same log file. Operator can
  // rotate manually if it gets huge; this keeps history across restarts.
  const out = openSync(spec.logFile, "a");
  const err = openSync(spec.logFile, "a");
  // Spawn `node --import tsx <script>` directly. Earlier attempts went
  // through tsx.cmd or npm.cmd, both of which require a cmd.exe wrapper on
  // Windows. The wrapper (a) reported its own PID instead of the worker's,
  // and (b) failed to forward our stdio file handles to the actual node
  // process, leaving the log file empty. Using process.execPath (the
  // current node binary) with the tsx loader bypasses the shell entirely:
  //   - the returned PID is the actual long-running worker
  //   - stdout/stderr flow straight into the log file
  //   - taskkill on Windows / SIGTERM elsewhere kills exactly one process
  const child = spawn(process.execPath, ["--import", "tsx", spec.scriptPath], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", out, err],
    shell: false,
    windowsHide: true,
    env: { ...process.env, FACTORY_CTL_CHILD: spec.name },
  });
  child.unref();
  if (typeof child.pid !== "number") {
    throw new Error(`failed to spawn ${spec.scriptPath} — no PID returned`);
  }
  return child.pid;
}

function killFactory(pid: number): boolean {
  if (IS_WIN) {
    // taskkill /T (tree) /F (force) is the most reliable Windows kill.
    // Even though we now spawn node directly (no cmd.exe shim), taskkill
    // still works correctly on a single PID and is safer than SIGTERM
    // for any future fork the worker might spawn.
    try {
      const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
      const stderr = r.stderr ?? "";
      // taskkill returns 128 when the PID was already gone — that's fine.
      return r.status === 0 || stderr.includes("not found") || stderr.includes("not running");
    } catch (err) {
      console.error(`[factory-ctl] taskkill failed for pid ${pid}: ${(err as Error).message}`);
      return false;
    }
  }
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return true;
    console.error(`[factory-ctl] kill failed for pid ${pid}: ${(err as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Commands

function cmdStart(names: FactoryName[]): void {
  const state = readState(STATE_PATH);
  for (const name of names) {
    const spec = FACTORIES[name];
    const s = state.factories[name];
    if (isAlive(s.pid)) {
      console.log(`[start] ${name} already running (pid ${s.pid}) — no-op`);
      s.desired = "running";  // make sure desired matches reality
      continue;
    }
    try {
      const pid = spawnFactory(spec);
      s.desired = "running";
      s.pid = pid;
      s.startedAt = new Date().toISOString();
      s.startCount += 1;
      console.log(`[start] ${name} → pid ${pid} → ${spec.logFile}`);
    } catch (err) {
      console.error(`[start] ${name} FAILED: ${(err as Error).message}`);
    }
  }
  writeState(STATE_PATH, state);
}

function cmdStop(names: FactoryName[]): void {
  const state = readState(STATE_PATH);
  for (const name of names) {
    const s = state.factories[name];
    if (!isAlive(s.pid)) {
      console.log(`[stop] ${name} not running — marking desired=stopped`);
      s.desired = "stopped";
      s.pid = null;
      continue;
    }
    const ok = killFactory(s.pid!);
    console.log(`[stop] ${name} pid ${s.pid} → ${ok ? "SIGTERM sent" : "FAILED"}`);
    s.desired = "stopped";
    s.pid = null;
  }
  writeState(STATE_PATH, state);
}

function cmdResume(): void {
  const state = readState(STATE_PATH);
  const restarted: string[] = [];
  const already: string[] = [];
  const ignored: string[] = [];
  for (const name of FACTORY_NAMES) {
    const s = state.factories[name];
    if (s.desired === "stopped") {
      ignored.push(name);
      continue;
    }
    if (isAlive(s.pid)) {
      already.push(name);
      continue;
    }
    try {
      const pid = spawnFactory(FACTORIES[name]);
      s.pid = pid;
      s.startedAt = new Date().toISOString();
      s.startCount += 1;
      restarted.push(`${name}=${pid}`);
    } catch (err) {
      console.error(`[resume] ${name} FAILED: ${(err as Error).message}`);
    }
  }
  writeState(STATE_PATH, state);
  console.log(`[resume] restarted: ${restarted.join(", ") || "none"} | already running: ${already.join(", ") || "none"} | desired=stopped: ${ignored.join(", ") || "none"}`);
}

type StatusRow = {
  name: FactoryName;
  desired: string;
  pid: number | null;
  alive: boolean;
  uptime: string;
  logFile: string;
  startCount: number;
  lastLog: string;
};

function snapshot(): StatusRow[] {
  const state = readState(STATE_PATH);
  const now = Date.now();
  const rows: StatusRow[] = [];
  for (const name of FACTORY_NAMES) {
    const s = state.factories[name];
    const spec = FACTORIES[name];
    const alive = isAlive(s.pid);
    const uptime = alive && s.startedAt ? formatDuration(now - Date.parse(s.startedAt)) : "—";
    const tail = lastLines(spec.logFile, 1)[0] ?? "(no log yet)";
    rows.push({
      name, desired: s.desired, pid: s.pid, alive, uptime,
      logFile: spec.logFile, startCount: s.startCount, lastLog: tail.slice(0, 110),
    });
  }
  return rows;
}

function printStatus(rows: StatusRow[]): void {
  const fmt = (r: StatusRow): string => {
    const status = r.alive ? "RUNNING" : r.desired === "running" ? "DEAD (resume to restart)" : "stopped";
    return [
      `  ${r.name.padEnd(8)}`,
      `pid=${String(r.pid ?? "-").padEnd(8)}`,
      `desired=${r.desired.padEnd(8)}`,
      `${status.padEnd(28)}`,
      `up=${r.uptime.padEnd(10)}`,
      `starts=${r.startCount}`,
    ].join(" ");
  };
  console.log("");
  console.log("  factory   pid       desired   status                       up           restarts");
  console.log("  --------  --------  --------  ---------------------------  -----------  --------");
  for (const r of rows) console.log(fmt(r));
  console.log("");
  for (const r of rows) {
    console.log(`  log[${r.name}]: ${r.logFile}`);
    console.log(`    tail: ${r.lastLog}`);
  }
  console.log("");
}

async function cmdMonitor(): Promise<void> {
  const REFRESH_MS = 2000;
  // ANSI clear + home
  const clear = "\x1b[2J\x1b[H";
  process.on("SIGINT", () => {
    process.stdout.write("\n[monitor] exiting (Ctrl-C)\n");
    process.exit(0);
  });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = snapshot();
    const banner = `╔══ factory monitor ══ ${new Date().toLocaleTimeString()} ══ (Ctrl-C to exit) ══`;
    process.stdout.write(clear);
    process.stdout.write(banner + "\n\n");
    for (const r of rows) {
      const dot = r.alive ? "\x1b[32m●\x1b[0m" : r.desired === "running" ? "\x1b[31m✗\x1b[0m" : "\x1b[90m○\x1b[0m";
      const status = r.alive
        ? `\x1b[32mRUNNING\x1b[0m`
        : r.desired === "running"
        ? `\x1b[31mDEAD\x1b[0m (desired=running — run \x1b[1mfactory:resume\x1b[0m)`
        : "\x1b[90mstopped\x1b[0m";
      process.stdout.write(`  ${dot}  \x1b[1m${r.name.padEnd(8)}\x1b[0m  pid=${String(r.pid ?? "-").padEnd(8)}  ${status}\n`);
      process.stdout.write(`     uptime ${r.uptime}  restarts ${r.startCount}\n`);
      process.stdout.write(`     log: ${r.logFile}\n`);
      const tail = lastLines(FACTORIES[r.name].logFile, 5);
      if (tail.length > 0) {
        for (const line of tail) process.stdout.write(`     \x1b[90m│\x1b[0m ${line.slice(0, 140)}\n`);
      } else {
        process.stdout.write(`     \x1b[90m│ (no log lines yet)\x1b[0m\n`);
      }
      process.stdout.write("\n");
    }
    process.stdout.write(`  refresh every ${REFRESH_MS}ms · state file: ${STATE_PATH}\n`);
    await wait(REFRESH_MS);
  }
}

// ---------------------------------------------------------------------------
// CLI — parseTargets is imported from src/lib/factory/state.ts.

function usage(): void {
  console.log(`
factory-ctl — process manager for the strategy factories

  Subcommands:
    start [btc-5m|multi]    start one or both factories
    stop  [btc-5m|multi]    stop  one or both factories
    resume                  restart any factory with desired=running but PID dead
    status                  one-shot status table
    monitor                 live updating dashboard (Ctrl-C to exit)

  Examples:
    npm run factory:start              # start both
    npm run factory:start btc-5m       # start only btc-5m
    npm run factory:stop               # stop both
    npm run factory:status             # snapshot
    npm run factory:monitor            # live dashboard
    npm run factory:resume             # bring back crashed ones

  State file: ${STATE_PATH}
  Log files:  ${FACTORIES["btc-5m"].logFile}
              ${FACTORIES.multi.logFile}
`);
}

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;
  switch (sub) {
    case "start":  cmdStart(parseTargets(rest)); break;
    case "stop":   cmdStop(parseTargets(rest)); break;
    case "resume": cmdResume(); break;
    case "status": printStatus(snapshot()); break;
    case "monitor": await cmdMonitor(); break;
    case undefined:
    case "help":
    case "--help":
      usage(); break;
    default:
      console.error(`[factory-ctl] unknown subcommand: ${sub}`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[factory-ctl] fatal: ${(err as Error).message}`);
  process.exitCode = 1;
});
