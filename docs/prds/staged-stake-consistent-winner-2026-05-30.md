# Staged-Stake Consistent-Winner Program — 2026-05-30

**One-line goal:** maximize sim trades/day + win% at low ($2) stake first; then auto-step stake size for agents that prove out. Build trade volume + statistical evidence BEFORE committing real money.

This supersedes the standalone $2/$0.30 PRD by making the stake a STAGED variable that goes UP as agents earn their place.

## Why 94% win rate is the FLOOR

The asymmetry of buying near-cert outcomes makes a low win rate catastrophic.

For $2 stake / $0.87 entry / binary resolves $0/$1:
| Outcome | Math | Result |
|---|---|---|
| Win | (2 / 0.87) × $1.00 − $2 | **+$0.30** |
| Loss | (2 / 0.87) × $0.00 − $2 | **−$2.00** |

Per-trade expected value:
```
EV(W) = +$0.30 × W  +  (−$2.00) × (1 − W)
      = 2.30 × W − 2.00
```

| Win rate | Per-trade EV | Annualized at 280 trades/day |
|---|---|---|
| 60% | −$0.62 | **−$63,400 ☠️** |
| 75% | −$0.28 | −$28,500 |
| 85% | $0.00 | break-even |
| **87.0%** | **+$0.05** | barely positive |
| **94%** | **+$0.16** | +$16,400 (real target) |
| **99%** | **+$0.28** | +$28,500 (ceiling) |

**Below 87% win rate the strategy LOSES money even with high trade volume.** This is why the user's 94% floor is correct — anything lower bleeds capital.

The current cohort is at ~75% win rate on tiny samples (8 trades). That's NOT good enough for real money. **Phase promotion is gated on hitting 94% over a meaningful sample (50+ trades).**

## The staged ladder

| Phase | Stake | Promote when | Why |
|---|---:|---|---|
| **1** | $2 | ≥50 trades AND win% ≥ 94% (rolling 50) (current phase) | Cheap to build statistical evidence; small max loss per trade limits damage from bad strategies |
| **2** | $5 | ≥150 trades AND win% ≥ 94% (rolling 50) AND lifetime PnL > 0 | More signal per trade; confirms Phase 1 wasn't lucky |
| **3** | $10 | ≥300 trades AND win% ≥ 94% (rolling 50) AND lifetime PnL ≥ $50 | Bigger position size; meaningful PnL |
| **4** | $20 | ≥500 trades AND win% ≥ 94% (rolling 50) AND lifetime PnL ≥ $150 | Pre-live confidence — operator can flip ALLOW_TRADE=1 |

Promotion is **automatic** via `worker:stake-promoter` (new). The worker scans the cohort every N hours, finds agents that cleared the current-phase threshold, and bumps `entry_size_usd` to the next tier in their genome.

Demotion is NOT automatic. Win-rate falling after a promotion needs operator review (could be regime change or actual strategy decay).

## Trade-volume target

**Daily trade throttle: ~280 trades/day total across the 12-agent cohort.**

Sizing math:
- 280 trades/day ÷ 12 children = ~23 trades/child/day
- Arena ticks every 5 min = 288 ticks/day
- Per-tick fire rate target: ~8% of ticks per child
- This is achievable when markets are active (probes confirm ~40% fire rate during good windows)

If daily volume exceeds 280, `worker:arena-loop` throttles tick cadence DOWN (10-min interval instead of 5).
If daily volume is way under 280, no action — markets just aren't presenting opportunities. We accept that.

## Graduation gate (lowered)

The "graduation-eligible" signal in the existing `worker:graduate` is the FIRST checkpoint. Pre-existing thresholds were `$50 PnL + 10 trades`. Lowered to:

| Threshold | Was | Now | Why |
|---|---|---|---|
| `GRADUATION_MIN_PNL_USD` | $50 | **$10** | At $2 stake, $50 PnL = 5+ winning trades net. $10 is reachable in ~15 trades |
| `GRADUATION_MIN_TRADES` | 10 | **15** | Slightly more trades for statistical signal at the smaller PnL bar |

**The real-money gate (`MIN_LIVE_CAPSULE_PNL_USD=96`) stays unchanged.** That's the operator's final guardrail before any live capital deploys. Graduation = "eligible to review"; not "approved to trade."

## Workers required

| Worker | Cadence | What it does |
|---|---|---|
| `worker:arena-loop` (new) | every 5 min | Fires `arena:tick`; throttles down to 10-min if daily target hit |
| `worker:stake-promoter` (new) | every 4 hours | Scans cohort; bumps `entry_size_usd` per the staged ladder |
| `worker:graduate` (existing) | every 30 min | Emits `graduation-eligible` events when child clears the lowered gate |

All three are the **persistent** worker pattern (mirrors `worker:graduate`). Each logs to `data/<name>.log`.

## The behavioral contract burned into code

1. **Stake is a property of the agent's genome**, not a global env. Each child carries its own `entry_size_usd` and the staged promoter mutates it in place.
2. **Promotions are logged** as `stake-promoted` events in `evolution_log` so we can audit "why is this agent now betting $10?"
3. **Demotions are MANUAL** — no auto-revert. Operator inspection required.
4. **A child that loses big after promotion gets retired** — `cull` happens during normal gen seal if `lifetime_pnl_usd < 0` post-promotion.
5. **Win-rate is computed only over the last N trades** (rolling, default N=50). This avoids early lucky streaks dominating a child's stats forever.

## Success criteria (real-money readiness)

Operator can confidently flip `ALLOW_TRADE=1` for a capsule when its child has:
- ✅ Reached Phase 4 ($20 stake)
- ✅ ≥500 lifetime trades
- ✅ Win% ≥ 94% over last 100 trades (the hard floor)
- ✅ Win% ≥ 90% over last 200 trades (no degradation)
- ✅ Max drawdown ≤ 15%
- ✅ Lifetime PnL ≥ $300
- ✅ At least two full weeks at Phase 4 without regression below 92%

At current trade rates (~23/child/day), reaching Phase 4 takes **~3 weeks of continuous paper trading**. With the cohort of 12, at least 1-3 children should reach Phase 4 in that window.

## Operator dashboard

`/arena/cohorts/consistent-winner-2026-05-30` — already exists. Should show per-agent: current phase, trades count, win%, lifetime PnL, last promotion timestamp.

(Future: add a `phase` column. For now, infer from `entry_size_usd` in genome_json.)

## Failure modes

| Failure | Detection | Response |
|---|---|---|
| All children stuck at Phase 1 indefinitely | `worker:stake-promoter` reports `0 promotions/day` for 7+ days | Investigate: probably win% < 60% across cohort. Strategy needs review. |
| Win% drops sharply after promotion | Per-child win% over last 50 trades dropping >10pp from pre-promotion | Manual: revert entry_size_usd via DB UPDATE or mark agent for retire |
| Trade volume way below 280/day | `worker:arena-loop` reports cohort firing <50 trades/day | Could be market regime (BTC stable, no velocity). Not actionable — wait for activity. |
| Agent reaches Phase 4 with negative PnL | `worker:stake-promoter` should never promote a -PnL agent | Bug. Verify promote logic guards on `lifetime_pnl > 0` per phase. |

## Non-goals

- **No real-money trading**. `ALLOW_TRADE=0` stays set. Operator manually flips it after Phase 4 + manual review.
- **No deviation from $2 → $5 → $10 → $20 ladder**. Custom stake-sizing math (Kelly etc.) is a separate epic.
- **No new strategy kinds**. Phase work is purely about scaling stake on the strategies we already have.
