# Time-Consistency Audit — 2026-05-30

**Why this exists:** the backtest engine (`simulateAgentReplay`) iterates over historical tick times, but **the strategies it runs ask for live data along the way**. Any code path that defaults to `Date.now()` or SQL `'now'` for a TIME-SENSITIVE read leaks the present into the replay.

We hit this when the speed-fix's time-freeze broke trades: candles were frozen to the tick's now, but `findBinaryWindow` still used wall-clock now, so the agent saw historical candles + current binaries → no consistent context → `decide()` returned hold every tick.

This runbook is the inventory of every wall-clock usage in the decision-path code, classified by whether it needs tick-time scoping for backtest correctness.

## Wall-clock usages that AFFECT backtest correctness

These should accept an optional `cutoffUnix` / `nowMs` so backtests can freeze them. Today they default to wall-clock, so a historical replay sees future data.

| Location | Read | Fix |
|---|---|---|
| `src/lib/arena/binary-window.ts:79` | `findBinaryWindow()` SQL `strftime('%s', expiry_iso) > strftime('%s', 'now')` | Add `epochMsOverride` param; default to `Date.now()` but accept tick time |
| `src/lib/arena/agent-prediction.ts:51` | `readRecentTicks()` reads `realtime_ticks WHERE ts_unix >= strftime('%s','now','-X min')` | Accept cutoffUnix param + filter window from that |
| `src/lib/arena/agent-prediction.ts:352` | `poly_binaries` lookup uses `strftime('%s','now')` for expiry filter | Same — accept cutoff |
| `src/lib/arena/agent-prediction.ts:386` | reads `evolution_log WHERE created_at >= datetime('now', '-X seconds')` for consensus signals | Same |
| `src/lib/arena/agent-prediction.ts:223` | reads `coinbase_trades` using `new Date(Date.now() - X*60_000)` cutoff | Replace with cutoffUnix param |
| `src/lib/arena/match-opportunities.ts:90/107` | reads `evolution_log` with `Date.now() - maxAgeMin*60_000` cutoff | Same |
| `src/lib/arena/momentum.ts:34` | `loadRecentCandlesFromCoindesk` cutoff defaults to wall-clock | Same |
| `src/lib/arena/momentum.ts:87` | `loadRecentCandles` cutoff defaults to wall-clock (or `preloadedNowUnix` when set) | ✅ partially fixed |

## Wall-clock usages that are CORRECT (don't change)

These are write timestamps, cache TTLs, or live-operational counters — they SHOULD be wall-clock.

| Location | Why correct |
|---|---|
| `src/lib/arena/db.ts:67/81/90/99/133/285` | UPDATE statements writing `updated_at = datetime('now')` — these are write timestamps, not reads |
| `src/lib/arena/campaigns.ts:132/309/322` | `started_at`/`ended_at` writes on training_campaigns rows — write timestamps |
| `src/lib/arena/graduation.ts:99/231` | UPDATE + dedup cutoff for the graduation event log — operates in real-time |
| `src/lib/arena/llm-oracle.ts:68/95/101/243/258/301/315` | Cache TTL + rate-limit cooldown — wall-clock is correct (caches live in real time) |
| `src/lib/arena/cohorts.ts:154/188` | `datetime('now','-7 days')` filter for "graduation-eligible events in the last 7 days" — UI-facing, wall-clock is correct |
| `src/lib/arena/binary-window.ts:193` | `windowTimeMath(win, nowMs=Date.now())` — already parameterized |
| `src/lib/arena/cluster-aware-breeding.ts:94/130` | Already accept `nowMs` parameter — correct |
| `packages/adapters/polymarket/src/client.ts:151` | API request timestamp (HMAC signing) — wall-clock required |
| `packages/oms/src/reconcile/loop.ts:*` | Live reconciler — wall-clock correct |

## The recommended pattern

When adding any new function that reads "recent" data via SQL or filter, accept an optional `cutoffUnix` (epoch seconds) or `nowMs` (epoch ms) parameter that defaults to `Date.now()`. Wrap the SQL:

```ts
function readRecentX(cutoffUnix?: number, lookbackMin = 60) {
  const cutoff = cutoffUnix ?? Math.floor(Date.now() / 1000);
  const minStart = cutoff - lookbackMin * 60;
  return db().prepare(`SELECT * FROM x WHERE ts >= ? AND ts <= ?`).all(minStart, cutoff);
}
```

Then `simulateAgentReplay` passes `ctxNowUnix` to every call site so the full decision context is time-consistent.

## Why this isn't fully fixed today

Threading `cutoffUnix` through every decision-helper requires touching ~8 files + every call site in `sim.ts` + agent-prediction. That's a substantial diff that affects the live arena tick path too. Doing it carefully without regressing live behavior is a 2-3h fix.

The first attempt at a partial fix (only time-scoping candles via the preload) **made things worse** because of the inconsistency described above. The lesson: time-scope EVERYTHING or NOTHING; partial is the worst option.

## Concrete plan for the full fix

1. Add `cutoffUnix?: number` param to: `readRecentTicks`, `findBinaryWindow`, the consensus-signal lookup, `readRecentTrades`, `loadRecentCandlesFromCoindesk`, `match-opportunities` queries.
2. In `simulateAgentReplay`, before each tick:
   - Compute `ctxNowUnix = Math.floor(new Date(ctx.now).getTime() / 1000)`
   - Use a context-scoped Threadlocal-ish pattern OR pass via TickContext (extend the type)
3. Each strategy helper reads from TickContext when available, falls back to wall-clock otherwise.
4. Re-benchmark: should now drop to <30s for 14-day window AND fire correct historical trades.

## Until then

Backtest results are best read as: **"how the strategy would behave RIGHT NOW given X days of warmup data."** They are NOT a true historical replay. The PnL numbers reflect current-time decisions, not past-time outcomes.
