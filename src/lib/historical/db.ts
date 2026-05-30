/**
 * Historical-data DB client.
 *
 * Separate SQLite file at `data/historical-candles.db` — append-only,
 * write-once-read-many. Decoupled from the main app DB so:
 *   1. Backfill never contends with the live arena worker (no SQLITE_BUSY)
 *   2. Backtests can pre-load this DB into memory without holding locks
 *   3. The file is portable — copy to a new dev box and skip the 7-hour backfill
 *
 * Path is relative to process.cwd() (the repo root in dev, the deploy dir in
 * prod). Created on first open. The historical DB is opened READ-ONLY by
 * default; the backfill script opens read-write via openHistoricalDbRW().
 */
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor to repo root via this file's location — process.cwd() is unreliable
// across npm-workspace contexts (apps/web/ vs root).
const __thisFile = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__thisFile), "..", "..", "..");
export const HISTORICAL_DB_PATH = resolve(REPO_ROOT, "data/historical-candles.db");

let _rw: Database.Database | null = null;
let _ro: Database.Database | null = null;

function ensureDir(): void {
  const dir = dirname(HISTORICAL_DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Open the historical DB read-write. Used by the backfill script only.
 * Idempotent — second call returns the same handle.
 */
export function openHistoricalDbRW(): Database.Database {
  if (_rw) return _rw;
  ensureDir();
  const db = new Database(HISTORICAL_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");      // tradeoff: faster writes, slightly weaker fsync
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  _rw = db;
  return db;
}

/**
 * Open the historical DB read-only. Used by backtest readers.
 *
 * Returns null when the DB doesn't exist yet (no backfill run) so callers
 * can fall back to the main app's coinbase_candles table.
 */
export function openHistoricalDbRO(): Database.Database | null {
  if (_ro) return _ro;
  if (!existsSync(HISTORICAL_DB_PATH)) return null;
  ensureDir();
  const db = new Database(HISTORICAL_DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 1000");
  _ro = db;
  return db;
}

export function closeHistoricalDb(): void {
  _rw?.close(); _rw = null;
  _ro?.close(); _ro = null;
}

const SCHEMA = `
-- Historical 1-min candles per (asset, granularity, start_ts_unix).
-- Coinbase + OKX use seconds-since-epoch for candle start; we store the same.
-- Append-only. INSERT OR IGNORE on the unique key makes backfill resumable.
CREATE TABLE IF NOT EXISTS historical_candles (
  asset           TEXT    NOT NULL,    -- 'BTC-USD' | 'ETH-USD' | 'SOL-USD' | 'XRP-USD' | 'DOGE-USD'
  granularity_sec INTEGER NOT NULL,    -- 60 (1m) | 300 (5m) | 900 (15m) | etc.
  start_ts_unix   INTEGER NOT NULL,    -- candle start in epoch seconds, UTC
  open            REAL    NOT NULL,
  high            REAL    NOT NULL,
  low             REAL    NOT NULL,
  close           REAL    NOT NULL,
  volume          REAL    NOT NULL,
  source          TEXT    NOT NULL DEFAULT 'coinbase',  -- 'coinbase' | 'okx' | 'coindesk'
  PRIMARY KEY (asset, granularity_sec, start_ts_unix)
) WITHOUT ROWID;

-- Per-asset backfill cursor: tracks the earliest + latest ts seen so the
-- script can resume from where it left off and the UI can show coverage.
CREATE TABLE IF NOT EXISTS historical_meta (
  asset             TEXT    NOT NULL,
  granularity_sec   INTEGER NOT NULL,
  earliest_ts_unix  INTEGER,
  latest_ts_unix    INTEGER,
  candles_total     INTEGER NOT NULL DEFAULT 0,
  last_backfill_at  TEXT,
  PRIMARY KEY (asset, granularity_sec)
);

-- Polymarket settled-binary archive: outcomes for every closed 5M/15M binary.
-- Powers the backtest oracle ("did this strategy's prediction win?").
CREATE TABLE IF NOT EXISTS poly_binaries_settled_history (
  condition_id     TEXT PRIMARY KEY,
  question         TEXT NOT NULL,
  asset            TEXT,                                 -- BTC | ETH | etc.
  duration_kind    TEXT,                                 -- '5M' | '15M' | etc.
  start_ts_unix    INTEGER NOT NULL,
  expiry_ts_unix   INTEGER NOT NULL,
  up_token_id      TEXT NOT NULL,
  down_token_id    TEXT,
  winner           TEXT NOT NULL,                        -- 'UP' | 'DOWN' | 'INVALID'
  settlement_spot  REAL,                                 -- spot price at expiry (if known)
  source           TEXT NOT NULL DEFAULT 'gamma',
  scraped_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_poly_settled_asset_expiry ON poly_binaries_settled_history(asset, expiry_ts_unix);
CREATE INDEX IF NOT EXISTS idx_poly_settled_expiry ON poly_binaries_settled_history(expiry_ts_unix);
`;

function applySchema(db: Database.Database): void {
  db.exec(SCHEMA);
}

// ---------------------------------------------------------------------------
// Insert helpers (used by backfill scripts)

export type HistoricalCandleInsert = {
  asset: string;
  granularity_sec: number;
  start_ts_unix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
};

let _insertStmt: Database.Statement | null = null;

/**
 * Bulk-insert candles in a transaction. Idempotent — INSERT OR IGNORE means
 * re-running the backfill over an already-fetched range silently skips dupes.
 * Returns the number of NEW rows inserted (not the count of input rows).
 */
export function insertCandles(rows: HistoricalCandleInsert[]): number {
  if (rows.length === 0) return 0;
  const db = openHistoricalDbRW();
  if (!_insertStmt) {
    _insertStmt = db.prepare(
      `INSERT OR IGNORE INTO historical_candles
         (asset, granularity_sec, start_ts_unix, open, high, low, close, volume, source)
       VALUES (@asset, @granularity_sec, @start_ts_unix, @open, @high, @low, @close, @volume, @source)`,
    );
  }
  const stmt = _insertStmt;
  let inserted = 0;
  const tx = db.transaction((batch: HistoricalCandleInsert[]) => {
    for (const r of batch) {
      const res = stmt.run({ ...r, source: r.source ?? "coinbase" });
      if (res.changes > 0) inserted++;
    }
  });
  tx(rows);
  return inserted;
}

export function upsertMeta(asset: string, granularitySec: number): void {
  const db = openHistoricalDbRW();
  const stats = db
    .prepare(
      `SELECT MIN(start_ts_unix) AS earliest, MAX(start_ts_unix) AS latest, COUNT(*) AS n
         FROM historical_candles
        WHERE asset = ? AND granularity_sec = ?`,
    )
    .get(asset, granularitySec) as { earliest: number | null; latest: number | null; n: number };
  db.prepare(
    `INSERT INTO historical_meta (asset, granularity_sec, earliest_ts_unix, latest_ts_unix, candles_total, last_backfill_at)
     VALUES (@asset, @granularity_sec, @earliest, @latest, @n, datetime('now'))
     ON CONFLICT(asset, granularity_sec) DO UPDATE SET
       earliest_ts_unix = excluded.earliest_ts_unix,
       latest_ts_unix   = excluded.latest_ts_unix,
       candles_total    = excluded.candles_total,
       last_backfill_at = excluded.last_backfill_at`,
  ).run({ asset, granularity_sec: granularitySec, earliest: stats.earliest, latest: stats.latest, n: stats.n });
}

// ---------------------------------------------------------------------------
// Read helpers (used by training/backtest)

export type Candle = {
  start_ts_unix: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Load a contiguous candle range for one asset, sorted ascending by time.
 * Returns [] when no candles exist or the historical DB is missing.
 *
 * Intended use: load once at backtest start, then iterate via index pointer
 * instead of running this per tick.
 */
export function loadCandleRange(
  asset: string,
  granularitySec: number,
  fromTsUnix: number,
  toTsUnix: number,
): Candle[] {
  const db = openHistoricalDbRO();
  if (!db) return [];
  return db
    .prepare(
      `SELECT start_ts_unix, open, high, low, close, volume
         FROM historical_candles
        WHERE asset = ? AND granularity_sec = ?
          AND start_ts_unix >= ? AND start_ts_unix <= ?
        ORDER BY start_ts_unix ASC`,
    )
    .all(asset, granularitySec, fromTsUnix, toTsUnix) as Candle[];
}

export type HistoricalMetaRow = {
  asset: string;
  granularity_sec: number;
  earliest_ts_unix: number | null;
  latest_ts_unix: number | null;
  candles_total: number;
  last_backfill_at: string | null;
};

export function listHistoricalMeta(): HistoricalMetaRow[] {
  const db = openHistoricalDbRO();
  if (!db) return [];
  return db
    .prepare(`SELECT * FROM historical_meta ORDER BY asset, granularity_sec`)
    .all() as HistoricalMetaRow[];
}
