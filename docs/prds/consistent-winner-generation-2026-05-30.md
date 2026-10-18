# Consistent-Winner Generation — 2026-05-30

**One-line goal:** breed a generation of agents that **bet $2 per entry and consistently return ~$0.30 per winning trade on Polymarket 5-minute BTC binaries**.

This is THE focused, primary objective of the factory going forward. Everything in this system optimizes for: many trades, high win rate, small consistent positive PnL per trade.

## The exact target

| Metric | Target | Why |
|---|---|---|
| **Stake per trade** | **$2** | Small enough to scale; large enough to cover venue fees + slippage |
| **Profit per winning trade** | **~$0.30** | 15% per-trade return; achievable via buying near-cert outcomes at $0.85→$1.00 convergence (2 shares × $0.15 = $0.30) |
| **Win rate** | **≥ 60%** | Above breakeven after fees; current consistent winners hit 60-62% |
| **Trade frequency** | **≥ 10 trades / 14d** | 5-min binaries fire constantly — many opportunities |
| **Lifetime PnL** | **> $0** | Hard gate; negative-PnL agents are auto-culled |
| **Max DD** | **< 30%** | Capsule-level guardrail prevents catastrophic streaks |

## The math (why $2 → $0.30 works)

A 5-min binary's UP ask in the last ~60 seconds of the window often sits at **$0.85-$0.95** when the outcome is effectively decided by spot movement. Buying at $0.87:

```
$2 stake / $0.87 per share = 2.30 shares
Payoff at resolution = 2.30 × $1.00 = $2.30
Profit = $2.30 − $2.00 = $0.30   ✓
```

If we buy at $0.90: profit = ($2.00/$0.90) × $1.00 − $2.00 = **$0.22**.
If we buy at $0.85: profit = ($2.00/$0.85) × $1.00 − $2.00 = **$0.35**.

So the sweet-spot price band is **$0.85 ≤ ask ≤ $0.92** with target ≥ 0.92 yielding ≥ $0.17.

## Strategies that produce this pattern

Two genome kinds already exhibit the consistent-winner pattern in the current DB:

### 1. `poly_late_window_scalp` (direct match)
Designed for exactly this — "buy near-cert outcomes in last 30-180s." Param tuning:
- `entry_size_usd = 2` (HARDCODED)
- `min_ask = 0.85` (don't buy too cheap — too much exit-time risk)
- `max_ask = 0.92` (don't buy too rich — payoff would be < $0.16)
- `min_payoff_per_share = 0.15` (refuses thin yields)
- `max_remaining_sec = 180` (only enter in last 3 minutes)

### 2. `poly_short_binary_directional` (with conservative gates)
Velocity-driven directional, but force conservative price filters so it only enters near-cert plays:
- `entry_size_usd = 2` (HARDCODED)
- `vel_window_min = 3` (3-min velocity window — short, responsive)
- `vel_entry_pct = 0.003-0.005` (low threshold = more entries)
- `pre_cutoff_min = 1` (allow late entries)
- `max_window_min = 3` (3-min binaries only — most data, fastest cycle)
- `max_yes_price_for_buy = 0.92` (caps how rich we'll pay)
- `min_yes_price_for_sell = 0.08` (sell-NO equivalent for DOWN bets)
- `max_positions_per_asset = 3` (stack up to 3 concurrent on same asset)

## Parent selection (current generation)

Query: alive agents with `trades_count ≥ 10 AND win_rate ≥ 0.60 AND realized_pnl_usd > 0`, sorted by `realized_pnl_usd × win_rate`.

As of 2026-05-30:

| Rank | ID | Name | Kind | Trades | Win% | PnL | $/trade |
|---|---|---|---|---|---|---|---|
| 1 | **#2153** | `g66-p29-agg-5m-binary` | `poly_short_binary_directional` | 15 | 60% | +$28.02 | $1.87 |
| 2 | **#2442** | `g78-s16-fade-spike` | `poly_fade_spike` | 13 | 61.5% | +$18.08 | $1.39 |

These two are the SEED PARENTS for the consistent-winner generation.

## Implementation

### `scripts/seed-consistent-winners.ts`

For each qualifying parent (loaded by the same query above):
1. Parse the parent's genome.
2. Generate **3 children** per parent. Each child:
   - Copies the parent's genome
   - Hard-overrides `entry_size_usd = 2`
   - Hard-overrides any price-band field to the conservative range above
   - Perturbs remaining params ±10% (so children aren't identical)
3. Inserts as `paper_agents` with `introduced_by='consistent-winner-2026-05-30'`, `is_elite=1`, `cash_usd_start=$1000`.
4. Auto-stages each as a paper capsule via `graduateCandidate()` with capital $50, daily-loss cap $25, max-DD $10.

Run: `npm run seed:consistent-winners`. Idempotent — safe to re-run.

### Backtest verification

For each seeded child, run `simulateAgentReplay({ agentId, fromIso: -14d, toIso: now })` and verify:
- `trades_count ≥ 5`
- `wins_count / trades_count ≥ 0.55` (one notch below target — backtest can be noisy)
- `pnl_usd > 0`
- `pnl_usd / trades_count` in range $0.10-$0.50

Children that fail the verification get `alive = 0` (culled). Survivors continue accumulating live forward PnL.

### Burn into the factory

Modify `scripts/worker-btc-5m-factory.ts` to clamp `entry_size_usd ∈ [2, 3]` and price-band fields to the consistent-winner range on every variant it generates. **No more $50/$100 bet variants from new factory output.** The composite scoring already rewards trade volume — combined with the $2 cap, the factory will naturally evolve toward this pattern.

## Success criteria

After 24h of forward-paper-trading with the seeded children:
- ≥ 50% of seeded children have `trades_count ≥ 5`
- ≥ 50% of seeded children have positive `realized_pnl_usd`
- At least 2 children clear the graduation gate (`realized_pnl_usd ≥ $50` would require many wins; for this generation we lower it via `GRADUATION_MIN_PNL_USD=10` since stakes are smaller)

## Non-goals

- Big wins. We are not optimizing for moonshots. $0.30 × 200 trades = $60. That's the model.
- Going live with real money. `ALLOW_TRADE=0` stays set. This generation accumulates paper PnL only until the operator manually flips the live switch.
- Replacing the existing factory worker. The consistent-winner seed is a ONE-TIME seeding event; the factory continues running for ongoing exploration.

## Seed parents stay protected

Both #2153 and #2442 are marked `is_elite=1` going forward so they survive gen culls. They are the proof-of-concept that the pattern works; their data is our baseline.
