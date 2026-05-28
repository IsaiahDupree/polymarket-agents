/**
 * Supervisor watchdog.
 *
 * Designed to run frequently (every 5 minutes via Task Scheduler / cron).
 * Checks heartbeats for each periodic subsystem and triggers recovery
 * when one is stale.
 *
 * Recovery actions:
 *   - arena-tick stale       → run `npm run arena:tick`
 *   - snapshot-evolution stale → run `npm run snapshot:evolution`
 *   - portfolio-snapshot stale → run `npm run worker:portfolio-snapshot`
 *   - reconcile stale        → run `npm run worker:reconcile`
 *   - ws-realtime stale      → log only (long-running worker handled by
 *                              its own run-realtime-supervised.ps1)
 *
 * Records its own heartbeat ("supervisor") so a stale supervisor is
 * detectable from the /training UI.
 *
 * Honors a one-shot env override: SUPERVISOR_DRY_RUN=1 reports what
 * would be done without running anything.
 *
 *   npx tsx scripts/supervisor.ts
 *   SUPERVISOR_DRY_RUN=1 npx tsx scripts/supervisor.ts
 */
import "./_env.ts";
import { spawn } from "node:child_process";
import {
  recordHeartbeat,
  readHeartbeatStatus,
  type SubsystemName,
} from "../src/lib/heartbeat.ts";

const dryRun = process.env.SUPERVISOR_DRY_RUN === "1";

/** Subsystem → npm script to invoke when it goes stale. */
const RECOVERY_COMMANDS: Partial<Record<SubsystemName, { script: string; description: string }>> = {
  "arena-tick": { script: "arena:tick", description: "Run one arena tick" },
  "snapshot-evolution": { script: "snapshot:evolution", description: "Capture evolution-state snapshot" },
  "portfolio-snapshot": { script: "worker:portfolio-snapshot", description: "Capture portfolio PnL snapshot" },
  reconcile: { script: "worker:reconcile", description: "Reconcile capsule + venue state" },
};

async function runNpmScript(script: string, timeoutMs = 5 * 60_000): Promise<{ ok: boolean; exitCode: number; durationMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    // shell:true so Windows npm.cmd resolves correctly. Without it, spawn
    // throws EINVAL on .cmd executables.
    const child = spawn("npm", ["run", script], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
      shell: true,
    });
    const timeout = setTimeout(() => {
      console.warn(`[supervisor] ${script} timed out after ${timeoutMs}ms — killing`);
      child.kill();
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, exitCode: code ?? -1, durationMs: Date.now() - start });
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      console.warn(`[supervisor] ${script} spawn error: ${err.message}`);
      resolve({ ok: false, exitCode: -1, durationMs: Date.now() - start });
    });
  });
}

async function main() {
  const startTs = new Date().toISOString();
  console.log(`[supervisor] ${startTs}${dryRun ? " (dry-run)" : ""}`);

  const watching: SubsystemName[] = Object.keys(RECOVERY_COMMANDS) as SubsystemName[];
  const status = readHeartbeatStatus(watching);
  const stale: typeof status = [];

  for (const s of status) {
    const ageLabel = s.age_minutes === null ? "never" : `${s.age_minutes.toFixed(1)}m ago`;
    const flag = s.is_stale ? "STALE" : "ok";
    console.log(`  ${s.subsystem.padEnd(22)}  last seen ${ageLabel.padEnd(14)}  threshold ${s.stale_after_minutes}m  [${flag}]`);
    if (s.is_stale) stale.push(s);
  }

  if (stale.length === 0) {
    console.log("[supervisor] all subsystems fresh — nothing to do.");
    if (!dryRun) recordHeartbeat("supervisor", { stale_count: 0 });
    return;
  }

  console.log("");
  console.log(`[supervisor] ${stale.length} stale subsystem(s) — recovering:`);

  const recoveryResults: Array<{ subsystem: SubsystemName; ok: boolean; exitCode: number; durationMs: number }> = [];
  for (const s of stale) {
    const cmd = RECOVERY_COMMANDS[s.subsystem];
    if (!cmd) {
      console.log(`  ⊘ ${s.subsystem} — no recovery command defined`);
      continue;
    }
    console.log(`  → ${s.subsystem}: ${cmd.description} (npm run ${cmd.script})`);
    if (dryRun) {
      recoveryResults.push({ subsystem: s.subsystem, ok: true, exitCode: 0, durationMs: 0 });
      continue;
    }
    const result = await runNpmScript(cmd.script);
    recoveryResults.push({ subsystem: s.subsystem, ...result });
    console.log(`    → exit ${result.exitCode} in ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  if (!dryRun) {
    recordHeartbeat("supervisor", {
      stale_count: stale.length,
      stale_subsystems: stale.map((s) => s.subsystem),
      recoveries: recoveryResults.map((r) => ({ subsystem: r.subsystem, ok: r.ok, exit_code: r.exitCode, duration_ms: r.durationMs })),
    });
  }
}

main().catch((err) => {
  console.error(`[supervisor] fatal: ${(err as Error).message}`);
  process.exit(1);
});
