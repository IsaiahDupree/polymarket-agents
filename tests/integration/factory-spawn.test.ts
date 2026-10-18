/**
 * Integration test for the factory spawn lifecycle.
 *
 * scripts/factory-ctl.ts spawns the workers as detached child processes
 * and tracks them by PID. The Windows-specific path went through three
 * iterations before logs actually flowed (cmd.exe wrapper layering
 * broke stdio inheritance), so this test pins the contract end-to-end:
 *
 *   1. We can spawn a tiny detached child and capture its PID.
 *   2. The child writes to the stdio file handles we passed in
 *      (so factory logs are not silently dropped on Windows).
 *   3. isAlive(pid) flips true while running and false after exit.
 *   4. Killing an already-dead PID is non-fatal (resume idempotency).
 *
 * The "factory" we spawn here is just `node -e "..."` printing one line
 * then exiting, so the test runs in <2 s and needs no real factory code.
 */
import { describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isAlive } from "../../src/lib/factory/state";

const IS_WIN = process.platform === "win32";

/** Wait for a predicate to become true, polling every `interval` ms up to `timeout`. */
async function waitFor(
  predicate: () => boolean,
  { timeout = 5000, interval = 50 }: { timeout?: number; interval?: number } = {},
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return predicate();
}

describe("factory spawn lifecycle (integration)", () => {
  it("spawns a detached child, captures its PID, and the child writes to the log file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-spawn-"));
    const logPath = join(dir, "child.log");
    const out = openSync(logPath, "a");
    const err = openSync(logPath, "a");

    // Mirror the factory-ctl spawn shape: process.execPath + script args,
    // detached, file-descriptor stdio. Using `-e` keeps the test
    // hermetic — no external script file needed.
    const child = spawn(
      process.execPath,
      ["-e", "console.log('hello from child'); setTimeout(()=>{}, 200);"],
      {
        cwd: dir,
        detached: true,
        stdio: ["ignore", out, err],
        shell: false,
        windowsHide: true,
      },
    );
    child.unref();
    closeSync(out);
    closeSync(err);

    expect(typeof child.pid).toBe("number");
    const pid = child.pid!;

    // While the child is alive, isAlive must report true.
    // The child exits after ~200 ms; allow a small window for the
    // probe — Windows process creation is not instantaneous.
    const wasAliveAtSomePoint = await waitFor(() => isAlive(pid), { timeout: 1000, interval: 25 });
    expect(wasAliveAtSomePoint).toBe(true);

    // Wait for the child to exit + its output to flush to disk.
    const exited = await waitFor(() => !isAlive(pid), { timeout: 3000, interval: 50 });
    expect(exited).toBe(true);

    // Critical: the log file must contain the child's stdout. If this
    // fails on Windows it usually means we re-introduced the cmd.exe
    // shim and stdio is no longer forwarded.
    const wroteOutput = await waitFor(
      () => statSync(logPath).size > 0,
      { timeout: 2000, interval: 50 },
    );
    expect(wroteOutput).toBe(true);
    const text = readFileSync(logPath, "utf8");
    expect(text).toContain("hello from child");
  });

  it("kill-by-PID is idempotent — killing an already-dead PID returns gracefully", async () => {
    // Start a short-lived child, wait for it to exit naturally, then try
    // to kill it. This is the same code path as `factory-ctl resume`
    // racing with a child that crashed seconds earlier.
    const child = spawn(
      process.execPath,
      ["-e", "setTimeout(()=>{}, 50);"],
      { detached: true, stdio: "ignore", shell: false, windowsHide: true },
    );
    child.unref();
    const pid = child.pid!;
    const exited = await waitFor(() => !isAlive(pid), { timeout: 2000, interval: 25 });
    expect(exited).toBe(true);

    // Now attempt to kill it — the controller code does this for any
    // pid still recorded in state.
    if (IS_WIN) {
      const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" });
      // taskkill returns non-zero "not found" — that's the OK case.
      // factory-ctl swallows this via the same string check.
      const combined = (r.stdout ?? "") + (r.stderr ?? "");
      expect(combined.toLowerCase()).toMatch(/not found|not running|terminated|success/);
    } else {
      // POSIX: process.kill on a dead PID throws ESRCH; we expect the
      // catch in factory-ctl to no-op. Reproduce the shape here.
      let caught: NodeJS.ErrnoException | null = null;
      try { process.kill(pid, "SIGTERM"); } catch (err) { caught = err as NodeJS.ErrnoException; }
      expect(caught?.code).toBe("ESRCH");
    }
  });
});
