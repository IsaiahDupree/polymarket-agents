/**
 * Test DB helper — spin up a fresh in-memory SQLite per test, apply the schema,
 * and yield queries/client wired to it.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCHEMA = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8");

function ensureColumn(d: Database.Database, table: string, column: string, ddlFragment: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${ddlFragment}`);
}

export function makeMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  // Mirror the migrations applied by scripts/init-db.ts so tests use the same shape as prod.
  ensureColumn(db, "strategy_versions", "stage", "stage TEXT NOT NULL DEFAULT 'sim'");
  ensureColumn(db, "paper_generations", "tick_count", "tick_count INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "capsules", "paper_agent_id", "paper_agent_id INTEGER REFERENCES paper_agents(id)");
  ensureColumn(db, "paper_agents", "entries_count", "entries_count INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "market_snapshots", "category", "category TEXT");
  // Also create the tracked_wallets + wallet_fills tables that live outside the main schema file
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT UNIQUE NOT NULL,
      proxy_wallet TEXT,
      note TEXT,
      claimed_profit_usd REAL,
      strategy_label TEXT,
      last_resolved TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wallet_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL,
      side_of_wallet TEXT NOT NULL,
      exchange TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      order_hash TEXT NOT NULL,
      maker_address TEXT NOT NULL,
      taker_address TEXT NOT NULL,
      maker_side TEXT NOT NULL,
      token_id TEXT NOT NULL,
      maker_amount TEXT NOT NULL,
      taker_amount TEXT NOT NULL,
      fee TEXT NOT NULL,
      builder TEXT,
      implied_price REAL,
      implied_shares REAL,
      implied_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tx_hash, order_hash)
    );
  `);
  return db;
}
