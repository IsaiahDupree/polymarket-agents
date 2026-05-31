/**
 * 5-min / 15-min Up-Down market discovery — TypeScript port of
 * polymarket-2dollar-bot/polybot/polymarket.py `updown_windows()`.
 *
 * Polymarket publishes a recurring binary series per crypto asset with
 * a deterministic slug:
 *
 *   {asset_lowercase}-updown-{recurrence}-{window_start_ts}
 *
 * Example: `btc-updown-5m-1748653200` is the 5-min binary that opens at
 * unix-ts 1,748,653,200 (= 2026-05-30 22:00:00 UTC) and resolves 300s
 * later at 22:05:00. There's no need to paginate /events — once you
 * know the asset, recurrence, and time bucket, the slug is fully
 * determined.
 *
 * This module:
 *   1. Computes the slug for any (asset, recurrence, window_start_ts).
 *   2. Plans which windows to fetch (some lookback + current + lookahead).
 *   3. Fetches each via the existing Gamma client (poly.marketBySlug).
 *   4. Upserts to the `poly_binaries` table so the existing arena decide
 *      functions (markov_persistence, poly_repricing, poly_near_resolution)
 *      can read the metadata via getBinaryMeta().
 *
 * Pure helpers are exported for direct use in tests.
 */

import { poly } from "@adapters/polymarket/client";

import {
  upsertBinary,
  parseAssetFromTitle,
  type BinaryAsset,
} from "@/lib/arena/short-binaries";

export type Recurrence = "5m" | "15m" | "1h" | "4h";

/**
 * Step in seconds per recurrence. The slug timestamp is aligned to a
 * multiple of this — bucketing the unix-second timeline into recurrence-
 * sized windows.
 */
export function recurrenceStepSec(recurrence: Recurrence): number {
  switch (recurrence) {
    case "5m":  return 300;
    case "15m": return 900;
    case "1h":  return 3600;
    case "4h":  return 14400;
  }
}

/** Map a recurrence tag to the duration_kind format used in poly_binaries. */
export function recurrenceToDurationKind(recurrence: Recurrence): string {
  switch (recurrence) {
    case "5m":  return "5M";
    case "15m": return "15M";
    case "1h":  return "1H";
    case "4h":  return "4H";
  }
}

/**
 * Floor `nowSec` to the most recent step boundary for the recurrence.
 * Mirrors the Python `base = (int(time.time()) // step) * step`.
 */
export function alignToWindow(nowSec: number, recurrence: Recurrence): number {
  const step = recurrenceStepSec(recurrence);
  return Math.floor(nowSec / step) * step;
}

/** Compute the slug for one (asset, recurrence, window_start_ts) combo. */
export function computeUpdownSlug(
  asset: BinaryAsset,
  recurrence: Recurrence,
  windowStartTs: number,
): string {
  return `${asset.toLowerCase()}-updown-${recurrence}-${windowStartTs}`;
}

export type UpdownWindowPlan = {
  asset: BinaryAsset;
  recurrence: Recurrence;
  /** Window-start unix-second (the slug's timestamp). */
  startTs: number;
  /** Window-end unix-second (startTs + recurrenceStepSec). */
  endTs: number;
  slug: string;
};

/**
 * Build the list of (asset, recurrence, window) tuples we want to fetch
 * from Gamma in this scan cycle. Mirrors the Python loop:
 *
 *   for k in range(-lookback, count + 1):
 *     ts = base + step * k
 *     ...
 *
 * `lookback` includes recently-CLOSED windows so the post-close
 * resolution-lag is reachable; `lookahead` is how many future windows to
 * pre-fetch (typically 3-5).
 */
export function planUpdownWindows(opts: {
  assets: BinaryAsset[];
  recurrences: Recurrence[];
  /** Now in unix seconds. Defaults to Date.now() / 1000. */
  nowSec?: number;
  /** How many windows in the future to fetch. Default 3. */
  lookahead?: number;
  /** How many CLOSED windows to also fetch. Default 1. */
  lookback?: number;
}): UpdownWindowPlan[] {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const lookahead = opts.lookahead ?? 3;
  const lookback = opts.lookback ?? 1;
  const plans: UpdownWindowPlan[] = [];
  for (const asset of opts.assets) {
    for (const rec of opts.recurrences) {
      const step = recurrenceStepSec(rec);
      const base = alignToWindow(now, rec);
      for (let k = -lookback; k <= lookahead; k++) {
        const startTs = base + step * k;
        plans.push({
          asset,
          recurrence: rec,
          startTs,
          endTs: startTs + step,
          slug: computeUpdownSlug(asset, rec, startTs),
        });
      }
    }
  }
  return plans;
}

/**
 * Reference price parsing — Up/Down binaries store the strike price in
 * the question text, e.g. "Will BTC be above $108,500 at 22:05 UTC?".
 * Try both common formats and return undefined if the dollar amount
 * can't be extracted (the strategies that need it will skip the market).
 */
export function parseReferencePrice(question: string): number | undefined {
  // "$108,500" or "$108500.50"
  const m = question.match(/\$([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Result of a single scan pass — mirrors what `evolution_log` logs back
 * for the operator to see in the dashboard.
 */
export type ScanResult = {
  attempted: number;
  fetched: number;
  upserted: number;
  notFound: number;
  errors: number;
  /** Slugs we couldn't resolve (for diagnostics, max 20 surfaced). */
  missingSlugs: string[];
};

/**
 * Run the full scan: plan windows, fetch each via Gamma, upsert any that
 * resolve into poly_binaries. Pure-async; caller decides cadence.
 *
 * Failures on individual slugs are NON-FATAL — a missing 5-min window is
 * normal (the series may not have published it yet, or the window may
 * have rolled off). Errors are counted, not thrown.
 */
export async function scanAndUpsertUpdownWindows(
  opts: Parameters<typeof planUpdownWindows>[0],
): Promise<ScanResult> {
  const plans = planUpdownWindows(opts);
  const result: ScanResult = {
    attempted: plans.length,
    fetched: 0,
    upserted: 0,
    notFound: 0,
    errors: 0,
    missingSlugs: [],
  };
  for (const plan of plans) {
    let raw: any;
    try {
      raw = await poly.marketBySlug(plan.slug);
    } catch {
      result.errors += 1;
      continue;
    }
    if (!raw) {
      result.notFound += 1;
      if (result.missingSlugs.length < 20) result.missingSlugs.push(plan.slug);
      continue;
    }
    result.fetched += 1;

    // Skip already-closed markets and ones without orderbook tokens.
    if (raw.closed === true) continue;
    const tokenIdsRaw = raw.clobTokenIds;
    if (!tokenIdsRaw) continue;
    let tokenIds: string[];
    try {
      tokenIds = typeof tokenIdsRaw === "string" ? JSON.parse(tokenIdsRaw) : tokenIdsRaw;
    } catch {
      continue;
    }
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) continue;
    const yesToken = tokenIds[0];
    const noToken = tokenIds[1] ?? null;
    if (!yesToken) continue;

    const question = String(raw.question ?? "");
    const asset = parseAssetFromTitle(question) || plan.asset;
    const referencePrice = parseReferencePrice(question);

    try {
      upsertBinary({
        token_id: yesToken,
        condition_id: raw.conditionId ?? "",
        no_token_id: noToken,
        question,
        asset: asset as BinaryAsset,
        duration_kind: recurrenceToDurationKind(plan.recurrence),
        start_iso: new Date(plan.startTs * 1000).toISOString(),
        expiry_iso: new Date(plan.endTs * 1000).toISOString(),
        event_slug: plan.slug,
      });
      // reference_price is set by a follow-up update path; upsertBinary's
      // shape doesn't include it directly, but the row exists now and a
      // separate db().prepare(...) update can patch it later.
      void referencePrice;
      result.upserted += 1;
    } catch {
      result.errors += 1;
    }
  }
  return result;
}
