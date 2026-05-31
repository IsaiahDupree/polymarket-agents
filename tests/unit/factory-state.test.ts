/**
 * Unit tests for src/lib/factory/state.ts — the helpers behind
 * scripts/factory-ctl.ts. These cover the corner cases that would
 * cause a real factory crash to leave state inconsistent:
 *   - state file missing / corrupt / partial
 *   - PID liveness probe
 *   - log tail bounded read
 *   - parseTargets validation
 *   - formatDuration ranges
 */
import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  emptyState,
  readState,
  writeState,
  isAlive,
  formatDuration,
  lastLines,
  parseTargets,
  FACTORY_NAMES,
} from "../../src/lib/factory/state";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "factory-state-test-"));
}

// ---------------------------------------------------------------------------
// emptyState

describe("emptyState", () => {
  it("returns all factories with default values", () => {
    const s = emptyState();
    expect(Object.keys(s.factories).sort()).toEqual(["btc-5m", "multi", "updown"]);
    for (const name of FACTORY_NAMES) {
      const f = s.factories[name];
      expect(f.desired).toBe("stopped");
      expect(f.pid).toBeNull();
      expect(f.startedAt).toBeNull();
      expect(f.startCount).toBe(0);
    }
  });

  it("sets updatedAt to a parseable ISO timestamp", () => {
    const s = emptyState();
    expect(Number.isFinite(Date.parse(s.updatedAt))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readState — corruption tolerance

describe("readState", () => {
  it("returns empty state when the file is missing", () => {
    const dir = makeTempDir();
    const path = join(dir, "does-not-exist.json");
    expect(existsSync(path)).toBe(false);
    const s = readState(path);
    expect(s).toEqual(expect.objectContaining({ factories: emptyState().factories }));
  });

  it("returns empty state when the file is corrupt JSON", () => {
    const dir = makeTempDir();
    const path = join(dir, "corrupt.json");
    writeFileSync(path, "{ this is not json");
    const s = readState(path);
    // Critical: must not throw. Corruption should never crash factory-ctl.
    expect(s.factories["btc-5m"].desired).toBe("stopped");
    expect(s.factories.multi.pid).toBeNull();
  });

  it("returns empty state when the file is valid JSON but the wrong shape", () => {
    const dir = makeTempDir();
    const path = join(dir, "wrong-shape.json");
    writeFileSync(path, JSON.stringify(["not", "an", "object"]));
    const s = readState(path);
    expect(s.factories["btc-5m"].desired).toBe("stopped");
  });

  it("merges partial state with defaults when keys are missing", () => {
    const dir = makeTempDir();
    const path = join(dir, "partial.json");
    // btc-5m has pid + desired but no startedAt / startCount; multi missing entirely.
    writeFileSync(path, JSON.stringify({
      factories: { "btc-5m": { desired: "running", pid: 4242 } },
    }));
    const s = readState(path);
    expect(s.factories["btc-5m"].desired).toBe("running");
    expect(s.factories["btc-5m"].pid).toBe(4242);
    expect(s.factories["btc-5m"].startedAt).toBeNull();   // default
    expect(s.factories["btc-5m"].startCount).toBe(0);     // default
    expect(s.factories.multi.desired).toBe("stopped");     // default — was missing
    expect(s.factories.multi.pid).toBeNull();
  });

  it("rejects invalid types in stored state (defensive merge)", () => {
    const dir = makeTempDir();
    const path = join(dir, "bad-types.json");
    writeFileSync(path, JSON.stringify({
      factories: {
        "btc-5m": {
          desired: "weird-value",
          pid: "not-a-number",
          startedAt: 42,
          startCount: -5,
        },
      },
    }));
    const s = readState(path);
    expect(s.factories["btc-5m"].desired).toBe("stopped");  // unknown enum → default
    expect(s.factories["btc-5m"].pid).toBeNull();           // wrong type → null
    expect(s.factories["btc-5m"].startedAt).toBeNull();     // wrong type → null
    expect(s.factories["btc-5m"].startCount).toBe(0);       // negative → 0
  });
});

// ---------------------------------------------------------------------------
// writeState — roundtrip

describe("writeState + readState roundtrip", () => {
  it("persists a modified state and reads it back identically (modulo updatedAt)", () => {
    const dir = makeTempDir();
    const path = join(dir, "roundtrip.json");
    const original = emptyState();
    original.factories["btc-5m"] = {
      desired: "running",
      pid: 12345,
      startedAt: "2026-05-30T23:00:00.000Z",
      startCount: 3,
    };
    writeState(path, original);
    const persisted = readState(path);
    expect(persisted.factories["btc-5m"]).toEqual(original.factories["btc-5m"]);
    expect(persisted.factories.multi).toEqual(original.factories.multi);
  });

  it("creates the parent directory if missing", () => {
    const dir = makeTempDir();
    const path = join(dir, "nested", "deep", "state.json");
    expect(existsSync(path)).toBe(false);
    writeState(path, emptyState());
    expect(existsSync(path)).toBe(true);
  });

  it("updates updatedAt on every write", async () => {
    const dir = makeTempDir();
    const path = join(dir, "stamp.json");
    writeState(path, emptyState());
    const t1 = JSON.parse(readFileSync(path, "utf8")).updatedAt;
    // Real-time wait so the ISO timestamp definitely advances by at
    // least 1 ms — fake timers would skip the JSON Date.now() call.
    await new Promise((r) => setTimeout(r, 5));
    writeState(path, emptyState());
    const t2 = JSON.parse(readFileSync(path, "utf8")).updatedAt;
    expect(Date.parse(t2)).toBeGreaterThanOrEqual(Date.parse(t1));
    expect(t2).not.toBe(t1);
  });
});

// ---------------------------------------------------------------------------
// isAlive

describe("isAlive", () => {
  it("returns true for the current process PID", () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it("returns false for null/undefined PID", () => {
    expect(isAlive(null)).toBe(false);
    expect(isAlive(undefined)).toBe(false);
  });

  it("returns false for a PID that almost certainly does not exist", () => {
    // 0x7FFFFFFE — Windows + Linux PIDs are 32-bit signed but in practice
    // sit far below 2^31. Picking near INT_MAX gives a virtually-zero
    // chance of a collision with a real process.
    expect(isAlive(0x7FFFFFFE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatDuration

describe("formatDuration", () => {
  it("formats sub-second durations as ms", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(999)).toBe("999ms");
  });
  it("formats sub-minute durations as seconds", () => {
    expect(formatDuration(1000)).toBe("1s");
    expect(formatDuration(59_999)).toBe("59s");
  });
  it("formats sub-hour durations as m+s", () => {
    expect(formatDuration(60_000)).toBe("1m0s");
    expect(formatDuration(125_000)).toBe("2m5s");
    expect(formatDuration(3_599_000)).toBe("59m59s");
  });
  it("formats hours+ as h+m", () => {
    expect(formatDuration(3_600_000)).toBe("1h0m");
    expect(formatDuration(3_660_000)).toBe("1h1m");
    expect(formatDuration(25 * 3_600_000)).toBe("25h0m");
  });
  it("returns sentinel for invalid input", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// lastLines

describe("lastLines", () => {
  it("returns [] for a missing file", () => {
    expect(lastLines(join(makeTempDir(), "no-such-file.log"), 5)).toEqual([]);
  });

  it("returns [] for an empty file", () => {
    const dir = makeTempDir();
    const path = join(dir, "empty.log");
    writeFileSync(path, "");
    expect(lastLines(path, 5)).toEqual([]);
  });

  it("returns the last N lines of a small file", () => {
    const dir = makeTempDir();
    const path = join(dir, "small.log");
    writeFileSync(path, "first\nsecond\nthird\nfourth\nfifth\n");
    expect(lastLines(path, 3)).toEqual(["third", "fourth", "fifth"]);
    expect(lastLines(path, 100)).toHaveLength(5);
  });

  it("handles files without a trailing newline", () => {
    const dir = makeTempDir();
    const path = join(dir, "no-newline.log");
    writeFileSync(path, "alpha\nbeta\ngamma");
    expect(lastLines(path, 2)).toEqual(["beta", "gamma"]);
  });

  it("only reads the last 64 KB of a huge file (memory bound)", () => {
    const dir = makeTempDir();
    const path = join(dir, "huge.log");
    // 200 KB of filler, then the lines we care about. lastLines must
    // not load the whole file into memory.
    const filler = "x".repeat(200 * 1024) + "\n";
    const tail = "tail-line-1\ntail-line-2\ntail-line-3\n";
    writeFileSync(path, filler + tail);
    expect(statSync(path).size).toBeGreaterThan(200_000);
    const lines = lastLines(path, 3);
    expect(lines).toEqual(["tail-line-1", "tail-line-2", "tail-line-3"]);
  });

  it("tolerates CRLF line endings (Windows)", () => {
    const dir = makeTempDir();
    const path = join(dir, "crlf.log");
    writeFileSync(path, "one\r\ntwo\r\nthree\r\n");
    expect(lastLines(path, 2)).toEqual(["two", "three"]);
  });
});

// ---------------------------------------------------------------------------
// parseTargets

describe("parseTargets", () => {
  it("returns all factories when no positional args are given", () => {
    expect(parseTargets([])).toEqual(["btc-5m", "multi", "updown"]);
  });

  it("returns only the requested factory when one valid name is given", () => {
    expect(parseTargets(["btc-5m"])).toEqual(["btc-5m"]);
    expect(parseTargets(["multi"])).toEqual(["multi"]);
  });

  it("deduplicates repeated names", () => {
    // Input has 2 distinct names, so dedup returns those 2 (NOT all factories).
    expect(parseTargets(["btc-5m", "btc-5m", "multi"])).toEqual(["btc-5m", "multi"]);
  });

  it("warns about unknown names and ignores them", () => {
    const warn = vi.fn();
    const result = parseTargets(["btc-5m", "bogus"], warn);
    expect(result).toEqual(["btc-5m"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("bogus");
  });

  it("falls back to all factories when EVERY positional name was invalid", () => {
    const warn = vi.fn();
    // Defensive default: if the operator typo'd every name, do the safer
    // thing (touch everything visible) rather than the silently-empty thing.
    expect(parseTargets(["foo", "bar"], warn)).toEqual(["btc-5m", "multi", "updown"]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
