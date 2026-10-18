#!/usr/bin/env tsx
/**
 * Mirror api_call_cache + book_snapshots from the laptop SQLite (data/)
 * to the WD MyPassport external drive on a rolling basis. Two concerns
 * the mirror solves:
 *
 *   1. Laptop SSD won't fill — the cache grew 64K rows in 5 days
 *      (~50 / minute); over a year that's ~26 M rows / ~10 GB of bodies.
 *      Mirroring lets us prune the local copy aggressively while keeping
 *      the full archive on the external.
 *   2. Backup — the laptop SSD is single point of failure; the external
 *      is offline-cold so it survives a host compromise.
 *
 * The mirror is idempotent: each row's `id` is the source of truth, the
 * destination DB has the same schema, and we only INSERT rows whose ids
 * are newer than the max id already mirrored. Tables that don't exist
 * on the destination are created from the source's CREATE TABLE.
 *
 *   npm run mirror:cache                          # one-shot, all tables
 *   npm run mirror:cache -- --once
 *   npm run mirror:cache:loop                     # cron-style, hourly
 *   npm run mirror:cache -- --table api_call_cache
 *
 * Output: data/polymarket.db  →  E:\Coding\datasets\polymarket-archive.db
 */
import "./_env.ts";
import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SRC_PATH = resolve(process.env.POLYMARKET_DB_PATH ?? "data/polymarket.db");
const DST_PATH = resolve(
  process.env.MIRROR_DST_PATH ?? "E:/Coding/datasets/polymarket-archive.db",
);
const TABLES = (process.env.MIRROR_TABLES ?? "api_call_cache,book_snapshots,overfit_verdicts,evolution_log,poly_binaries").split(",").map((s) => s.trim());
const LOOP_INTERVAL_MIN = Number(process.env.MIRROR_INTERVAL_MIN ?? "60");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const runOnce = process.argv.includes("--once") || !process.argv.includes("--loop");
const onlyTable = arg("table");

function ensureSchema(src: Database.Database, dst: Database.Database, table: string): boolean {
  const ddl = src.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
  ).get(table) as { sql?: string } | undefined;
  if (!ddl?.sql) {
    console.warn(`[mirror] source table ${table} not found — skipping`);
    return false;
  }
  try {
    dst.exec(`${ddl.sql};`);
  } catch (e) {
    // The destination might already have the table — IF NOT EXISTS is
    // usually in the DDL but some legacy CREATEs omit it. Tolerate.
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("already exists")) {
      console.warn(`[mirror] failed to create ${table} on dst: ${msg.slice(0, 120)}`);
      return false;
    }
  }
  // Re-create indices on the destination too.
  const indices = src.prepare(
    `SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL`,
  ).all(table) as Array<{ sql: string }>;
  for (const ix of indices) {
    try { dst.exec(`${ix.sql};`); }
    catch { /* index may already exist; ignore */ }
  }
  return true;
}

function copyTable(src: Database.Database, dst: Database.Database, table: string): { copied: number; took_ms: number } {
  const t0 = Date.now();
  // Skip when source has no `id` column (we rely on it for resumable copies).
  const cols = src.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "id")) {
    console.warn(`[mirror] ${table} has no 'id' column — skipping (mirror requires monotonic key)`);
    return { copied: 0, took_ms: Date.now() - t0 };
  }
  const max = (dst.prepare(`SELECT COALESCE(MAX(id),0) AS m FROM ${table}`).get() as { m: number }).m;
  const colList = cols.map((c) => c.name).join(",");
  const placeholders = cols.map(() => "?").join(",");
  const ins = dst.prepare(`INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${placeholders})`);
  // Stream new rows in batches to avoid loading the whole table into RAM.
  const BATCH = 5000;
  let copied = 0;
  let lastId = max;
  while (true) {
    const rows = src.prepare(`SELECT ${colList} FROM ${table} WHERE id > ? ORDER BY id ASC LIMIT ?`).all(lastId, BATCH) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    const tx = dst.transaction((batch: typeof rows) => {
      for (const r of batch) ins.run(...cols.map((c) => r[c.name]));
    });
    tx(rows);
    copied += rows.length;
    lastId = rows[rows.length - 1].id as number;
    if (rows.length < BATCH) break;
  }
  return { copied, took_ms: Date.now() - t0 };
}

async function pass(): Promise<void> {
  if (!existsSync(SRC_PATH)) {
    console.error(`[mirror] source DB not found: ${SRC_PATH}`);
    return;
  }
  mkdirSync(dirname(DST_PATH), { recursive: true });
  const src = new Database(SRC_PATH, { readonly: true });
  src.pragma("journal_mode = WAL");
  const dst = new Database(DST_PATH);
  dst.pragma("journal_mode = WAL");
  dst.pragma("synchronous = NORMAL");
  // Destination is a partial archive — we copy specific tables in
  // isolation, so foreign-key constraints to tables we didn't include
  // (e.g. poly_binaries has a column that references strategy_versions)
  // would fail at INSERT. Disable FK enforcement on the destination only;
  // the source is read-only so its FKs are irrelevant here.
  dst.pragma("foreign_keys = OFF");
  const tables = onlyTable ? [onlyTable] : TABLES;
  const summary: Array<{ table: string; copied: number; ms: number }> = [];
  try {
    for (const t of tables) {
      const ok = ensureSchema(src, dst, t);
      if (!ok) continue;
      try {
        const r = copyTable(src, dst, t);
        summary.push({ table: t, copied: r.copied, ms: r.took_ms });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[mirror] failed to copy ${t}: ${msg.slice(0, 200)}`);
        summary.push({ table: t, copied: 0, ms: 0 });
      }
    }
  } finally {
    src.close();
    dst.close();
  }
  console.log(`[mirror] ${new Date().toISOString()}`);
  for (const s of summary) {
    console.log(`  ${s.table.padEnd(20)} +${s.copied.toString().padStart(8)} rows  ${s.ms}ms`);
  }
}

if (runOnce) {
  await pass();
} else {
  console.log(`[mirror] starting loop interval=${LOOP_INTERVAL_MIN}min src=${SRC_PATH} dst=${DST_PATH}`);
  while (true) {
    try { await pass(); }
    catch (e) { console.error(`[mirror] pass failed: ${e instanceof Error ? e.message : String(e)}`); }
    await new Promise((r) => setTimeout(r, LOOP_INTERVAL_MIN * 60_000));
  }
}
