/**
 * Momentum derivatives over 1-min candles.
 *
 *   velocity(windowMin)      = pct change over the last N candles
 *   acceleration(windowMin)  = change in velocity (velocity_now − velocity_prev)
 *   zVelocity                = velocity / rolling stdev of velocity series
 *
 * Reads from coinbase_candles. Pure-function math; the DB read is in
 * `loadRecentCandles()` so tests can supply data directly.
 */
import { db } from "@/lib/db/client";

export type Candle = {
  product_id: string;
  start_unix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

/**
 * Loads candles for an arbitrary (exchange, instrument) pair from
 * `coindesk_candles` only (no Coinbase union). Used for OKX BNB/HYPE feeds
 * and any other non-Coinbase venue we ingest. Returns oldest-first.
 */
export function loadRecentCandlesFromCoindesk(
  market: string,
  instrument: string,
  lookbackMin = 60,
  opts: { cutoffUnix?: number; granularity?: string } = {},
): Candle[] {
  const cutoff = opts.cutoffUnix ?? Math.floor(Date.now() / 1000);
  const granularity = opts.granularity ?? "ONE_MINUTE";
  const minStart = cutoff - lookbackMin * 60;
  return db().prepare(
    `SELECT instrument AS product_id, start_unix, open, high, low, close, volume
       FROM coindesk_candles
       WHERE market = ? AND instrument = ? AND granularity = ?
         AND start_unix >= ? AND start_unix <= ?
       ORDER BY start_unix ASC`,
  ).all(market, instrument, granularity, minStart, cutoff) as Candle[];
}

// ---------------------------------------------------------------------------
// Pre-load fast-path
//
// simulateAgentReplay (backtest engine) sets a module-level candle cache via
// setPreloadedCandles() before iterating. When set, every loadRecentCandles
// call short-circuits the SQL hot-path and slices from in-memory arrays. This
// drops 14-day backtests from ~3min to ~5s and removes contention with the
// live arena worker on the main DB.
//
// preloadedNowUnix lets the backtest tick "freeze time" so loadRecentCandles
// defaults its cutoff to the tick's simulated now instead of wall-clock now
// (which would leak future data into the replay).
//
// Reset to null when the backtest finishes. Live arena ticks NEVER set this —
// they want true wall-clock cutoffs + live SQL data.
let preloadedCandles: Map<string, Candle[]> | null = null;
let preloadedNowUnix: number | null = null;

export function setPreloadedCandles(map: Map<string, Candle[]> | null, nowUnix: number | null = null): void {
  preloadedCandles = map;
  preloadedNowUnix = nowUnix;
}

export function getPreloadedNowUnix(): number | null {
  return preloadedNowUnix;
}

/**
 * Loads recent candles for a product. Honors preloaded in-memory cache when
 * set (backtest fast-path); otherwise UNIONs live `coinbase_candles` with
 * historical-backfill `coindesk_candles`.
 *
 * Pass `cutoffUnix` to clamp to a historical "now" (used in replay mode);
 * defaults to the preloaded tick-now if set, else wall-clock now.
 * Pass `opts.unionHistorical = false` to skip the CoinDesk union.
 */
export function loadRecentCandles(
  productId: string,
  lookbackMin = 60,
  opts: { cutoffUnix?: number; granularity?: string; unionHistorical?: boolean; coindeskMarket?: string } = {},
): Candle[] {
  const cutoff = opts.cutoffUnix ?? preloadedNowUnix ?? Math.floor(Date.now() / 1000);

  // Fast path: preloaded cache. Linear filter; for 14-day windows with
  // ~20K candles per product this is sub-millisecond.
  if (preloadedCandles) {
    const arr = preloadedCandles.get(productId);
    if (!arr || arr.length === 0) return [];
    const minStart = cutoff - lookbackMin * 60;
    // Binary search for the bounds since the array is sorted ASC by start_unix.
    let lo = lowerBound(arr, minStart);
    let hi = upperBound(arr, cutoff);
    return arr.slice(lo, hi);
  }

  const granularity = opts.granularity ?? "ONE_MINUTE";
  const minStart = cutoff - lookbackMin * 60;
  const coindeskMarket = opts.coindeskMarket ?? "coinbase";
  const union = opts.unionHistorical !== false;

  const cbRows = db().prepare(
    `SELECT product_id, start_unix, open, high, low, close, volume
       FROM coinbase_candles
       WHERE product_id = ? AND granularity = ?
         AND start_unix >= ? AND start_unix <= ?
       ORDER BY start_unix ASC`,
  ).all(productId, granularity, minStart, cutoff) as Candle[];

  if (!union) return cbRows;

  // Skip CoinDesk lookup if the table doesn't exist yet (older DB schema).
  const tableExists = db().prepare(
    `SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'coindesk_candles'`,
  ).get() as { x: number } | undefined;
  if (!tableExists) return cbRows;

  const cdRows = db().prepare(
    `SELECT instrument AS product_id, start_unix, open, high, low, close, volume
       FROM coindesk_candles
       WHERE market = ? AND instrument = ? AND granularity = ?
         AND start_unix >= ? AND start_unix <= ?
       ORDER BY start_unix ASC`,
  ).all(coindeskMarket, productId, granularity, minStart, cutoff) as Candle[];

  if (cdRows.length === 0) return cbRows;

  // Merge: Coinbase wins on overlap, otherwise CoinDesk fills the gap.
  const byStart = new Map<number, Candle>();
  for (const r of cdRows) byStart.set(r.start_unix, r);
  for (const r of cbRows) byStart.set(r.start_unix, r); // overwrites if duplicate
  return Array.from(byStart.values()).sort((a, b) => a.start_unix - b.start_unix);
}

/** Most recent close price; undefined if no candles. */
export function latestClose(candles: Candle[]): number | undefined {
  return candles.length > 0 ? candles[candles.length - 1].close : undefined;
}

/**
 * Velocity = pct change in close over the last `windowMin` candles.
 *   v = (close_now − close_then) / close_then
 * Returns NaN if window is too short or close_then ≤ 0.
 */
export function velocity(candles: Candle[], windowMin: number): number {
  // Defensive: floor windowMin (older genomes have non-integer values, and
  // array indices must be integers — `candles[22.3]` would be undefined).
  const w = Math.floor(windowMin);
  if (candles.length < w + 1 || w < 1) return NaN;
  const nowBar = candles[candles.length - 1];
  const thenBar = candles[candles.length - 1 - w];
  if (!nowBar || !thenBar) return NaN;
  const then = thenBar.close;
  if (!(then > 0)) return NaN;
  return (nowBar.close - then) / then;
}

/**
 * Acceleration = velocity over the most-recent half-window minus velocity
 * over the prior half-window. Positive → momentum is BUILDING; negative →
 * fading. Caller supplies the full window; we split it down the middle.
 */
export function acceleration(candles: Candle[], windowMin: number): number {
  const w = Math.floor(windowMin);
  const half = Math.max(1, Math.floor(w / 2));
  if (candles.length < w + 1 || w < 2) return NaN;
  // Two adjacent half-windows ending at the most-recent candle.
  const tail = candles.slice(-1 - half);     // last (half + 1) candles
  const head = candles.slice(-1 - w, -half); // first half within the window
  const vTail = pctChange(head[head.length - 1]?.close, tail[tail.length - 1]?.close);
  const vHead = pctChange(head[0]?.close, head[head.length - 1]?.close);
  if (!Number.isFinite(vTail) || !Number.isFinite(vHead)) return NaN;
  return vTail - vHead;
}

function pctChange(then: number | undefined, now: number | undefined): number {
  if (then == null || now == null || !(then > 0)) return NaN;
  return (now - then) / then;
}

/**
 * z-score of current velocity vs the rolling distribution of K-window
 * velocities over the supplied candles. Useful to ask "is this move big
 * relative to recent moves?" rather than a fixed absolute threshold.
 */
export function zVelocity(candles: Candle[], windowMin: number): number {
  if (candles.length < windowMin * 2 + 2) return NaN;
  // Build a series of velocities at each step in the back-window.
  const vs: number[] = [];
  for (let i = windowMin; i < candles.length; i++) {
    const then = candles[i - windowMin].close;
    const now = candles[i].close;
    if (then > 0) vs.push((now - then) / then);
  }
  if (vs.length < 3) return NaN;
  const v = vs[vs.length - 1];
  const mean = vs.reduce((s, x) => s + x, 0) / vs.length;
  const variance = vs.reduce((s, x) => s + (x - mean) ** 2, 0) / (vs.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return NaN;
  return (v - mean) / sd;
}

/** Composite score combining velocity sign + acceleration sign. Bounded [-2, 2]. */
export function momentumScore(candles: Candle[], windowMin = 5): number {
  const v = velocity(candles, windowMin);
  const a = acceleration(candles, windowMin);
  if (!Number.isFinite(v) || !Number.isFinite(a)) return 0;
  const vSign = Math.sign(v) * Math.min(1, Math.abs(v) / 0.01); // |v|=1% → ±1
  const aSign = Math.sign(a) * Math.min(1, Math.abs(a) / 0.005); // |a|=0.5pp → ±1
  return vSign + aSign;
}

// ---------------------------------------------------------------------------
// Binary search helpers — used by the preloaded-candles fast-path. The
// preloaded arrays are sorted ASC by start_unix at load time, so we can
// O(log N) the bounds instead of O(N) filter every tick.

function lowerBound(arr: Candle[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].start_unix < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr: Candle[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].start_unix <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
