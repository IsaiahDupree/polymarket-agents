/**
 * Unit tests for src/lib/backtest/cache-replay.ts — the parser locks
 * the Gamma /markets response shape, the slug helpers cover their
 * matching, and the DB-touching helpers use an in-memory store seeded
 * with realistic fixture rows.
 */
import { describe, expect, it, vi } from "vitest";

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
      fetched_at TEXT NOT NULL
    );
  `);
  return { handle: h };
});

vi.mock("@/lib/db/client", () => ({
  db: () => handle,
  closeDb: () => handle.close(),
}));

import {
  parseGammaMarketResponse,
  slugFromQueryString,
  replayCachedSlug,
  listCachedSlugs,
  summarizeCacheCoverage,
} from "@/lib/backtest/cache-replay";

// ---------------------------------------------------------------------------
// Realistic fixture mirroring an actual Gamma /markets response

const MARKET_RESPONSE = JSON.stringify([{
  conditionId: "0xabcdef1234567890",
  question: "Bitcoin Up or Down - May 31, 3:45AM-4:00AM ET",
  outcomes: ["Up", "Down"],
  outcomePrices: "[\"0.4801\", \"0.5199\"]",  // Gamma serializes this as a string
  clobTokenIds: "[\"123456789yes\", \"987654321no\"]",
  volume: "12.45",
  volumeNum: 12.45,
  liquidity: 2456.7,
  startDate: "2026-05-31T07:30:00Z",
  endDate: "2026-05-31T08:00:00Z",
  closed: false,
}]);

// ---------------------------------------------------------------------------
// parseGammaMarketResponse

describe("parseGammaMarketResponse", () => {
  it("parses a real Gamma response shape", () => {
    const s = parseGammaMarketResponse(MARKET_RESPONSE, "2026-05-31T03:50:00Z");
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.fetchedAt).toBe("2026-05-31T03:50:00Z");
    expect(s.conditionId).toBe("0xabcdef1234567890");
    expect(s.yesTokenId).toBe("123456789yes");
    expect(s.noTokenId).toBe("987654321no");
    expect(s.yesPrice).toBeCloseTo(0.4801, 4);
    expect(s.noPrice).toBeCloseTo(0.5199, 4);
    expect(s.volumeUsd).toBeCloseTo(12.45, 4);
    expect(s.liquidityUsd).toBeCloseTo(2456.7, 1);
    expect(s.endIso).toBe("2026-05-31T08:00:00Z");
    expect(s.closed).toBe(false);
  });

  it("handles outcomePrices already as an array (not string)", () => {
    const body = JSON.stringify([{
      conditionId: "x",
      question: "Q",
      outcomePrices: [0.7, 0.3],
      clobTokenIds: ["a", "b"],
    }]);
    const s = parseGammaMarketResponse(body, "2026-01-01T00:00:00Z");
    expect(s?.yesPrice).toBe(0.7);
    expect(s?.noPrice).toBe(0.3);
  });

  it("returns null on empty / malformed bodies", () => {
    expect(parseGammaMarketResponse("", "2026-01-01T00:00:00Z")).toBeNull();
    expect(parseGammaMarketResponse("not json", "2026-01-01T00:00:00Z")).toBeNull();
    expect(parseGammaMarketResponse("null", "2026-01-01T00:00:00Z")).toBeNull();
    expect(parseGammaMarketResponse("[]", "2026-01-01T00:00:00Z")).toBeNull();
  });

  it("tolerates a single-object response (not wrapped in array)", () => {
    const body = JSON.stringify({
      conditionId: "x",
      question: "Q",
      outcomePrices: "[\"0.6\", \"0.4\"]",
      clobTokenIds: "[\"yes\", \"no\"]",
    });
    const s = parseGammaMarketResponse(body, "2026-01-01T00:00:00Z");
    expect(s?.yesPrice).toBeCloseTo(0.6);
  });

  it("preserves null for fields Gamma omitted", () => {
    const body = JSON.stringify([{ question: "no prices market" }]);
    const s = parseGammaMarketResponse(body, "2026-01-01T00:00:00Z");
    expect(s).not.toBeNull();
    expect(s?.yesPrice).toBeNull();
    expect(s?.noPrice).toBeNull();
    expect(s?.conditionId).toBeNull();
    expect(s?.yesTokenId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// slugFromQueryString

describe("slugFromQueryString", () => {
  it("extracts the slug value", () => {
    expect(slugFromQueryString("slug=btc-updown-5m-1748653200")).toBe("btc-updown-5m-1748653200");
  });
  it("handles slug not as the first param", () => {
    expect(slugFromQueryString("limit=10&slug=btc-updown-5m-1748653200")).toBe("btc-updown-5m-1748653200");
  });
  it("handles URL-encoded values", () => {
    expect(slugFromQueryString("slug=btc%2Dupdown")).toBe("btc-updown");
  });
  it("returns null when no slug param", () => {
    expect(slugFromQueryString(null)).toBeNull();
    expect(slugFromQueryString(undefined)).toBeNull();
    expect(slugFromQueryString("")).toBeNull();
    expect(slugFromQueryString("limit=10")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DB-touching helpers — seeded with fixtures

function seedRow(slug: string, fetchedAt: string, body: string): void {
  handle.prepare(`
    INSERT INTO api_call_cache
      (source, endpoint, query_string, request_method, response_status,
       response_size_bytes, response_body, fetched_at)
    VALUES ('polymarket-gamma', '/markets', ?, 'GET', 200, ?, ?, ?)
  `).run(`slug=${slug}`, body.length, body, fetchedAt);
}

describe("replayCachedSlug", () => {
  it("returns null for slug not in the cache", () => {
    handle.exec("DELETE FROM api_call_cache");
    expect(replayCachedSlug("nonexistent-slug")).toBeNull();
  });

  it("returns a chronological trajectory for matching rows", () => {
    handle.exec("DELETE FROM api_call_cache");
    const slug = "btc-updown-5m-1748653200";
    seedRow(slug, "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    seedRow(slug, "2026-05-31T03:51:00Z", MARKET_RESPONSE.replace("0.4801", "0.5125").replace("0.5199", "0.4875"));
    seedRow(slug, "2026-05-31T03:52:00Z", MARKET_RESPONSE.replace("0.4801", "0.5500").replace("0.5199", "0.4500"));
    const t = replayCachedSlug(slug);
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.slug).toBe(slug);
    expect(t.firstSeen).toBe("2026-05-31T03:50:00Z");
    expect(t.lastSeen).toBe("2026-05-31T03:52:00Z");
    expect(t.points).toHaveLength(3);
    expect(t.points[0].yesPrice).toBeCloseTo(0.4801, 4);
    expect(t.points[1].yesPrice).toBeCloseTo(0.5125, 4);
    expect(t.points[2].yesPrice).toBeCloseTo(0.5500, 4);
  });

  it("ignores rows whose slug is a prefix substring of another slug", () => {
    handle.exec("DELETE FROM api_call_cache");
    // "btc-updown-5m-1" and "btc-updown-5m-17" — without precise check,
    // the LIKE 'slug=btc-updown-5m-1%' query would match BOTH.
    seedRow("btc-updown-5m-1", "2026-01-01T00:00:00Z", MARKET_RESPONSE);
    seedRow("btc-updown-5m-17", "2026-01-01T00:01:00Z", MARKET_RESPONSE);
    const t = replayCachedSlug("btc-updown-5m-1");
    expect(t?.points).toHaveLength(1);
  });
});

describe("listCachedSlugs + summarizeCacheCoverage", () => {
  it("aggregates point counts + first/last seen per slug", () => {
    handle.exec("DELETE FROM api_call_cache");
    const slug1 = "btc-updown-5m-1748653200";
    const slug2 = "eth-updown-5m-1748653200";
    seedRow(slug1, "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    seedRow(slug1, "2026-05-31T03:51:00Z", MARKET_RESPONSE);
    seedRow(slug2, "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    const list = listCachedSlugs();
    expect(list).toHaveLength(2);
    const btc = list.find((s) => s.slug.startsWith("btc"));
    expect(btc?.n_points).toBe(2);
  });

  it("asset filter narrows to that asset", () => {
    handle.exec("DELETE FROM api_call_cache");
    seedRow("btc-updown-5m-1", "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    seedRow("eth-updown-5m-1", "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    seedRow("sol-updown-5m-1", "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    const btcOnly = listCachedSlugs({ asset: "BTC" });
    expect(btcOnly).toHaveLength(1);
    expect(btcOnly[0].slug).toContain("btc-");
  });

  it("recurrence filter narrows to that interval", () => {
    handle.exec("DELETE FROM api_call_cache");
    seedRow("btc-updown-5m-1", "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    seedRow("btc-updown-15m-1", "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    const fiveOnly = listCachedSlugs({ recurrence: "5m" });
    expect(fiveOnly).toHaveLength(1);
    expect(fiveOnly[0].slug).toContain("-5m-");
  });

  it("summarizeCacheCoverage gives the operator report", () => {
    handle.exec("DELETE FROM api_call_cache");
    seedRow("btc-updown-5m-1", "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    seedRow("btc-updown-5m-1", "2026-05-31T03:51:00Z", MARKET_RESPONSE);
    seedRow("eth-updown-15m-1", "2026-05-31T03:50:00Z", MARKET_RESPONSE);
    const r = summarizeCacheCoverage();
    expect(r.matched).toBe(2);
    expect(r.total_points).toBe(3);
    expect(r.unique_assets.sort()).toEqual(["BTC", "ETH"]);
    expect(r.unique_recurrences.sort()).toEqual(["15m", "5m"]);
  });

  it("returns zeros when nothing matches", () => {
    handle.exec("DELETE FROM api_call_cache");
    const r = summarizeCacheCoverage({ asset: "DOGE" });
    expect(r.matched).toBe(0);
    expect(r.total_points).toBe(0);
    expect(r.first_seen).toBeNull();
  });
});
