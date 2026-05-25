import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.POLYMARKET_DB_PATH ?? resolve(process.cwd(), "data", "polymarket.db");

let cached: Database.Database | null = null;

export function db(): Database.Database {
  if (cached) return cached;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const handle = new Database(DB_PATH);
  handle.pragma("journal_mode = WAL");
  handle.pragma("foreign_keys = ON");
  const schema = readFileSync(resolve(process.cwd(), "src/lib/db/schema.sql"), "utf8");
  handle.exec(schema);
  cached = handle;
  return handle;
}

export function closeDb() {
  if (cached) {
    cached.close();
    cached = null;
  }
}
