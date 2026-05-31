import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor file-system paths to the workspace ROOT, not process.cwd().
// `npm run -w @polymarket-agents/web` invokes next dev with cwd=apps/web/,
// so anything resolved against cwd ends up at apps/web/src/lib/db/... which
// doesn't exist. This file lives at <root>/src/lib/db/client.ts, so going up
// 3 levels from its dir reaches the workspace root reliably.
const __thisFile = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__thisFile), "..", "..", "..");

const DB_PATH = process.env.POLYMARKET_DB_PATH ?? resolve(REPO_ROOT, "data", "polymarket.db");
const SCHEMA_PATH = resolve(REPO_ROOT, "src", "lib", "db", "schema.sql");

let cached: Database.Database | null = null;

export function db(): Database.Database {
  if (cached) return cached;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const handle = new Database(DB_PATH);
  handle.pragma("journal_mode = WAL");
  handle.pragma("foreign_keys = ON");
  // Wait up to 5s for a write lock instead of erroring with SQLITE_BUSY.
  // The WS worker can burst 30+ writes/sec; without this, a concurrent
  // arena:tick / worker:reconcile / scheduler job will collide and one
  // process dies. WAL mode allows readers + 1 writer; busy_timeout makes
  // the second writer wait its turn. (2026-05-25 worker:realtime crash:
  // 200K writes succeeded, 200,001st lost to BUSY because the tick ran
  // simultaneously.)
  // 2026-05-30: bumped to 30s. arena:tick can hold a write txn for 30s+ when
  // it's iterating 24 elites; with the staged-stake workers also writing
  // (graduate, stake-promoter), 5s wasn't enough headroom on a busy day.
  handle.pragma("busy_timeout = 30000");
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  handle.exec(schema);
  runLightMigrations(handle);
  cached = handle;
  return handle;
}

/**
 * Idempotent runtime migrations for changes that SQLite can't express with
 * `CREATE TABLE IF NOT EXISTS` (which silently keeps the old shape on
 * existing DBs). Each step checks `pragma_table_info` first so it's safe to
 * run on every startup.
 */
function runLightMigrations(handle: Database.Database): void {
  const hasColumn = (table: string, col: string): boolean => {
    const row = handle.prepare(
      `SELECT 1 FROM pragma_table_info(?) WHERE name = ?`,
    ).get(table, col);
    return !!row;
  };
  // 2026-05-26: extend cross_venue_arbs for Kalshi sister-venue pairings.
  // ADD COLUMN is conditional; the index is created unconditionally because
  // IF NOT EXISTS makes it idempotent on fresh DBs (where the column came in
  // via schema.sql) and old DBs (where we just added it via ALTER TABLE).
  if (!hasColumn("cross_venue_arbs", "kalshi_ticker")) {
    handle.exec(`ALTER TABLE cross_venue_arbs ADD COLUMN kalshi_ticker TEXT;`);
  }
  handle.exec(
    `CREATE INDEX IF NOT EXISTS idx_cross_venue_kalshi
       ON cross_venue_arbs(kalshi_ticker) WHERE kalshi_ticker IS NOT NULL;`,
  );

  // 2026-05-26: elite preservation. ALTER first (column may be missing on
  // pre-existing DBs), then create the index — schema.sql can't safely create
  // the index because it would fail on old DBs before the ALTER runs.
  if (!hasColumn("paper_agents", "is_elite")) {
    handle.exec(`ALTER TABLE paper_agents ADD COLUMN is_elite INTEGER NOT NULL DEFAULT 0;`);
  }
  handle.exec(
    `CREATE INDEX IF NOT EXISTS idx_paper_agents_elite ON paper_agents(is_elite, alive);`,
  );

  // 2026-05-26: poly_binaries.event_slug for embedding the official
  // Polymarket iframe on /binaries (https://embed.polymarket.com/market?market=<slug>).
  if (!hasColumn("poly_binaries", "event_slug")) {
    handle.exec(`ALTER TABLE poly_binaries ADD COLUMN event_slug TEXT;`);
  }

  // 2026-05-26: drop the FK constraints on order_events.agent_id/capsule_id.
  // The schema's intent is "deliberately NO foreign keys" so a rejection log
  // entry can be written even when the referenced row is missing (e.g. paper
  // agents have id-space separate from `agents` table). Older DBs were
  // created with FKs in place; rebuild the table without them, preserving
  // all existing rows.
  const orderEventsFks = handle.prepare(`PRAGMA foreign_key_list(order_events)`).all() as Array<{ from: string }>;
  if (orderEventsFks.length > 0) {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS order_events_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        seq             INTEGER NOT NULL UNIQUE,
        event           TEXT NOT NULL,
        venue           TEXT NOT NULL,
        client_order_id TEXT NOT NULL,
        broker_order_id TEXT,
        capsule_id      TEXT,
        agent_id        INTEGER,
        symbol          TEXT,
        side            TEXT,
        qty             REAL,
        price           REAL,
        status          TEXT,
        error           TEXT,
        metadata_json   TEXT NOT NULL DEFAULT '{}',
        prev_hash       TEXT NOT NULL DEFAULT '',
        hash            TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO order_events_new SELECT * FROM order_events;
      DROP TABLE order_events;
      ALTER TABLE order_events_new RENAME TO order_events;
      CREATE INDEX IF NOT EXISTS idx_order_events_coid ON order_events(client_order_id);
      CREATE INDEX IF NOT EXISTS idx_order_events_venue_seq ON order_events(venue, seq);
      CREATE INDEX IF NOT EXISTS idx_order_events_created ON order_events(created_at DESC);
    `);
  }

  // 2026-05-27 (Phase 6): capsule diversity profile columns. Additive, all
  // nullable — existing capsules continue to work without these populated.
  // Populated by scripts/infer-capsule-diversity.ts post-migration.
  for (const [col, ddl] of [
    ["strategy_family",        "strategy_family TEXT"],
    ["asset_class",            "asset_class TEXT"],
    ["allowed_assets_json",    "allowed_assets_json TEXT"],
    ["time_horizon",           "time_horizon TEXT"],
    ["regime_dependency",      "regime_dependency TEXT"],
    ["directional_bias",       "directional_bias TEXT"],
    ["diversity_profile_json", "diversity_profile_json TEXT"],
    ["diversity_confidence",   "diversity_confidence TEXT NOT NULL DEFAULT 'inferred'"],
  ] as const) {
    if (!hasColumn("capsules", col)) {
      handle.exec(`ALTER TABLE capsules ADD COLUMN ${ddl};`);
    }
  }
  handle.exec(
    `CREATE INDEX IF NOT EXISTS idx_capsules_strategy_family ON capsules(strategy_family) WHERE strategy_family IS NOT NULL;`,
  );
  handle.exec(
    `CREATE INDEX IF NOT EXISTS idx_capsules_asset_class ON capsules(asset_class) WHERE asset_class IS NOT NULL;`,
  );

  // 2026-05-30: Twitter-article triage workbench (incoming_articles +
  // article_gap_reports + article_todos). Workflow:
  //   1. Operator pastes a twitter thread → row in incoming_articles.
  //   2. /articles/[id] page renders body. Operator clicks "Generate gap
  //      report" → LLM call writes article_gap_reports row.
  //   3. Gap report's suggested_next_steps seed article_todos rows that the
  //      operator ticks off as work lands. Only one article is `is_current_focus`
  //      at a time (enforced in queries, not via UNIQUE — we want toggling to
  //      be a single UPDATE, not a transaction).
  handle.exec(`
    CREATE TABLE IF NOT EXISTS incoming_articles (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      source            TEXT NOT NULL,
      url               TEXT,
      title             TEXT NOT NULL,
      body_md           TEXT NOT NULL,
      frontmatter_json  TEXT NOT NULL DEFAULT '{}',
      status            TEXT NOT NULL DEFAULT 'new'
                          CHECK(status IN ('new','triaging','developing','shipped','parked')),
      is_current_focus  INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_articles_status ON incoming_articles(status);
    CREATE INDEX IF NOT EXISTS idx_articles_focus ON incoming_articles(is_current_focus) WHERE is_current_focus = 1;

    CREATE TABLE IF NOT EXISTS article_gap_reports (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id    INTEGER NOT NULL REFERENCES incoming_articles(id) ON DELETE CASCADE,
      body_md       TEXT NOT NULL,
      report_json   TEXT NOT NULL DEFAULT '{}',
      model         TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'llm'
                      CHECK(source IN ('llm','human','seed')),
      generated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_gap_reports_article ON article_gap_reports(article_id, generated_at DESC);

    CREATE TABLE IF NOT EXISTS article_todos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id    INTEGER NOT NULL REFERENCES incoming_articles(id) ON DELETE CASCADE,
      label         TEXT NOT NULL,
      related_path  TEXT,
      status        TEXT NOT NULL DEFAULT 'open'
                      CHECK(status IN ('open','in_progress','done','wont_do')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_article ON article_todos(article_id, status);

    -- 2026-05-30: cross-link from strategies (or arbitrary code modules) back
    -- to the article(s) they were inspired by. Composite PK lets one strategy
    -- cite multiple articles (e.g., a fair-value Markov scanner blends ideas
    -- from Ricker + Alex). The role column distinguishes primary inspiration
    -- from supporting references. The module_path column is a fallback for
    -- tracking non-strategy artifacts (e.g., a quant module like
    -- becker-calibration.ts that's used across strategies — strategy_id can
    -- be NULL in that case).
    CREATE TABLE IF NOT EXISTS strategy_article_sources (
      strategy_id   INTEGER REFERENCES strategies(id) ON DELETE CASCADE,
      module_path   TEXT,
      article_id    INTEGER NOT NULL REFERENCES incoming_articles(id) ON DELETE CASCADE,
      role          TEXT NOT NULL DEFAULT 'primary'
                      CHECK(role IN ('primary','supporting','calibration','execution')),
      notes         TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (strategy_id IS NOT NULL OR module_path IS NOT NULL)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sas_unique
      ON strategy_article_sources(
        COALESCE(strategy_id, -1),
        COALESCE(module_path, ''),
        article_id,
        role
      );
    CREATE INDEX IF NOT EXISTS idx_sas_article ON strategy_article_sources(article_id);
    CREATE INDEX IF NOT EXISTS idx_sas_strategy ON strategy_article_sources(strategy_id) WHERE strategy_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_sas_module ON strategy_article_sources(module_path) WHERE module_path IS NOT NULL;
  `);
}

export function closeDb() {
  if (cached) {
    cached.close();
    cached = null;
  }
}
