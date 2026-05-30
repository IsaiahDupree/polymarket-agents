# High-PnL Agent Factory — 2026-05-29

**One-line goal:** systematically produce trading agents with high lifetime PnL, by training them on years of historical price data, validating them via backtest + forward paper-test, and surfacing winners on `/arena/high-pnl-agents`.

**Operator framing:** "I want a factory that spits out high-PnL agents." Today the system evolves agents through random mutation + selection during live arena ticks. That's slow (compounded over real time) and noisy (5-min binary outcomes are heavily luck-driven). A factory replaces "wait and see" with "test and select."

## Existing infrastructure (what's already in place)

| Capability | Implementation |
|---|---|
| Genome + decide() per strategy | `src/lib/arena/genome.ts` + `sim.ts` — 20 kinds, parameterized, mutatable |
| Arena evolution loop | `npm run arena:tick` (one decision pass) + `npm run arena:evolve` (gen seal + breed) |
| Replay engine | `scripts/backtest.ts` + `scripts/arena-replay.ts` — runs genome against a window of historical data |
| Historical price snapshots | `coinbase_candles`, `market_snapshots`, `realtime_ticks`, `poly_binaries` (settled history) |
| Coindesk backfill | `npm run coindesk:backfill` for deep BTC/ETH history |
| Capsule staging | sim → paper → live promotion ladder with risk envelope (`packages/risk/src/capsules/`) |
| Auto-promote gate | `MIN_LIVE_CAPSULE_PNL_USD=96` minimum lifetime PnL before any capsule can go live |
| Backtest scripts | `npm run backtest`, `backtest:binaries`, `copy:backtest`, `consensus:backtest` |
| Parameter sweep | partial — `scripts/arena-compare-mutation.ts` does pairwise A/B |

## Gaps to "factory"

1. **No UI surface for training.** Operator has to know which CLI scripts to run; no "train agent #2929 on last 90d" button.
2. **No unified data range API.** Backtest scripts each fetch their own data range with their own conventions; no "give me BTC history from 2019-01-01 to today" single source.
3. **No structured training campaign.** No object that says "training run #42: agent X, seed Y, range [2024-01-01, 2024-12-31], objective=maximize_pnl" with output snapshots.
4. **No forward-test cohort tracking.** Once a backtest winner is staged in paper, there's no view that says "of the 20 winners we staged last week, here's their forward-test PnL today."
5. **Filter toggles are correct but `top`/`archetypes` could be more useful.** See below.
6. **No automated rejection of dud strategies.** Random-walk baselines should be auto-pruned after N backtests.

## Quick wins (Phase 0 — do today, 1 hour)

These don't need new infrastructure; just polish what exists.

- **0a.** `top` mode excludes archetypes — so it shows only naturally-evolved winners. Archetypes already have their own filter.
- **0b.** `archetypes` mode sorts by lifetime_pnl DESC (currently sorts by ID ASC).
- **0c.** Add a `min_pnl` query param to `/api/arena/binary-now` so the UI can filter to "show me agents with PnL ≥ $X." Default 0.
- **0d.** Investigate "Error in input stream" — likely a WS subscription or fetch race. Reproduce + fix.

## Phase 1 — Training panel per agent (~2 days)

A single-agent training surface. Goal: from `/arena/high-pnl-agents`, click an agent → see its training panel → kick off a backtest against a date range → view results.

### Surfaces

- New page `/arena/agents/[id]/train` — per-agent training console.
- New API `POST /api/arena/agents/[id]/train` — accepts `{ from: ISO, to: ISO, mode: "backtest"|"sweep"|"forward" }`, kicks off a training job, returns a job id.
- New API `GET /api/arena/training-runs/[runId]` — returns job status + results.
- New DB table `training_runs (id, agent_id, mode, from_iso, to_iso, status, started_at, ended_at, summary_json, fitness_json)`.

### Mechanics

- **backtest mode**: deterministic replay against the historical window. Reuses `scripts/backtest.ts` engine. Outputs PnL, trade count, win rate, max drawdown, Sharpe-equivalent.
- **sweep mode**: holds genome.kind constant, varies each parameter ±20% in a grid, runs N backtests, picks the variant with highest PnL. Updates the agent's genome on operator confirmation.
- **forward mode**: stages a sim-capsule, runs `arena:tick` against live data for the specified window, reports observed PnL.

### Display

```
/arena/agents/2929/train
─────────────────────────
agent: #2929 repricing-early-med
genome: poly_binary_repricing · {vel_sat_pct: 0.5, ...}

[backtest] [sweep params] [forward sim 24h]

backtest results (last 30d, 90d, 1y, all):
  30d:  +$94 (180 trades · 56% win)
  90d:  +$310 (550 trades · 53% win)
  1y:   +$1,180 (2.1k trades · 51% win)
  all:  +$2,800 (5k trades · 50% win)

sweep results (showing top 5 of 32 variants):
  ✓ vel_sat_pct=0.40 → +$340/90d (10% better than base)
  ✓ vel_sat_pct=0.55 → +$315/90d (1.6% better)
  ...

[apply best variant to agent #2929] [archive run]
```

## Phase 2 — Historical data ingest (~1-2 days)

Today we have 1-min Coinbase candles back ~6 months. To train against "all the way back since coin origination" we need:

- **2a.** Coinbase candle backfill: `cb.getProductCandles({granularity: ONE_MINUTE})` page back 6 hours at a time until 2017 (when BTC-USD launched). Rate-limited — total ~50k API calls per product, ~12h run. Stored to existing `coinbase_candles` table.
- **2b.** Polymarket settled-binary archive: scrape Gamma API for all closed 5M binary markets back to platform launch. Store outcomes (UP/DOWN won, settlement spot, etc.) to a new `poly_binaries_settled_history` table. This is the "did this strategy's prediction win?" oracle for backtests.
- **2c.** Daily snapshot dataset: derive a 1-min × 7-yr × 5-asset (BTC/ETH/SOL/XRP/DOGE) candle matrix as a single Parquet-style file (SQLite blob). One file per asset. Backtest loads from this, not from row-by-row queries.

### Storage estimate

- 7 years × 365 days × 24h × 60min × 5 assets ≈ 18M rows of 1-min candles
- ~8 bytes per field × 6 fields = ~48 bytes per row → ~860MB SQLite
- Acceptable on this hardware; would consolidate via VACUUM after backfill.

## Phase 3 — Training campaign object (~3 days)

A campaign is a structured training run that produces many candidates. Replaces ad-hoc CLI invocations.

### New table

```sql
CREATE TABLE training_campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  charter TEXT,                          -- "find best poly_binary_repricing variant on BTC 2024"
  config_json TEXT NOT NULL,             -- genome.kind, asset filter, date range, budget, objectives
  status TEXT NOT NULL,                  -- queued | running | done | failed
  candidates_produced INTEGER DEFAULT 0,
  best_candidate_id INTEGER,             -- FK paper_agents.id
  started_at TEXT, ended_at TEXT
);
```

### CLI + API

- `npm run train:campaign --kind poly_binary_repricing --asset BTC --range 2024-01-01..2024-12-31 --variants 50`
- `POST /api/arena/training-campaigns` — same args, returns campaign id, runs in background worker
- `GET /api/arena/training-campaigns/[id]` — progress + results

### Worker

`scripts/training-worker.ts`:
- Generates N random genome variants of the target kind
- Backtests each one against the date range (parallel where DB permits)
- Sorts by lifetime PnL
- Inserts top K as paper_agents with `introduced_by='campaign-<id>'`
- Optionally auto-stages the top 3 as sim capsules

## Phase 4 — Forward-test cohort tracking (~1 day)

A cohort is a set of agents staged at the same time. Display: "of the cohort I staged Monday, how are they doing today?"

- New page `/arena/cohorts` — lists all introduced_by tags + their cohort PnL
- For each cohort: total trades, total PnL, % alive, top performer
- Click → list of agents in the cohort with their current PnL

This is essentially a GROUP BY introduced_by query — easy lift on existing tables.

## Phase 5 — Auto-graduation pipeline (~2 days)

The factory output. Closes the loop:

1. Training campaigns produce candidates.
2. Top-K candidates auto-stage as sim capsules.
3. After K live arena ticks, evaluate forward PnL.
4. Survivors of threshold T promote from sim → paper (already gated by stage-gate).
5. After P paper ticks AND PnL ≥ MIN_LIVE_CAPSULE_PNL_USD, eligible for live promotion (still operator-confirm; the gate is just a precondition).
6. Daily report: `evolution_log` entry summarizing "factory output: N candidates produced, M graduated to paper, K eligible for live."

## Phased rollout

| Phase | Effort | Lands | Risk |
|---|---|---|---|
| 0 — Quick UI wins | 1h | Today | Trivial |
| 1 — Per-agent train panel | 2d | This week | Low (reuses backtest.ts) |
| 2 — Historical data ingest | 1-2d | This week | API rate limits — run overnight |
| 3 — Training campaign object | 3d | Next week | Moderate (new worker pattern) |
| 4 — Cohort tracking | 1d | Next week | Trivial (view layer only) |
| 5 — Auto-graduation pipeline | 2d | Week after | Moderate (chains 1-4) |

**Total: ~10 days for the full factory.**

## Non-goals

- **Not** rebuilding the arena evolution loop. Arena keeps running. The factory feeds *into* it (training produces candidates that arena evolves further). They're complementary.
- **Not** model-trained agents (no LLM fine-tuning, no RL training). Genome variants + backtest selection only.
- **Not** rewriting the existing backtest scripts. They become the engine the factory drives.
- **Not** changing the live-trade safety gates (`ALLOW_TRADE`, `MIN_LIVE_CAPSULE_PNL_USD`). Factory output goes through the same gates as any agent.

## Open questions for the operator

1. **Live trading still paused?** Currently `ALLOW_TRADE=0`. Factory output respects the gate, but if you want live capital flowing to graduated agents, that needs to flip.
2. **Backfill priority:** start with BTC only (1 product, ~3h) or all 5 assets in parallel (~12h)?
3. **Training compute budget:** N=50 variants per campaign uses ~10 min on this machine; N=500 takes ~2h. Defaults?
4. **Auto-stage threshold:** what's the minimum backtest PnL before a candidate gets sim-staged? Suggest: $50 over the backtest window.

## Validation gates

After each phase:
- `npx tsc --noEmit` clean
- `npm test` green (no regressions)
- Dev server returns 200 on `/arena/high-pnl-agents` AND any new pages
- Manual smoke: kick off a training run, verify it completes + writes results

## Recovery / undo

- Pre-factory git tag: `pre-factory-2026-05-29` (will create when work starts)
- All new DB tables are additive; rollback = `DROP TABLE` + `git revert`
- Backfilled rows go into existing tables — VACUUM after rollback recovers space

## Next action

If you approve this plan, **Phase 0 is the right starting point** because:
1. It's 1 hour of work
2. It gives you immediate UX improvement on the filter toggles
3. It fixes the "Error in input stream" if it's a real bug
4. You can review the result before committing to Phase 1+

Then we pause, you confirm the direction, and Phase 1 begins.
