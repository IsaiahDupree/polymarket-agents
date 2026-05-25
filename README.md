# Polymarket Agents — local control plane

A local Next.js app for designing, running, and self-evolving AI-agent strategies
on Polymarket. Mirrors the full Polymarket docs offline, exercises every endpoint
end-to-end, and stores your agents' strategies, research, trades, and evolution
history in SQLite.

## What's in the box

```
PolyMarket/
├── docs/polymarket/          # 163 .md files — full Polymarket docs, mirrored
├── docs/test-results.json    # last endpoint-sweep results (45/47 passing)
├── scripts/
│   ├── fetch-docs.sh         # re-pull docs from docs.polymarket.com
│   ├── test-endpoints.ts     # smoke-test every endpoint we know about
│   ├── derive-clob-creds.ts  # one-shot: L1 → L2 credential derivation
│   ├── init-db.ts            # idempotent SQLite init
│   ├── seed-strategies.ts    # seed the 4 starter AI agents
│   └── research-loop.ts      # snapshot markets, evaluate strategies, propose new versions
├── src/
│   ├── app/                  # Next.js App Router pages + API routes
│   ├── lib/polymarket/       # typed HTTP client + EIP-712 / HMAC signing
│   └── lib/db/               # SQLite schema + queries
├── data/polymarket.db        # local SQLite store (gitignored)
└── .env.local                # secrets (gitignored)
```

## Setup

```bash
npm install
cp .env.local.example .env.local       # then fill in the values
npm run derive:creds                   # derive CLOB L2 API key from your private key
npm run db:init && npm run db:seed     # build SQLite + seed 4 starter agents
npm run test:endpoints                 # 47-endpoint sweep — should show pass=45 fail=2 skip=4
npm run dev                            # http://localhost:3000
```

## What the harness validates

| Surface              | Pass | Notes |
|----------------------|------|-------|
| Gamma (public)       | 11/11 | events, markets, tags, series, comments, search, sports, profiles |
| Data API (public)    | 11/11 | positions, trades, activity, value, OI, market-positions, holders, leaderboard, live-volume |
| CLOB public          | 14/14 | health, markets, sampling, orderbook, price, midpoint, spread, last-trade, history, tick-size |
| CLOB authenticated   | 5/5   | api-keys, orders, trades, balance-allowance, notifications |
| Relayer              | 6/6   | relay-payload, deployed, transactions, list-keys |
| Destructive (opt-in) | skip  | POST /order, DELETE /order, DELETE /cancel-all, relayer /submit |

Pass `--destructive` to wire the destructive trading paths in; they additionally
require `ALLOW_TRADE=1` to actually submit anything.

## Agent model

```
agents → strategies → strategy_versions (parent_version_id, is_current)
                          ↳ trades (price, size, intent, status, pnl_usd)
                          ↳ performance_metrics (window, win_rate, sharpe, drawdown)
research_notes  (topic, body, confidence, tags, source_urls, optional agent/strategy/market)
evolution_log   (proposal | promotion | retirement | scoring — append-only)
market_snapshots (yes/no price, midpoint, spread — fuels backtesting + UI)
```

Each strategy has a chain of immutable `strategy_versions`. The research loop
**proposes** new versions (writes them with `is_current=0` and logs a `proposal`
event); promoting a version is a separate human/agent step that flips
`is_current` and records a `promotion` event.

## Running the evolution loop

```bash
npm run worker:research        # one-shot
```

Pair with the Claude Code `/loop` skill, a cron job, or your scheduler of choice
to run it on an interval. Each pass:

1. snapshots the top-N reward-eligible markets,
2. records midpoint + spread for back-testing,
3. evaluates every active strategy against the snapshot,
4. proposes a new version when the evaluator suggests an edge,
5. writes a synthesis research note.

Per-strategy evaluators live in `scripts/research-loop.ts:evaluators`. Each one
is small and tailored:

- **`fade-headline-spikes`** (Atlas Macro) — recalibrates `entry.threshold_pts`
  to the observed p90 of `|1d return|` across the candidate universe.
- **`breakout-rider`** (Ember Momentum) — recalibrates `entry.vol_multiple_min`
  from current realized-vol distribution.
- **`stale-quote-arb`** (Scribe Sports) — proposes `requires_websocket: true`
  + a `max_age_ms` exit, citing the NBA-arb paper's 3.6s median window.
- **`weekly-deep-dives`** (Oracle Research) — emits a `research_note` listing
  the top-5 |z-score| candidates rather than mutating a spec.

Each proposal writes its observation set into `strategy_versions.backtest_summary`
so the rationale is auditable. Swap any evaluator for a model-driven one to
upgrade.

## Pages

- `/`              — control plane: agent count, risk, OI, leaderboard, recent trades, evolution feed
- `/agents`        — every agent + their strategies
- `/agents/[slug]` — agent charter + each strategy's current spec
- `/strategies`    — all strategies across agents
- `/strategies/[agent]/[strategy]` — version history, **proposed versions awaiting promotion** (with promote/retire buttons), performance, all trades
- `/trades`        — local agent trades + on-chain trades for the signer
- `/markets`       — live sampling markets + upcoming events + search
- `/markets/condition/[id]` — full orderbook + top holders + price-history **sparkline** for one market
- `/markets/event/[id]`     — every market in an event
- `/live`          — real-time websocket stream (top-of-book) for top sampling markets
- `/research`      — every research note (seeded with 11 substantive prediction-market microstructure notes)
- `/evolution`     — append-only evolution timeline (proposals + promotions + retirements)

## Internal API routes

- `GET  /api/agents`                                  — list agents
- `GET  /api/markets/sampling`                        — proxied sampling-markets
- `GET  /api/polymarket/sweep`                        — last endpoint-sweep result
- `GET  /api/research`                                — list research notes
- `POST /api/research`                                — create a note (zod-validated body)
- `POST /api/strategies/:id/promote` `{versionId}`    — flip is_current + log a `promotion` event
- `POST /api/strategies/:id/retire`                   — mark a strategy retired + log it

## Security notes

- `.env.local` is gitignored. **Never commit your private key.**
- The CLOB L2 secret + passphrase are derived deterministically from your
  signer's private key (`derive:creds`). They can be rotated by passing a
  different `nonce` to `client.createApiKey`.
- The destructive trading paths in `scripts/test-endpoints.ts` are wired but
  **refuse to actually submit anything** without `--destructive` AND
  `ALLOW_TRADE=1` set — keep it that way until you're ready.
