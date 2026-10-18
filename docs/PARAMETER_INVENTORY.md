# Parameter Inventory

Generated 2026-06-05 from `grep process.env.* src/ scripts/ apps/ packages/` (186 unique env vars).

This is the operator's tuning surface. Every knob you can turn from `.env`
without editing TypeScript. Grouped by what they affect; values shown are
**defaults** from the code, not necessarily what's running in your `.env`.

> ⚠ The `*_KEY`, `*_SECRET`, `*_PRIVATE_KEY` vars carry credentials.
> They live in `.env` (gitignored). Never paste them in chat.

---

## Fitness & ranking (`src/lib/arena/score.ts`)

| Var | Default | Effect |
|-----|--------:|--------|
| `ARENA_FITNESS_MODE` | `winrate` | `winrate` or legacy `pnl_dd`. |
| `ARENA_WINRATE_POWER` | `2` | Exponent on win_rate. ≥2 hardens gradient near 1.0. |
| `ARENA_MIN_TRADES_FOR_RANKING` | `30` | Below this → data-starved sentinel. |

**2026-06-05 patch:** any agent with `pnl_pct < 0` now hits a hard `WINRATE_LOSER_SENTINEL` (-2 M) regardless of win rate. Not env-tunable — intentional.

## Auto-promotion gates (`src/lib/arena/auto-promote.ts`)

| Var | Default | Effect |
|-----|--------:|--------|
| `ARENA_AUTO_PROMOTE_MIN_TRADES` | `100` | Trades before a paper agent can be promoted. |
| `ARENA_AUTO_PROMOTE_MIN_WIN_RATE` | `0.90` | Win-rate floor. |
| `ARENA_AUTO_PROMOTE_MIN_SHARE` | `0.15` | Min capital share allowed per promoted agent. |
| `ARENA_AUTO_PROMOTE_LIVE_KINDS` | (see code) | Comma-list of kinds eligible for live. Overrides `DEFAULT_SAFETY_CEILING`. |
| `ARENA_REQUIRE_HARDENED_FOR_PROMOTION` | `0` | Set `1` to block promotion until `audit:overfit` says HARDENED. |
| `ARENA_OVERFIT_GATE_WINDOW_DAYS` | `30` | Window for the PBO/DSR/WF battery. |
| `ARENA_DYNAMIC_KIND_WINDOW_DAYS` | `30` | Lookback for Hermes-style per-(kind,asset) blacklist. |
| `ARENA_ELIGIBILITY_WINDOW_DAYS` | `14` | Lookback used by the `/quality` dashboard. |
| `ALLOW_AUTO_PROMOTE` | (unset) | Set `1` to allow promotion runs at all. |

## Evolution (`src/lib/arena/evolve.ts`)

| Var | Default | Effect |
|-----|--------:|--------|
| `ARENA_SURVIVAL_PCT` | `0.5` | Fraction kept each generation. |
| `ARENA_CHAMPION_GENS` | `3` | Consecutive gens an agent must lead to graduate. |
| `ARENA_ELITE_COUNT` | `5` | Protected elites per gen. |
| `ARENA_ELITE_MAX_DD_PCT` | `0.20` | Elites with > this drawdown lose protection. |
| `ARENA_EVOLVE_EVERY` | (script-arg) | Ticks between evolve runs. |
| `ARENA_POP_SIZE` | (script-arg) | Population target. |
| `ARENA_MUTATION_MODE` | `programmatic` | `programmatic` or `llm`. |
| `ARENA_META_EVOLVE_EVERY` | `5` | Gen-frequency for meta-evolution of hyperparams. |
| `ARENA_META_EVOLVE_MAX` | (code) | Cap on meta-evolved variants. |
| `ARENA_STARTING_CASH` | `100` | $ per new agent. |

## Activation / capsule promotion (`src/lib/arena/championship.ts`)

| Var | Default | Effect |
|-----|--------:|--------|
| `ARENA_ACTIVATE_WINDOW_DAYS` | `14` | Window for the activation gate. |
| `ARENA_ACTIVATE_MIN_PNL_PCT` | `-0.02` | PnL floor (-2 %). |
| `ARENA_ACTIVATE_MAX_DD_PCT` | `0.25` | DD ceiling (25 %). |
| `MIN_LIVE_CAPSULE_PNL_USD` | (code) | $ floor for keeping a live capsule. |

## Market substrate (`src/lib/arena/snapshot.ts`)

| Var | Default | Effect |
|-----|--------:|--------|
| `ARENA_SNAPSHOT_CB_PRODUCTS` | `BTC-USD,ETH-USD,SOL-USD,XRP-USD,DOGE-USD` | Coinbase symbols snapshotted. |
| `ARENA_OKX_PRODUCTS` | `BNB-USDT,HYPE-USDT` | OKX symbols (BNB / HYPE). |
| `ARENA_SNAPSHOT_POLY_LIMIT` | `20` | Top-N Polymarket markets per tick. |
| `ARENA_POLY_TAGS` | (empty) | Tag filter on Gamma events. |
| `ARENA_SHORT_BINARIES` | `1` | Set `0` to disable the BTC Up/Down loop. |
| `ARENA_SHORT_BINARY_TAGS` | `5M,15M` | Recurrences scanned. |
| `ARENA_SHORT_BINARY_ASSETS` | (empty = all) | Asset filter for the discovery worker. |

## Cache + book recorder (added 2026-05-31)

| Var | Default | Effect |
|-----|--------:|--------|
| `API_CACHE_DISABLED` | (unset) | Set `1` to disable the api_call_cache recorder. |
| `API_CACHE_MAX_BODY_BYTES` | `262144` | Truncate cached bodies above this. |
| `BOOK_SNAPSHOT_MAX_TOKENS` | `60` | Top-K tokens to poll per cycle. |
| `BOOK_SNAPSHOT_KEEP_HOURS` | `24` | Hot-table retention. |
| `BOOK_SNAPSHOT_PRUNE_EVERY` | `600` | Cycles between prune sweeps. |
| `HISTORICAL_DB_PATH` | `data/historical-candles.db` | Coinbase OHLCV archive path. Set to `E:\Coding\datasets\historical-candles.db` to write to external. |
| `MIRROR_DST_PATH` | `E:/Coding/datasets/polymarket-archive.db` | Mirror destination for `npm run mirror:cache`. |
| `MIRROR_TABLES` | `api_call_cache,book_snapshots,overfit_verdicts,evolution_log,poly_binaries` | Comma-list. |
| `MIRROR_INTERVAL_MIN` | `60` | Loop interval. |
| `POLYMARKET_DB_PATH` | `data/polymarket.db` | Main DB; override for tests. |

## Strategy-specific gates

### Markov persistence (`MARKOV_*`)
`MARKOV_MIN_PERSISTENCE` (0.87 default — patch raises to 0.92 in walk-markov),
`MARKOV_MAX_PERSISTENCE` (0.99 — reject frozen states),
`MARKOV_MIN_EDGE`, `MARKOV_PER_SIGNAL_USD`, `MARKOV_DAILY_USD_CAP`,
`MARKOV_LIVE` (gate to enable real execution), `MARKOV_KELLY_FRACTION`,
`MARKOV_STOIKOV_GAMMA`, `MARKOV_STOIKOV_VARIANCE`, `MARKOV_POLL_MS`.

### Near-resolution scalp (`NRS_*`)
`NRS_TARGET_EDGE`, `NRS_PER_SIGNAL_USD`, `NRS_DAILY_USD_CAP`, `NRS_LIVE`, `NRS_POLL_MS`, `NRS_CAPSULE`.
**Live gate stays OFF until the negative-EV failure mode is mitigated** (see 2026-06-05 dashboard finding).

### Late-window scalp (`LATE_SCALP_*`)
`LATE_SCALP_DAILY_USD_CAP`, `LATE_SCALP_PER_SIGNAL_USD`, `LATE_SCALP_LIVE`, `LATE_SCALP_POLL_MS`, `LATE_SCALP_CAPSULE`.

## Risk + global caps

| Var | Default | Effect |
|-----|--------:|--------|
| `MAX_TRADE_USD` | (code) | Hard cap per fill. |
| `MAX_DAILY_USD` | (code) | Hard cap per day per venue. |
| `RISK_TOTAL_ACCOUNT_USD` | (code) | Total acct $ for sizing. |
| `RISK_MIN_PROMOTION_SCORE` | (code) | Floor on promotion-time fitness. |
| `RISK_DISABLED` | (unset) | Set `1` to bypass risk engine (dev only). |
| `ALLOW_TRADE` | (unset) | Master switch — `1` lets any adapter actually fire orders. |
| `ALLOW_BRIDGE` | (unset) | Master switch for bridging USDC. |
| `CAPSULE_ERROR_THRESHOLD` | (code) | Errors / window before capsule pauses. |
| `CAPSULE_ERROR_WINDOW_MIN` | (code) | Window for the above. |

## Venue creds / hosts

> `.env` only. Never via chat.

- **Polymarket:** `POLYMARKET_PRIVATE_KEY`, `POLYMARKET_PROXY_URL`, `POLYMARKET_FUNDER_ADDRESS`, `POLYMARKET_SIGNATURE_TYPE`, `POLYMARKET_CHAIN_ID`, `POLYMARKET_CLOB_API_KEY` / `_SECRET` / `_PASSPHRASE`, `POLYMARKET_RELAYER_API_KEY` / `_ADDRESS`. Hosts: `POLYMARKET_GAMMA_HOST`, `POLYMARKET_CLOB_HOST`, `POLYMARKET_DATA_HOST`, `POLYMARKET_RELAYER_HOST`.
- **Coinbase:** `COINBASE_CDP_KEY_NAME`, `COINBASE_CDP_PRIVATE_KEY`, `COINBASE_CDP_KEY_FILE`. Caps: `COINBASE_MAX_TRADE_USD`, `COINBASE_MAX_DAILY_USD`, `COINBASE_SWEEP_MAX_USD`, `COINBASE_SWEEP_PRODUCT`.
- **Kalshi:** `KALSHI_ACCESS_KEY`, `KALSHI_PRIVATE_KEY`, `KALSHI_API_KEY_FILE`, `KALSHI_HOST`. Caps: `KALSHI_MAX_TRADE_USD`, `KALSHI_MAX_DAILY_USD`, `KALSHI_SWEEP_MAX_USD`.
- **Anthropic / LLM:** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ORACLE_LLM`, `CLAUDE_PROB_LIVE_LLM`.
- **Chain RPC:** `POLYGON_RPC_URL`, `POLYGON_WS_URL`, `POLYGON_HTTP_URL`, `ALCHEMY_RPC_URL`, `ETH_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL`, `OPTIMISM_RPC_URL`.
- **CoinDesk:** `COINDESK_API_KEY`, `COINDESK_HOST`.
- **Binance.US:** *(not yet wired — see `reference_binanceus_creds_compromised_20260605.md` memory; keys leaked 2026-06-05, awaiting operator rotation before integration)*.

## Mode flags (development)

`EXEC_MODE`, `FACTORY_DRY_RUN`, `BACKFILL_VERBOSE`, `DECISION_PIPELINE_ENABLED`, `DECISION_PIPELINE_SHADOW`, `SUPERVISOR_DRY_RUN`, `REVIVE_FORCE_RENAME`, `BACKTEST_SWEEP`, `BACKTEST_PRELOAD_CANDLES`, `NEXT_PUBLIC_ALLOW_UNAUTHED_LOCAL`.

---

## How this file should be used

Three workflows:

1. **Tuning a strategy.** Find the `*_*` cluster (e.g. `MARKOV_*`), copy
   defaults into `.env`, then change one at a time and watch the
   `/quality` dashboard for the impact.
2. **Auditing a run.** Pull the relevant `.env` snapshot at the time of
   the run and cross-walk against this doc to make sure no knob shifted
   silently.
3. **Onboarding.** New operator reads this once instead of grepping the
   codebase.

When new env vars get added in TypeScript, **add a row here in the same PR.** Stale inventories are worse than no inventory.
