-- Local SQLite store for the Polymarket agent workspace.
-- Tables are evolved with `CREATE TABLE IF NOT EXISTS` so init is idempotent.

CREATE TABLE IF NOT EXISTS agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  charter         TEXT NOT NULL,                       -- the agent's purpose / mandate
  risk_budget_usd REAL NOT NULL DEFAULT 100.0,
  status          TEXT NOT NULL DEFAULT 'active',      -- active | paused | retired
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS strategies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  thesis          TEXT NOT NULL,
  market_filter   TEXT NOT NULL,                       -- JSON: tags, categories, time horizon
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(agent_id, slug)
);

-- Versioned strategy specs so the evolution loop can iterate.
CREATE TABLE IF NOT EXISTS strategy_versions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_id          INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  parent_version_id    INTEGER REFERENCES strategy_versions(id),
  version              INTEGER NOT NULL,
  spec_json            TEXT NOT NULL,                  -- params: entry/exit rules, sizing
  rationale            TEXT NOT NULL,                  -- why this version supersedes the parent
  introduced_by        TEXT NOT NULL DEFAULT 'human',  -- human | agent:<slug> | research-loop
  backtest_summary     TEXT,                           -- JSON of perf metrics
  is_current           INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_id, version)
);

-- Trades the app has either observed or executed for a given strategy.
CREATE TABLE IF NOT EXISTS trades (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_version_id  INTEGER NOT NULL REFERENCES strategy_versions(id) ON DELETE CASCADE,
  market_condition_id  TEXT NOT NULL,
  token_id             TEXT NOT NULL,
  side                 TEXT NOT NULL,                  -- BUY | SELL
  price                REAL NOT NULL,
  size                 REAL NOT NULL,
  intent               TEXT NOT NULL,                  -- entry | exit | hedge | rebalance
  status               TEXT NOT NULL DEFAULT 'planned',-- planned | submitted | filled | rejected | cancelled
  order_id             TEXT,
  tx_hash              TEXT,
  pnl_usd              REAL,
  notes                TEXT,
  opened_at            TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at            TEXT
);

-- Free-form research notes attached to a market and/or strategy.
CREATE TABLE IF NOT EXISTS research_notes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id             INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  strategy_id          INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
  market_condition_id  TEXT,
  topic                TEXT NOT NULL,
  body                 TEXT NOT NULL,                  -- markdown
  source_urls_json     TEXT NOT NULL DEFAULT '[]',
  confidence           REAL NOT NULL DEFAULT 0.5,      -- 0..1
  tags_json            TEXT NOT NULL DEFAULT '[]',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Snapshots of markets the agents watch — fuels back-testing + dashboards.
CREATE TABLE IF NOT EXISTS market_snapshots (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  condition_id         TEXT NOT NULL,
  token_id             TEXT NOT NULL,
  question             TEXT NOT NULL,
  yes_price            REAL,
  no_price             REAL,
  midpoint             REAL,
  spread               REAL,
  volume_24h           REAL,
  open_interest        REAL,
  liquidity_usd        REAL,
  captured_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snap_token_time ON market_snapshots(token_id, captured_at DESC);

-- Performance summary per strategy_version, recomputed by the research loop.
CREATE TABLE IF NOT EXISTS performance_metrics (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy_version_id  INTEGER NOT NULL REFERENCES strategy_versions(id) ON DELETE CASCADE,
  window               TEXT NOT NULL,                  -- 1d | 7d | 30d | all
  trades_count         INTEGER NOT NULL,
  win_rate             REAL,
  total_pnl_usd        REAL,
  sharpe               REAL,
  max_drawdown_usd     REAL,
  computed_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(strategy_version_id, window)
);

-- Append-only log of every evolution event the system records.
CREATE TABLE IF NOT EXISTS evolution_log (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id             INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  strategy_id          INTEGER REFERENCES strategies(id) ON DELETE SET NULL,
  from_version_id      INTEGER REFERENCES strategy_versions(id),
  to_version_id        INTEGER REFERENCES strategy_versions(id),
  event_type           TEXT NOT NULL,                  -- proposal | promotion | retirement | scoring
  summary              TEXT NOT NULL,
  payload_json         TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
