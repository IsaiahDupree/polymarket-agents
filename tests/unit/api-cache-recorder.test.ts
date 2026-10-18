/**
 * Unit tests for src/lib/api-cache/recorder.ts.
 *
 * Tests the URL classification + URL-splitting helpers in isolation
 * (no real DB needed — those bits are pure). The full end-to-end
 * "fetch → cache row" flow is exercised by the smoke run in CI when the
 * worker:updown-discovery worker fires.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory better-sqlite3 instance shared across the mock + the tests.
// vi.hoisted creates it before the mocks are evaluated.
const { handle } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const h = new Database(":memory:");
  h.exec(`
    CREATE TABLE IF NOT EXISTS api_call_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL, endpoint TEXT NOT NULL,
      query_string TEXT, request_method TEXT NOT NULL DEFAULT 'GET',
      response_status INTEGER NOT NULL,
      response_size_bytes INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return { handle: h };
});

vi.mock("@/lib/db/client", () => ({
  db: () => handle,
  closeDb: () => handle.close(),
}));

// Capture the registered logger so we can call it directly. Hoisted with
// the other test fixtures so the mock factory can reference it.
const { state } = vi.hoisted(() => ({
  state: { capturedLogger: null as ((entry: { url: string; method: "GET"; status: number; bodyText: string }) => void) | null },
}));
vi.mock("@adapters/polymarket/client", () => ({
  setResponseLogger: (fn: typeof state.capturedLogger) => { state.capturedLogger = fn; },
}));

import {
  listRecentCachedResponses,
  cacheStats,
  pruneOldCache,
} from "@/lib/api-cache/recorder";

beforeEach(() => {
  handle.exec(`DELETE FROM api_call_cache`);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 1. Side effect: logger gets registered on import ──────────────────────

describe("recorder registration", () => {
  it("registered a response logger via setResponseLogger", () => {
    expect(state.capturedLogger).not.toBeNull();
  });
});

// ── 2. The recorder writes a row that listRecentCachedResponses returns ──

describe("recorder write → query roundtrip", () => {
  it("persists a Gamma /markets response after queueMicrotask flush", async () => {
    state.capturedLogger?.({
      url: "https://gamma-api.polymarket.com/markets?slug=btc-updown-5m-1748653200",
      method: "GET",
      status: 200,
      bodyText: JSON.stringify([{ conditionId: "0xabc", question: "BTC Up or Down 22:00-22:05" }]),
    });
    // queueMicrotask flushes before the next await.
    await Promise.resolve();
    const rows = listRecentCachedResponses({
      source: "polymarket-gamma",
      endpoint: "/markets",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("polymarket-gamma");
    expect(rows[0].endpoint).toBe("/markets");
    expect(rows[0].query_string).toBe("slug=btc-updown-5m-1748653200");
    expect(rows[0].response_status).toBe(200);
    expect(rows[0].response_body).toContain("conditionId");
  });

  it("classifies CLOB / Data / Relayer endpoints correctly", async () => {
    state.capturedLogger?.({ url: "https://clob.polymarket.com/book?token_id=0x123", method: "GET", status: 200, bodyText: "{}" });
    state.capturedLogger?.({ url: "https://data-api.polymarket.com/positions?user=0xabc", method: "GET", status: 200, bodyText: "[]" });
    state.capturedLogger?.({ url: "https://relayer-v2.polymarket.com/relay-payload", method: "GET", status: 200, bodyText: "{}" });
    await Promise.resolve();
    const stats = cacheStats();
    const sources = stats.map((s) => s.source);
    expect(sources).toContain("polymarket-clob");
    expect(sources).toContain("polymarket-data");
    expect(sources).toContain("polymarket-relayer");
  });

  it("truncates oversized bodies with a sentinel suffix", async () => {
    // 1 MB body — over the 256 KB cap by default.
    const huge = "x".repeat(1_048_576);
    state.capturedLogger?.({ url: "https://gamma-api.polymarket.com/big", method: "GET", status: 200, bodyText: huge });
    await Promise.resolve();
    const rows = listRecentCachedResponses({ source: "polymarket-gamma", endpoint: "/big" });
    expect(rows).toHaveLength(1);
    expect(rows[0].response_size_bytes).toBe(1_048_576);
    expect(rows[0].response_body).toContain("[truncated, original 1048576B]");
    // Stored body should be capped near 256 KB + sentinel.
    expect(rows[0].response_body.length).toBeLessThan(300_000);
  });

  it("queryStringLike filter narrows the result set", async () => {
    state.capturedLogger?.({ url: "https://gamma-api.polymarket.com/markets?slug=btc-updown-5m-1", method: "GET", status: 200, bodyText: "[]" });
    state.capturedLogger?.({ url: "https://gamma-api.polymarket.com/markets?slug=eth-updown-5m-1", method: "GET", status: 200, bodyText: "[]" });
    await Promise.resolve();
    const btcOnly = listRecentCachedResponses({
      source: "polymarket-gamma",
      endpoint: "/markets",
      queryStringLike: "btc-updown",
    });
    expect(btcOnly).toHaveLength(1);
    expect(btcOnly[0].query_string).toContain("btc-updown");
  });
});

// ── 3. Pruning ────────────────────────────────────────────────────────────

describe("pruneOldCache", () => {
  it("deletes rows older than keepDays", async () => {
    // Insert a row, then backdate it.
    state.capturedLogger?.({ url: "https://gamma-api.polymarket.com/old", method: "GET", status: 200, bodyText: "{}" });
    await Promise.resolve();
    handle.prepare(`UPDATE api_call_cache SET fetched_at = datetime('now', '-10 days')`).run();
    // Add a fresh row.
    state.capturedLogger?.({ url: "https://gamma-api.polymarket.com/new", method: "GET", status: 200, bodyText: "{}" });
    await Promise.resolve();
    const deleted = pruneOldCache({ keepDays: 5 });
    expect(deleted).toBe(1);
    const remaining = handle.prepare(`SELECT COUNT(*) AS n FROM api_call_cache`).get() as { n: number };
    expect(remaining.n).toBe(1);
  });

  it("scoped prune respects source + endpoint", async () => {
    state.capturedLogger?.({ url: "https://gamma-api.polymarket.com/markets", method: "GET", status: 200, bodyText: "{}" });
    state.capturedLogger?.({ url: "https://clob.polymarket.com/book", method: "GET", status: 200, bodyText: "{}" });
    await Promise.resolve();
    handle.prepare(`UPDATE api_call_cache SET fetched_at = datetime('now', '-10 days')`).run();
    pruneOldCache({ keepDays: 5, source: "polymarket-gamma", endpoint: "/markets" });
    const remaining = handle.prepare(`SELECT source FROM api_call_cache`).all() as Array<{ source: string }>;
    expect(remaining.map((r) => r.source)).toEqual(["polymarket-clob"]);
  });
});
