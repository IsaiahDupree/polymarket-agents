/**
 * Backtest replay from `api_call_cache` — turns the recorded Polymarket
 * API responses into time-series we can feed back through any strategy's
 * decide function. This is the practical payoff of the cache: every
 * polling call against /markets?slug=… becomes one point in a price
 * trajectory we own forever.
 *
 * Architecture:
 *
 *   api_call_cache rows (raw JSON bodies)
 *           │
 *   parseGammaMarketResponse  → extract YES price + outcome metadata per row
 *           │
 *   replayCachedSlug          → chronological [{ts, yesPrice, noPrice, …}] for one slug
 *           │
 *   replayAssetWindow         → enumerate all slugs for an (asset, recurrence)
 *                               within a time window and replay each
 *
 * Pure / read-only — never writes. Tests inject a real-shape fixture so
 * the parser is locked against future Gamma schema drift.
 *
 * Why this matters: with ~50 Gamma calls per discovery cycle × 60-second
 * cadence × 7 assets × 2 recurrences, the cache compounds into a private
 * 5-minute-resolution archive of the Up/Down market across every coin we
 * touch — exactly the substrate the overfit battery (PBO/DSR/WF) needs
 * for walk-forward judgement.
 */

import { db } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// Type model

/** One Gamma /markets response row, partially parsed. The full Gamma shape
 *  has 50+ fields; we surface only the ones strategies actually use. */
export type CachedMarketState = {
  /** Wall-clock time the API call returned, ISO. From api_call_cache.fetched_at. */
  fetchedAt: string;
  /** Polymarket condition id (uuid-ish). */
  conditionId: string | null;
  /** YES / Up token id, when present (binary contracts). */
  yesTokenId: string | null;
  /** NO / Down token id, when present. */
  noTokenId: string | null;
  /** YES outcome price at fetch time, 0..1. null when Gamma omitted prices. */
  yesPrice: number | null;
  /** NO outcome price at fetch time, 0..1. */
  noPrice: number | null;
  /** Cumulative volume reported at fetch time (USD). */
  volumeUsd: number | null;
  /** Posted liquidity (USD). */
  liquidityUsd: number | null;
  /** Market title. */
  question: string | null;
  /** Market open time, ISO. */
  startIso: string | null;
  /** Market expiry, ISO. */
  endIso: string | null;
  /** "open" / "closed" — Gamma's own field. */
  closed: boolean | null;
};

/** Time-ordered series for one slug — what the strategies actually replay. */
export type SlugTrajectory = {
  slug: string;
  /** Earliest fetched_at across the trajectory. */
  firstSeen: string;
  /** Latest fetched_at. */
  lastSeen: string;
  /** Chronological points, oldest first. */
  points: CachedMarketState[];
};

// ---------------------------------------------------------------------------
// Parsing

/**
 * Parse the raw response body of a Gamma /markets call into a single
 * state snapshot. Gamma returns either an array of market objects or
 * (rarer) a single object; both are tolerated. Returns null when the
 * body doesn't yield a usable market entry.
 *
 * The fetchedAt argument is required — Gamma's response doesn't include
 * its own timestamp, so we rely on the cache row's fetched_at column.
 */
export function parseGammaMarketResponse(
  rawBody: string,
  fetchedAt: string,
): CachedMarketState | null {
  if (!rawBody) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return null; }
  // Either an array or a single object — pick the first row.
  const first =
    Array.isArray(parsed) ? parsed[0] :
    (parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>))
      ? (parsed as { data?: unknown[] }).data?.[0] :
      parsed;
  if (!first || typeof first !== "object") return null;
  const m = first as Record<string, unknown>;

  // outcomePrices comes through as a stringified JSON array on Gamma —
  // sometimes already an array. Tolerant parse.
  let prices: number[] = [];
  const rawPrices = m.outcomePrices;
  if (typeof rawPrices === "string") {
    try {
      const arr = JSON.parse(rawPrices);
      if (Array.isArray(arr)) prices = arr.map((x) => Number(x)).filter((x) => Number.isFinite(x));
    } catch { /* leave empty */ }
  } else if (Array.isArray(rawPrices)) {
    prices = rawPrices.map((x) => Number(x)).filter((x) => Number.isFinite(x));
  }

  // clobTokenIds: also stringified JSON or array. Two-token binaries: [YES, NO].
  let tokenIds: string[] = [];
  const rawTokens = m.clobTokenIds;
  if (typeof rawTokens === "string") {
    try {
      const arr = JSON.parse(rawTokens);
      if (Array.isArray(arr)) tokenIds = arr.map(String);
    } catch { /* leave empty */ }
  } else if (Array.isArray(rawTokens)) {
    tokenIds = rawTokens.map(String);
  }

  return {
    fetchedAt,
    conditionId: typeof m.conditionId === "string" ? m.conditionId : null,
    yesTokenId: tokenIds[0] ?? null,
    noTokenId: tokenIds[1] ?? null,
    yesPrice: prices[0] ?? null,
    noPrice: prices[1] ?? null,
    volumeUsd: typeof m.volumeNum === "number" ? m.volumeNum
             : (typeof m.volume === "string" ? Number(m.volume) || null
                : (typeof m.volume === "number" ? m.volume : null)),
    liquidityUsd: typeof m.liquidity === "number" ? m.liquidity
                : (typeof m.liquidity === "string" ? Number(m.liquidity) || null : null),
    question: typeof m.question === "string" ? m.question : null,
    startIso: typeof m.startDate === "string" ? m.startDate : null,
    endIso: typeof m.endDate === "string" ? m.endDate : null,
    closed: typeof m.closed === "boolean" ? m.closed : null,
  };
}

// ---------------------------------------------------------------------------
// Per-slug replay

/**
 * Slugs are stored in the cache's query_string column as `slug=…` — they
 * may appear before/after other params. This extracts the slug value
 * tolerantly for filter / display.
 */
export function slugFromQueryString(qs: string | null | undefined): string | null {
  if (!qs) return null;
  // Match "slug=" followed by non-& chars.
  const m = qs.match(/(^|&)slug=([^&]+)/);
  return m ? decodeURIComponent(m[2]) : null;
}

/**
 * Pull every cached /markets call for a given slug and replay them in
 * chronological order. Returns null when no rows are found.
 */
export function replayCachedSlug(slug: string): SlugTrajectory | null {
  const rows = db().prepare(`
    SELECT response_body, fetched_at, query_string
      FROM api_call_cache
     WHERE source = 'polymarket-gamma'
       AND endpoint = '/markets'
       AND query_string LIKE ?
     ORDER BY fetched_at ASC
  `).all(`%slug=${slug}%`) as Array<{
    response_body: string;
    fetched_at: string;
    query_string: string;
  }>;
  if (rows.length === 0) return null;

  // Verify the slug match precisely (query_string LIKE can also match a
  // longer slug as a prefix substring — guard against that).
  const points: CachedMarketState[] = [];
  for (const r of rows) {
    if (slugFromQueryString(r.query_string) !== slug) continue;
    const state = parseGammaMarketResponse(r.response_body, r.fetched_at);
    if (state) points.push(state);
  }
  if (points.length === 0) return null;
  return {
    slug,
    firstSeen: points[0].fetchedAt,
    lastSeen: points[points.length - 1].fetchedAt,
    points,
  };
}

// ---------------------------------------------------------------------------
// Slug discovery

export type SlugListOpts = {
  /** "BTC" / "ETH" / "SOL" etc. Case-insensitive substring match on the slug. */
  asset?: string;
  /** "5m" / "15m" / "1h". Substring match. */
  recurrence?: string;
  /** Earliest fetched_at to consider, ISO. */
  fromIso?: string;
  /** Latest fetched_at, ISO. */
  toIso?: string;
  /** Cap on slug count returned. Default 1000. */
  limit?: number;
};

/**
 * List distinct slugs in the cache matching the filters, ordered by most
 * recent appearance. Useful for "show me every BTC 5-min binary we've ever
 * cached in the last week" or for the replay batch driver.
 */
export function listCachedSlugs(opts: SlugListOpts = {}): Array<{
  slug: string;
  first_seen: string;
  last_seen: string;
  n_points: number;
}> {
  const limit = opts.limit ?? 1000;
  const conds: string[] = [
    "source = 'polymarket-gamma'",
    "endpoint = '/markets'",
    "query_string LIKE 'slug=%'",
  ];
  const params: Array<string | number> = [];
  if (opts.asset) {
    conds.push("LOWER(query_string) LIKE ?");
    params.push(`%${opts.asset.toLowerCase()}-updown-%`);
  }
  if (opts.recurrence) {
    conds.push("query_string LIKE ?");
    params.push(`%-updown-${opts.recurrence}-%`);
  }
  if (opts.fromIso) {
    conds.push("fetched_at >= ?");
    params.push(opts.fromIso);
  }
  if (opts.toIso) {
    conds.push("fetched_at <= ?");
    params.push(opts.toIso);
  }
  params.push(limit);
  const where = conds.join(" AND ");
  const sql = `
    SELECT query_string,
           MIN(fetched_at) AS first_seen,
           MAX(fetched_at) AS last_seen,
           COUNT(*) AS n_points
      FROM api_call_cache
     WHERE ${where}
     GROUP BY query_string
     ORDER BY last_seen DESC
     LIMIT ?
  `;
  const rows = db().prepare(sql).all(...params) as Array<{
    query_string: string;
    first_seen: string;
    last_seen: string;
    n_points: number;
  }>;
  return rows
    .map((r) => ({
      slug: slugFromQueryString(r.query_string) ?? r.query_string,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      n_points: r.n_points,
    }))
    .filter((r) => r.slug.includes("-updown-"));  // exclude any non-binary slug noise
}

// ---------------------------------------------------------------------------
// Coverage report

/**
 * Replay a batch of slugs matching a filter and report on coverage —
 * how many trajectories, total points, time span. Used by the
 * `scripts/replay-cache-summary.ts` CLI + future strategy-replay drivers.
 */
export function summarizeCacheCoverage(opts: SlugListOpts = {}): {
  matched: number;
  total_points: number;
  unique_assets: string[];
  unique_recurrences: string[];
  first_seen: string | null;
  last_seen: string | null;
  trajectories: Array<{
    slug: string;
    first_seen: string;
    last_seen: string;
    n_points: number;
  }>;
} {
  const slugs = listCachedSlugs(opts);
  if (slugs.length === 0) {
    return {
      matched: 0, total_points: 0, unique_assets: [], unique_recurrences: [],
      first_seen: null, last_seen: null, trajectories: [],
    };
  }
  const assets = new Set<string>();
  const recurrences = new Set<string>();
  let first: string | null = null;
  let last: string | null = null;
  let total = 0;
  for (const s of slugs) {
    total += s.n_points;
    if (first === null || s.first_seen < first) first = s.first_seen;
    if (last === null || s.last_seen > last) last = s.last_seen;
    const m = s.slug.match(/^([a-z]+)-updown-([0-9]+[mh])-[0-9]+$/i);
    if (m) {
      assets.add(m[1].toUpperCase());
      recurrences.add(m[2].toLowerCase());
    }
  }
  return {
    matched: slugs.length,
    total_points: total,
    unique_assets: [...assets].sort(),
    unique_recurrences: [...recurrences].sort(),
    first_seen: first, last_seen: last,
    trajectories: slugs.slice(0, 20),  // first 20 for the report; full list available via listCachedSlugs
  };
}
