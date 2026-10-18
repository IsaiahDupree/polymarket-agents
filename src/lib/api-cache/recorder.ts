/**
 * Polymarket API response recorder. Hooks into the adapter's response
 * logger and persists every successful GET into `api_call_cache`.
 *
 * Rationale: Polymarket's public REST endpoints (Gamma /markets, /events,
 * CLOB /book, /price, etc.) DO NOT preserve long historical data. Every
 * call we make is a free sample we'd otherwise throw away. Capturing them
 * builds a private archive that backtests + the overfit battery + future
 * walk-forward replays can pull from.
 *
 * Architecture:
 *
 *   adapter client.ts ──setResponseLogger()──→ this recorder
 *                                              │
 *                                              ▼
 *                                       api_call_cache (SQLite)
 *
 * The recorder runs the write via queueMicrotask so the hot fetch path
 * isn't blocked on disk I/O. Errors during write are swallowed (better to
 * lose one cache entry than break the caller).
 *
 * Side-effect import: `import "@/lib/api-cache/recorder"` calls
 * `setResponseLogger()` once. Workers that include `import "./_env.ts"`
 * also get the recorder transitively (because _env.ts imports this file).
 *
 * Env toggle: `API_CACHE_DISABLED=1` short-circuits the registration so
 * tests / smoke harnesses can opt out.
 */

import { setResponseLogger } from "@adapters/polymarket/client";
import { db } from "@/lib/db/client";

/** Maximum response-body size we cache, in bytes. Larger responses are
 *  truncated with a sentinel suffix so the row size stays bounded. */
const MAX_BODY_BYTES = Number(process.env.API_CACHE_MAX_BODY_BYTES ?? "262144"); // 256 KB

/**
 * Classify which Polymarket service the URL targets. Used as the `source`
 * column so backtests can filter ("give me every /book call for token X
 * in the last 7 days"). Falls back to "polymarket-other" if no host matches.
 */
function classifySource(url: string): string {
  if (url.includes("gamma-api.polymarket.com") || url.includes("/gamma/")) return "polymarket-gamma";
  if (url.includes("data-api.polymarket.com")) return "polymarket-data";
  if (url.includes("clob.polymarket.com")) return "polymarket-clob";
  if (url.includes("relayer-v2.polymarket.com") || url.includes("/relayer/")) return "polymarket-relayer";
  return "polymarket-other";
}

/**
 * Strip the protocol + host, return (endpoint, queryString). The endpoint
 * is the path segment (e.g. "/markets"); the queryString is everything
 * after "?". Both go into the cache row.
 */
function splitUrl(url: string): { endpoint: string; queryString: string | null } {
  try {
    const u = new URL(url);
    return {
      endpoint: u.pathname || "/",
      queryString: u.search ? u.search.slice(1) : null,
    };
  } catch {
    // Malformed URL — store the whole thing as the endpoint.
    return { endpoint: url, queryString: null };
  }
}

let insertStmt: ReturnType<ReturnType<typeof db>["prepare"]> | null = null;
function getInsertStmt() {
  if (!insertStmt) {
    insertStmt = db().prepare(`
      INSERT INTO api_call_cache
        (source, endpoint, query_string, request_method,
         response_status, response_size_bytes, response_body)
      VALUES (@source, @endpoint, @query_string, @request_method,
              @response_status, @response_size_bytes, @response_body)
    `);
  }
  return insertStmt;
}

/** The actual recorder. Non-blocking — schedules the DB write so the fetch
 *  caller never waits for disk. */
function record(entry: {
  url: string;
  method: "GET";
  status: number;
  bodyText: string;
}): void {
  // Bound the row size — Gamma's larger responses can be a few hundred KB,
  // but at 60s polling × hundreds of markets/day this would grow the DB
  // by GB/month. Truncate above the cap with a sentinel.
  let bodyText = entry.bodyText;
  if (bodyText.length > MAX_BODY_BYTES) {
    bodyText = bodyText.slice(0, MAX_BODY_BYTES) + `... [truncated, original ${entry.bodyText.length}B]`;
  }
  const { endpoint, queryString } = splitUrl(entry.url);
  const source = classifySource(entry.url);
  queueMicrotask(() => {
    try {
      getInsertStmt().run({
        source,
        endpoint,
        query_string: queryString,
        request_method: entry.method,
        response_status: entry.status,
        response_size_bytes: entry.bodyText.length,
        response_body: bodyText,
      });
    } catch {
      // DB write error — swallowed. The cache is best-effort; a missing
      // entry doesn't degrade the bot's running behavior.
    }
  });
}

if (process.env.API_CACHE_DISABLED !== "1") {
  setResponseLogger(record);
}

// ---------------------------------------------------------------------------
// Query helpers — used by backtests + the dashboard to pull historical
// responses without re-hitting Polymarket.

export type CachedResponse = {
  id: number;
  source: string;
  endpoint: string;
  query_string: string | null;
  response_status: number;
  response_size_bytes: number;
  response_body: string;
  fetched_at: string;
};

/**
 * Most-recent cached responses for a (source, endpoint) pair. Useful for
 * "show me the last book snapshot for token X" or "give me the latest
 * /markets?slug=btc-updown-5m-... call".
 */
export function listRecentCachedResponses(opts: {
  source: string;
  endpoint: string;
  /** Optional substring match on query_string. */
  queryStringLike?: string;
  limit?: number;
}): CachedResponse[] {
  const limit = opts.limit ?? 50;
  if (opts.queryStringLike) {
    return db().prepare(`
      SELECT id, source, endpoint, query_string,
             response_status, response_size_bytes, response_body, fetched_at
        FROM api_call_cache
       WHERE source = ? AND endpoint = ? AND query_string LIKE ?
       ORDER BY id DESC LIMIT ?
    `).all(opts.source, opts.endpoint, `%${opts.queryStringLike}%`, limit) as CachedResponse[];
  }
  return db().prepare(`
    SELECT id, source, endpoint, query_string,
           response_status, response_size_bytes, response_body, fetched_at
      FROM api_call_cache
     WHERE source = ? AND endpoint = ?
     ORDER BY id DESC LIMIT ?
  `).all(opts.source, opts.endpoint, limit) as CachedResponse[];
}

/** Total cached-response counts by (source, endpoint). For dashboards. */
export function cacheStats(): Array<{ source: string; endpoint: string; n: number; first_seen: string; last_seen: string }> {
  return db().prepare(`
    SELECT source, endpoint, COUNT(*) AS n,
           MIN(fetched_at) AS first_seen,
           MAX(fetched_at) AS last_seen
      FROM api_call_cache
     GROUP BY source, endpoint
     ORDER BY n DESC
  `).all() as Array<{ source: string; endpoint: string; n: number; first_seen: string; last_seen: string }>;
}

/**
 * Aggressive rotation: drop entries older than `keepDays` for a given
 * (source, endpoint). The default is to NOT rotate — we want long
 * histories for the backtests. Operators with disk pressure can run
 * this periodically to bound growth.
 */
export function pruneOldCache(opts: { keepDays: number; source?: string; endpoint?: string }): number {
  const cutoff = new Date(Date.now() - opts.keepDays * 86_400_000).toISOString();
  if (opts.source && opts.endpoint) {
    return db().prepare(`DELETE FROM api_call_cache WHERE source=? AND endpoint=? AND fetched_at < ?`)
      .run(opts.source, opts.endpoint, cutoff).changes;
  }
  if (opts.source) {
    return db().prepare(`DELETE FROM api_call_cache WHERE source=? AND fetched_at < ?`)
      .run(opts.source, cutoff).changes;
  }
  return db().prepare(`DELETE FROM api_call_cache WHERE fetched_at < ?`).run(cutoff).changes;
}
