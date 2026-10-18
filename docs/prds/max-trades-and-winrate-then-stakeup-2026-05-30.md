# PRD — Max Trades/Day × Max Win% First, Stake Up Second

**Date:** 2026-05-30
**Owner:** Isaiah
**Supersedes (in part):** `docs/prds/staged-stake-consistent-winner-2026-05-30.md` (the win-rate floor stays; this PRD adds the throughput axis the old PRD was missing)

---

## Doctrine (the rule, verbatim from the operator)

> "A mix of this but make sure we maximize each sim trade per day if %win is increasing — to roughly around 280 trades per day max. We want to maximize number of trades per day AND %win per trade, AND THEN focus on larger $2 bet spend after we reached high %win and high number of trades per day."

Restated as a joint-objective gate:

| Phase | Stake | Required to advance |
|---|---|---|
| **0 — Throughput build** | $0.50 (current $2 lowered, see F6) | Cohort trades/day ≥ 280 sustained 3 days **AND** rolling-50 win% ≥ 94% on ≥ 3 agents |
| **1 — Stake-up** | $2 | Same gate sustained 7 days **AND** cohort PnL > $0 |
| **2 — Scale** | $5, $10, $20 ladder (existing) | Existing staged-stake rules from prior PRD |

**Win% comes first, throughput comes first — neither alone is enough.** A bot doing 5 trades/day at 100% win is not safer than one doing 280/day at 95%; it's just slower data. A bot doing 280/day at 70% is a money fire. Both axes must move together.

---

## Diagnosis — why this keeps failing

(Findings from cohort state read on 2026-05-30, cw v1+v2 = 24 agents, all alive, seeded ~6h ago.)

### Reality check
- **24 agents, 23 lifetime trades total, 19 wins** (82.6% win%, $17.02 lifetime PnL)
- Target: 280 trades/**day** cohort-wide. Actual: ~3-4 trades/hour cohort-wide.
- **Gap: 95% short on throughput, 11pp short on win%.**

### Root cause #1 — arena:tick hard-exits when generation seals
`scripts/arena-tick.ts:30` exits with "no open generation. Run `npm run arena:init` first." after every generation auto-seals. `paper_generations` shows every gen sealing at exactly `tick_count = 6` (30 min of trading). After seal, every subsequent worker tick fails silently. **Worker-arena log shows TICK FAILED back-to-back from 21:19 onward with no recovery path.**

### Root cause #2 — arena:tick is the ONLY paper_trades producer
`grep insertPaperTrade` → 7 files, all of them are `arena-tick`/`arena-replay`/`arena-evolve`/tests/cleanup. **There is no continuous-paper-trade worker.** Even at peak (gen open, 6 ticks × 5min), the arena:tick path produces ~10-20 cohort trades per generation. To hit 280/day we'd need ~17 generations per day. We're getting 1-2.

### Root cause #3 — cw cohort isn't in the tick-set
`arena-tick.ts:55-63` unions three agent sets: `listAliveAgentsForGen(gen)`, `listAliveElites`, `listAliveAgentsWithLiveCapsule`. The cw cohort:
- ✗ Not in current gen (`n_agents=0` on gen 101 — they weren't bred into it)
- ✗ Not elite (they're new, no `is_elite=1`)
- ✗ Has PAPER capsules, not LIVE — `listAliveAgentsWithLiveCapsule` excludes them

→ The cohort only trades by accident, when an agent happens to be in another set.

### Root cause #4 — generation auto-seal at 6 ticks throttles throughput
`paper_generations.tick_count` caps at 6 across every historical generation. With 5-min arena cadence, that's 30 minutes of trading per "generation lifecycle" of ~hours. The seal triggers `runEvolveOnce()`. For the cw cohort — which is **not breeding, just trading** — this is pure overhead. We don't want gens for these agents.

### Root cause #5 — no time-error preflight
`docs/runbooks/time-consistency-audit-2026-05-30.md` already documents 8 wall-clock leaks in the decision path. None are detected at worker startup. So workers silently churn against stale data, run without an open generation, or get hit by NTP drift, and the operator only notices hours later. **The user's explicit ask: "know ahead of time if we get time errors."**

---

## The fix (in priority order)

### F1 — arena:tick auto-opens a generation if none is open (1h)
Replace the hard exit at `arena-tick.ts:30` with a `startGeneration()` call when `getCurrentGeneration()` returns null. Emit a `gen-auto-opened` evolution event. Side-effect: gen `n_agents` will be 0 (auto-open is for throughput, not breeding), and seal-at-tick=6 should be **disabled** for auto-opened gens (see F3).

### F2 — arena:tick includes the cw cohort unconditionally (30 min)
Add a fourth agent source to `arena-tick.ts:55-63`: `listAliveAgentsByIntroducedBy(['consistent-winner-2026-05-30', 'consistent-winner-v2-2026-05-30'])`. cw cohort agents tick on every arena cadence regardless of generation membership or capsule kind.

### F3 — Skip auto-evolve on auto-opened generations (15 min)
`arena-tick.ts:25` `ARENA_EVOLVE_EVERY=50` triggers `runEvolveOnce()` at tick_count=50 (so why does seal happen at 6 today? Because some other path is calling `sealGeneration` — needs a trace). Either way: gate the evolve call on whether the gen was auto-opened. Auto-opened gens are throughput vessels, not breeding vessels.

### F4 — Time-error preflight worker (`worker:preflight`) (2h)
New worker `scripts/worker-preflight.ts` runs **on every worker startup** and every 30 min via arena-loop. Checks:

| Check | Pass / Warn / Abort |
|---|---|
| `Math.abs(serverTime - polyApiTime()) > 60s` | abort |
| `lastRealtimeTickAgo > 5min` | warn |
| `lastRealtimeTickAgo > 30min` | abort |
| `getCurrentGeneration() == null` | warn → triggers F1 |
| `lastWsHeartbeatAgo > 5min` | abort |
| `db.pragma('busy_timeout') < 10000` | warn |
| `SELECT COUNT(*) FROM realtime_ticks WHERE ts_unix >= now-60s` = 0 | abort |

Each result emits a `time-consistency-check` evolution event with a single-line `pass/warn/abort` summary. Aborts block trade emission via a process-shared `TRADE_GATE_OPEN` flag (file in `data/.trade-gate`, atomically updated). Operator sees the abort in evolution_log within 30 min.

### F5 — Override the stake-promoter gate to require BOTH throughput and win% (45 min)
`scripts/worker-stake-promoter.ts:46-50` `PHASES[]` currently checks `minTrades` (lifetime) + `minPnl` + rolling win%. Add to every phase:
- `minTradesPerDay` (default 280 for phase 0→1, scaling down)
- `minDaysSustainedJointObjective` (default 3 for 0→1, 7 for 1→2)

Computed via:
```ts
const days_at_target = countDistinctDates(paper_trades WHERE agent_id=? AND created_at >= now-14d) // ≥ 280 trades AND rolling-50 win% ≥ 94% on each day
```

Promote only when BOTH axes have been met for the required number of days.

### F6 — Drop starting stake to $0.50 during throughput build (15 min)
`scripts/seed-consistent-winners-v2.ts:TARGET_STAKE_USD = 2` → drop to `0.5` for cw-v3 seed. At 280 trades/day × $0.50, daily capital churn = $140, much smaller blast radius if win% drops. Step up to $2 only after the joint gate clears.

### F7 — `npm run health` one-line cohort status (15 min)
New script that prints in ≤ 10 lines:
```
cw cohort: 24 agents | 24h: trades=156/280 (56%) wins=92% PnL=$18.20
gen: #101 SEALED 21:14 → no open gen ⚠
last tick: 8min ago ✓
last ws msg: 23s ago ✓
ntp drift: +12ms ✓
trade gate: OPEN
next stake-promotion check: 03:06 (4h cadence)
```
Operator runs once before a session; preflight runs it programmatically.

---

## Time-error preflight spec (F4 details)

**Purpose:** the operator's explicit ask — "know ahead of time if we get time errors."

**Triggers:**
1. Every worker startup (worker:arena, worker:stake-promoter, worker:graduate, factory:btc-5m, worker:realtime, etc.). Add a `runPreflight({ failHard: true })` call at the top of each `_env.ts` import chain.
2. Every 30 min from inside worker-arena-loop (so even if a worker started clean, drift is caught mid-session).
3. Manual via `npm run preflight`.

**Failure modes:**
- **Warn:** logged with `[preflight]` prefix and a `time-consistency-check` evolution event of type `warn`. Worker continues.
- **Abort:** logged, evolution event of type `abort`, process exits 1 with non-zero. Supervisor (the install scripts) restarts after 30s with backoff.

**Trade gate:**
A file `data/.trade-gate` containing `OPEN` or `CLOSED:<reason>:<ts>`. Read on every `submitOrder` and `applySignal` call. Closes when any abort-level preflight fails. Reopens when 3 consecutive preflight passes succeed. Operator can manually `echo OPEN > data/.trade-gate` to override.

**Why this matters for the failure mode we're seeing today:**
Today, arena-tick exits with "no open generation" and just keeps failing. Nobody knows for hours. Preflight would emit an abort within 30 min and **F1's auto-open would fire and resolve it before the operator wakes up**.

---

## Acceptance criteria

| Day | Criterion | Measure |
|---|---|---|
| 1 | F1+F2+F3 shipped, arena-loop survives a sealed gen | arena-loop log has 0 "no open generation" failures for 6 consecutive hours |
| 1 | F4 preflight runs at every worker start | `time-consistency-check` events in evolution_log ≥ 1/30min |
| 2 | cohort trades/day ≥ 50 cohort-wide | `npm run health` shows trades_24h ≥ 50 |
| 3 | cohort trades/day ≥ 280 cohort-wide | `npm run health` shows trades_24h ≥ 280 |
| 5 | rolling-50 win% ≥ 94% on ≥ 3 agents | stake-promoter log shows ≥ 3 eligible (or promoted) |
| 7 | First stake promotion $0.50 → $2 | `stake-promoted` evolution event for at least 1 agent |
| 7 | Preflight catches any drift event within 5min | tested by `date -s` clock-skew injection |

---

## Non-goals

- **Live trading.** Still gated behind operator manual flip. This PRD is about paper throughput + win% only.
- **Removing arena evolution.** `factory:btc-5m` keeps running on its 6h cadence to discover new strategies. The cw cohort lives in a separate "no-breed-just-trade" lane.
- **Changing the genome.** The tight params from cw-v2 seed stay. We're fixing the execution path, not the strategy.

---

## Why "this keeps failing" historically

Each prior iteration fixed one axis without the other:
- Phase 1 of staged-stake (the prior PRD) gated only on **win%** — no throughput floor. So a bot doing 1 win/day at 100% would "qualify."
- The arena-tick loop was assumed to be a continuous trader — it isn't, it's a 6-tick periodic sealed loop.
- Workers were launched without preflight — silent failures ate hours of throughput.
- Generation sealing was opaque — operator didn't know it had stopped.

This PRD couples both axes, fixes the execution path, and surfaces failures within 30 min via preflight. **The bot is allowed to scale up its stake only when it has proven it can do BOTH high throughput AND high win% for multiple days running.**
