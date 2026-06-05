/**
 * Decide-time lookup helpers for the `book_snapshots` table.
 *
 * Strategies that consume order-flow imbalance (Cont-Kukanov-Stoikov OFI)
 * call into here at the moment they want to evaluate a signal. The
 * lookup returns the freshest snapshot plus a small rolling window — the
 * OFI calculator then walks the window event-by-event.
 *
 * Hot-path discipline:
 *   - No JSON parsing (raw columns, prepared statement).
 *   - Prepared statements cached on the connection.
 *   - Returns plain rows; no allocation per query beyond the result array.
 *
 * Companion to `src/lib/quant/ofi.ts` (the calculator). Consumers wire
 * the two together — fetch a window, replay through OFI, get a scalar
 * imbalance value for the gate.
 */
import { db } from "@/lib/db/client";

/** One row from book_snapshots. ts_unix_ms is integer ms since epoch. */
export type BookSnapshot = {
  token_id: string;
  ts_unix_ms: number;
  bid_price: number | null;
  bid_size: number | null;
  ask_price: number | null;
  ask_size: number | null;
  midpoint: number | null;
  spread: number | null;
  total_bid_depth: number | null;
  total_ask_depth: number | null;
  n_bid_levels: number | null;
  n_ask_levels: number | null;
};

/** Persist one book snapshot. Used by the worker — kept here so the
 *  table's columns and the insert statement co-evolve in one file. */
export function recordBookSnapshot(s: BookSnapshot): void {
  db().prepare(`
    INSERT INTO book_snapshots
      (token_id, ts_unix_ms, bid_price, bid_size, ask_price, ask_size,
       midpoint, spread, total_bid_depth, total_ask_depth,
       n_bid_levels, n_ask_levels)
    VALUES (@token_id, @ts_unix_ms, @bid_price, @bid_size, @ask_price, @ask_size,
            @midpoint, @spread, @total_bid_depth, @total_ask_depth,
            @n_bid_levels, @n_ask_levels)
  `).run(s);
}

/**
 * Get the most recent snapshot for a token. Returns null when there is
 * no row, or when the freshest row is older than `maxAgeMs` (defaults
 * to 5 s — the OFI gate refuses to act on stale level-1 data).
 */
export function getFreshestBookSnapshot(
  tokenId: string,
  maxAgeMs = 5_000,
  nowMs: number = Date.now(),
): BookSnapshot | null {
  const row = db().prepare(`
    SELECT * FROM book_snapshots
     WHERE token_id = ?
     ORDER BY ts_unix_ms DESC
     LIMIT 1
  `).get(tokenId) as BookSnapshot | undefined;
  if (!row) return null;
  if (nowMs - row.ts_unix_ms > maxAgeMs) return null;
  return row;
}

/**
 * Pull the rolling window used by the OFI calculator — every snapshot
 * for `tokenId` newer than (nowMs - windowMs), in chronological order.
 */
export function getBookWindow(
  tokenId: string,
  windowMs = 30_000,
  nowMs: number = Date.now(),
): BookSnapshot[] {
  const cutoff = nowMs - windowMs;
  return db().prepare(`
    SELECT * FROM book_snapshots
     WHERE token_id = ?
       AND ts_unix_ms >= ?
     ORDER BY ts_unix_ms ASC
  `).all(tokenId, cutoff) as BookSnapshot[];
}

/**
 * Parse a CLOB /book response into the columns the snapshot table
 * stores. The CLOB returns bids/asks as arrays of `{price, size}` rows;
 * we keep the top of book plus rolled-up depth so consumers don't need
 * the full ladder.
 *
 * Defensive: tolerates missing/empty sides (markets just listed often
 * have only one side quoted for a few seconds).
 */
export function parseClobBook(book: unknown, tokenId: string, tsUnixMs: number): BookSnapshot {
  const b = (book ?? {}) as { bids?: Array<{ price?: string | number; size?: string | number }>;
                              asks?: Array<{ price?: string | number; size?: string | number }> };
  const bids = Array.isArray(b.bids) ? b.bids : [];
  const asks = Array.isArray(b.asks) ? b.asks : [];

  // CLOB returns bids sorted descending by price (best first), asks
  // ascending. Tolerate either order via min/max if needed.
  const sortedBids = [...bids].map((r) => ({ price: Number(r.price), size: Number(r.size) }))
                              .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.size) && r.size > 0)
                              .sort((a, b) => b.price - a.price);
  const sortedAsks = [...asks].map((r) => ({ price: Number(r.price), size: Number(r.size) }))
                              .filter((r) => Number.isFinite(r.price) && Number.isFinite(r.size) && r.size > 0)
                              .sort((a, b) => a.price - b.price);

  const bidPx = sortedBids[0]?.price ?? null;
  const bidSz = sortedBids[0]?.size ?? null;
  const askPx = sortedAsks[0]?.price ?? null;
  const askSz = sortedAsks[0]?.size ?? null;
  const midpoint = bidPx !== null && askPx !== null ? (bidPx + askPx) / 2 : null;
  const spread = bidPx !== null && askPx !== null ? askPx - bidPx : null;
  const totalBidDepth = sortedBids.reduce((acc, r) => acc + r.size, 0) || null;
  const totalAskDepth = sortedAsks.reduce((acc, r) => acc + r.size, 0) || null;

  return {
    token_id: tokenId,
    ts_unix_ms: tsUnixMs,
    bid_price: bidPx,
    bid_size: bidSz,
    ask_price: askPx,
    ask_size: askSz,
    midpoint,
    spread,
    total_bid_depth: totalBidDepth,
    total_ask_depth: totalAskDepth,
    n_bid_levels: sortedBids.length,
    n_ask_levels: sortedAsks.length,
  };
}

/**
 * Bridge from BookSnapshot rows to `runOfiOverHistory` — pulls the
 * rolling window, drops snapshots missing either side (OFI needs both
 * bid and ask), converts to TopOfBookSample, and runs the calculator.
 *
 * Returns 0 when there aren't enough usable snapshots — this is the
 * "OFI says nothing, hold" path. Strategies should treat 0 as
 * unactionable rather than bearish/bullish.
 */
import { runOfiOverHistory, type TopOfBookSample } from "@/lib/quant/ofi";

export function computeOfiFromBookWindow(
  tokenId: string,
  opts: { windowMs?: number; ofiWindowSec?: number; nowMs?: number } = {},
): { ofi: number; samplesUsed: number; samplesAvailable: number } {
  const windowMs = opts.windowMs ?? 30_000;
  const ofiWindowSec = opts.ofiWindowSec ?? 1.0;
  const window = getBookWindow(tokenId, windowMs, opts.nowMs);
  const samples: TopOfBookSample[] = [];
  for (const r of window) {
    if (r.bid_price === null || r.bid_size === null) continue;
    if (r.ask_price === null || r.ask_size === null) continue;
    samples.push({
      ts: r.ts_unix_ms / 1000,  // OFI calculator takes seconds
      bidPx: r.bid_price,
      bidSz: r.bid_size,
      askPx: r.ask_price,
      askSz: r.ask_size,
    });
  }
  return {
    ofi: runOfiOverHistory(samples, ofiWindowSec),
    samplesUsed: samples.length,
    samplesAvailable: window.length,
  };
}

/** Prune snapshots older than `keepHours`. Used by the worker on a
 *  ~hourly cadence so the hot table stays small. */
export function pruneOldBookSnapshots(keepHours = 24): number {
  const r = db().prepare(`
    DELETE FROM book_snapshots
     WHERE ts_unix_ms < (CAST(strftime('%s','now') AS INTEGER) - ?) * 1000
  `).run(keepHours * 3600);
  return r.changes;
}
