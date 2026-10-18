/**
 * Unit tests for src/lib/quant/book-snapshot-lookup.ts — covers the
 * parser (real CLOB response shape, missing sides), the read helpers
 * (freshness gate, window selection), and the OFI bridge.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { handle } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const h = new Database(":memory:");
  h.exec(`
    CREATE TABLE IF NOT EXISTS book_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id TEXT NOT NULL, ts_unix_ms INTEGER NOT NULL,
      bid_price REAL, bid_size REAL, ask_price REAL, ask_size REAL,
      midpoint REAL, spread REAL,
      total_bid_depth REAL, total_ask_depth REAL,
      n_bid_levels INTEGER, n_ask_levels INTEGER
    );
  `);
  return { handle: h };
});
vi.mock("@/lib/db/client", () => ({
  db: () => handle,
  closeDb: () => handle.close(),
}));

import {
  parseClobBook,
  recordBookSnapshot,
  getFreshestBookSnapshot,
  getBookWindow,
  computeOfiFromBookWindow,
  pruneOldBookSnapshots,
} from "@/lib/quant/book-snapshot-lookup";

beforeEach(() => { handle.exec("DELETE FROM book_snapshots"); });

describe("parseClobBook", () => {
  it("extracts top-of-book + depth from a normal response", () => {
    const book = {
      bids: [
        { price: "0.48", size: "100" },
        { price: "0.47", size: "200" },
      ],
      asks: [
        { price: "0.52", size: "120" },
        { price: "0.53", size: "80" },
      ],
    };
    const s = parseClobBook(book, "tok-yes", 1_700_000_000_000);
    expect(s.token_id).toBe("tok-yes");
    expect(s.bid_price).toBeCloseTo(0.48);
    expect(s.bid_size).toBeCloseTo(100);
    expect(s.ask_price).toBeCloseTo(0.52);
    expect(s.ask_size).toBeCloseTo(120);
    expect(s.midpoint).toBeCloseTo(0.50);
    expect(s.spread).toBeCloseTo(0.04);
    expect(s.total_bid_depth).toBeCloseTo(300);
    expect(s.total_ask_depth).toBeCloseTo(200);
    expect(s.n_bid_levels).toBe(2);
    expect(s.n_ask_levels).toBe(2);
  });

  it("re-sorts unsorted bids/asks before picking top", () => {
    const book = {
      bids: [{ price: "0.45", size: "10" }, { price: "0.48", size: "30" }, { price: "0.46", size: "20" }],
      asks: [{ price: "0.54", size: "10" }, { price: "0.52", size: "30" }],
    };
    const s = parseClobBook(book, "x", 0);
    expect(s.bid_price).toBeCloseTo(0.48);
    expect(s.ask_price).toBeCloseTo(0.52);
  });

  it("tolerates a missing side (one-sided book)", () => {
    const book = { bids: [{ price: "0.48", size: "100" }], asks: [] };
    const s = parseClobBook(book, "x", 0);
    expect(s.bid_price).toBeCloseTo(0.48);
    expect(s.ask_price).toBeNull();
    expect(s.midpoint).toBeNull();
    expect(s.spread).toBeNull();
  });

  it("tolerates an empty / malformed book", () => {
    const s = parseClobBook(null, "x", 0);
    expect(s.bid_price).toBeNull();
    expect(s.ask_price).toBeNull();
    expect(s.n_bid_levels).toBe(0);
    expect(s.n_ask_levels).toBe(0);
  });

  it("filters zero-size rows", () => {
    const book = {
      bids: [{ price: "0.48", size: "0" }, { price: "0.47", size: "200" }],
      asks: [{ price: "0.52", size: "120" }],
    };
    const s = parseClobBook(book, "x", 0);
    expect(s.bid_price).toBeCloseTo(0.47);  // 0-size row dropped, next best wins
  });
});

describe("recordBookSnapshot + getFreshestBookSnapshot", () => {
  it("roundtrips a snapshot row", () => {
    const s = parseClobBook({ bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 120 }] }, "tok-a", 5_000);
    recordBookSnapshot(s);
    const got = getFreshestBookSnapshot("tok-a", 60_000, 5_000);
    expect(got).not.toBeNull();
    expect(got?.bid_price).toBeCloseTo(0.48);
  });

  it("returns null when freshest row is stale", () => {
    const s = parseClobBook({ bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 120 }] }, "tok-a", 1_000);
    recordBookSnapshot(s);
    // now = 100_000 → row age = 99,000 ms; maxAgeMs = 5_000 → null
    expect(getFreshestBookSnapshot("tok-a", 5_000, 100_000)).toBeNull();
    // maxAgeMs = 200_000 → fresh
    expect(getFreshestBookSnapshot("tok-a", 200_000, 100_000)).not.toBeNull();
  });

  it("returns null for unknown token", () => {
    expect(getFreshestBookSnapshot("nope", 5_000, 100_000)).toBeNull();
  });
});

describe("getBookWindow", () => {
  it("returns chronological samples within the window", () => {
    for (const ts of [1_000, 2_000, 3_000, 4_000, 5_000]) {
      recordBookSnapshot(parseClobBook(
        { bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 120 }] }, "tok-a", ts,
      ));
    }
    const w = getBookWindow("tok-a", 3_000, 5_000);  // last 3 s
    expect(w.map((r) => r.ts_unix_ms)).toEqual([2_000, 3_000, 4_000, 5_000]);
  });

  it("excludes other tokens", () => {
    recordBookSnapshot(parseClobBook({ bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 120 }] }, "tok-a", 1_000));
    recordBookSnapshot(parseClobBook({ bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 120 }] }, "tok-b", 1_000));
    expect(getBookWindow("tok-a", 5_000, 5_000)).toHaveLength(1);
  });
});

describe("computeOfiFromBookWindow", () => {
  it("returns 0 when not enough samples", () => {
    expect(computeOfiFromBookWindow("nope")).toEqual({ ofi: 0, samplesUsed: 0, samplesAvailable: 0 });
  });

  it("drops one-sided snapshots before running OFI", () => {
    // 2 valid snapshots + 1 one-sided → 2 used, 3 available.
    recordBookSnapshot(parseClobBook({ bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 120 }] }, "tok-a", 1_000));
    recordBookSnapshot(parseClobBook({ bids: [{ price: 0.48, size: 100 }], asks: [] }, "tok-a", 2_000));
    recordBookSnapshot(parseClobBook({ bids: [{ price: 0.49, size: 100 }], asks: [{ price: 0.52, size: 120 }] }, "tok-a", 3_000));
    const r = computeOfiFromBookWindow("tok-a", { windowMs: 10_000, nowMs: 3_000 });
    expect(r.samplesAvailable).toBe(3);
    expect(r.samplesUsed).toBe(2);
    // 2 usable samples = 1 event. Bid improved 0.48→0.49 → +100. Ask unchanged → 0.
    // OFI = +100 in the trailing 1-second window.
    expect(r.ofi).toBe(100);
  });
});

describe("pruneOldBookSnapshots", () => {
  it("deletes rows older than keepHours", () => {
    // Insert a row with a backdated ts.
    handle.prepare(
      `INSERT INTO book_snapshots (token_id, ts_unix_ms, bid_price, bid_size, ask_price, ask_size,
                                    midpoint, spread, total_bid_depth, total_ask_depth, n_bid_levels, n_ask_levels)
       VALUES ('old', 1, 0.48, 100, 0.52, 120, 0.5, 0.04, 100, 120, 1, 1)`,
    ).run();
    handle.prepare(
      `INSERT INTO book_snapshots (token_id, ts_unix_ms, bid_price, bid_size, ask_price, ask_size,
                                    midpoint, spread, total_bid_depth, total_ask_depth, n_bid_levels, n_ask_levels)
       VALUES ('new', strftime('%s', 'now')*1000, 0.48, 100, 0.52, 120, 0.5, 0.04, 100, 120, 1, 1)`,
    ).run();
    const deleted = pruneOldBookSnapshots(1);
    expect(deleted).toBe(1);
    const remaining = handle.prepare("SELECT token_id FROM book_snapshots").all() as Array<{ token_id: string }>;
    expect(remaining.map((r) => r.token_id)).toEqual(["new"]);
  });
});
