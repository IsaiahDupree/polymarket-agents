# PRD: Polymarket microstructure bots (Daniro article)

**Source:** @Dan1ro0, "I analyzed 1000 Polymarket bots with Claude. Here's how they make $100K/month" (May 25, 2026)
**Imported:** 2026-05-29
**Status:** mostly covered by the existing RetroValix PRD; this doc captures the
*additional* technical detail and the one architectural gap it surfaces.

## Relationship to the RetroValix PRD

This article and `poly-up-down-bot-archetypes-2026-05-29.md` (RetroValix) describe
the **same six bot archetypes**:

  1. Pure Arbitrage   | 2. Directional Arbitrage    | 3. Repricing / Fair Value
  4. Cross-Timeframe  | 5. Imbalance / Microstructure | 6. Near-Resolution

The 17 archetype agents (`introduced_by='archetype-prd-2026-05-29'`, IDs
#2923–2939) and 3 Hermes-style multi_strategy agents
(`hermes-archetype-2026-05-29`, #2940-2942) cover all six.

What Daniro adds beyond the RetroValix coverage:

  • Explicit Bayesian update step (prior + likelihood ratios → posterior).
  • Explicit cross-market z-score formula:
      `z = (spread_now − μ) / σ` over a baseline window
    This is what powers archetype #4 (Cross-Timeframe) in practice.
  • Explicit fractional Kelly with λ = 0.25 — quarter-Kelly, the standard
    operator-default for low-sample-size edges.
  • Stoikov-style execution (inventory imbalance, volatility, time-to-expiry
    drive aggressiveness). This is an EXECUTION concern, not a strategy.
  • The 6-layer stack: Brain → Orchestration → Data/Signals → Market Intel
    → Backtest/Sim → Risk.

## Concept → genome / module mapping

| Article concept                          | Where it lives in this codebase |
|------------------------------------------|---------------------------------|
| Pure arb (UP+DOWN<$1)                    | `poly_binary_arbitrage` (neutral) |
| Directional arb (arb base + tilt)        | `poly_binary_arbitrage` (tilt_up / tilt_down) |
| Repricing / fair value                   | `poly_binary_repricing` (NEW), `poly_short_binary_directional`, `cross_venue_arb` |
| Cross-timeframe (5m vs 15m)              | `poly_cross_market_zscore` (NEW, this PRD), `poly_short_binary_directional` wide-window |
| Imbalance / microstructure               | `polymarket_market_maker`, `cb_orderbook_imbalance`, `cb_trade_flow_burst` |
| Near-resolution                          | `poly_late_window_scalp` (NEW) + late-entry `poly_short_binary_directional` |
| Bayesian update (prior + signal)         | `llm_probability_oracle` — Claude implicitly does Bayesian reasoning over the question |
| Net edge gate (model_p − market − cost)  | `min_ev_pct` on llm oracle, `edge_threshold_pp` on repricing, suggestStake EV check |
| Fractional Kelly λ=0.25                  | `suggestStake()` in `match-opportunities.ts` (quarter-Kelly), `agent-prediction.ts` confidence-weighted mean |
| z-score cross-market spread              | `poly_cross_market_zscore` (NEW, this PRD) |
| Stoikov-style execution                  | NOT IMPLEMENTED — execution layer concern; live router currently uses taker market orders |
| Risk-manager veto layer                  | Partial — `live-capsule-rejected` event from the decision pipeline |
| Backtest / sim layer                     | `scripts/copy-backtest.ts`, `scripts/consensus-backtest.ts`, `arena-replay.ts`, `replay-fitness.ts` |

## What ships with this PRD

1. **One new genome kind: `poly_cross_market_zscore`** — explicit
   implementation of the article's §4 z-score spread trade. Reads the midpoints
   of related markets (5m + 15m on the same asset), computes the rolling spread
   z-score, fires when |z| exceeds threshold. Trades the *underpriced* contract
   directionally.
   - params: `vel_window_min` (for the spread compute window), `baseline_min`,
     `z_threshold`, `entry_size_usd`, `assets`, `max_minutes_to_expiry`

2. **3 seeded agents** with the new kind (`introduced_by='daniro-archetype-2026-05-29'`):
   tight, balanced, loose z-thresholds. Each varies the z threshold and the
   baseline window length so the arena can compare which gate is most profitable.

## Honest gaps (deferred)

  • **Stoikov execution.** This is an execution-layer feature: aggressiveness
    of fill price as a function of inventory, volatility, and time-to-expiry.
    Adding this would require rewriting the live router to support
    inventory-aware limit-order placement + automatic reposting. Out of scope
    here.

  • **Explicit Bayesian update genome.** The llm_probability_oracle does this
    implicitly via the Claude prompt. A dedicated Bayesian-only genome
    (`poly_bayes_news_update`) would need a structured news feed as input,
    which we don't have today. Could be added later if a news source is wired.

  • **Cross-market hedged legs.** The article describes building positions
    where one leg hedges the other. Our `Signal` type returns one entry per
    tick — multi-leg construction works for `poly_binary_arbitrage` via the
    alternating workaround, but more sophisticated multi-leg structures would
    need a `MultiLegSignal` type. Deferred to a follow-up.

## Article body excerpts (verbatim, for the record)

> 1. Where the edge lives: a gap of a few seconds
>
> Polymarket reprices slower than the underlying asset moves on Binance. The
> lag is just a few seconds and it keeps tightening as more bots pile into
> the market. For a machine, a few seconds is an eternity.

> 3. signal → Bayesian update → fair value → edge check → cross-market
> comparison → execution → sizing
>
> ```python
> def bayes_update(prior, like_true, like_false):
>     num = like_true * prior
>     den = num + like_false * (1 - prior)
>     return num / den
> ```

> 4. The bot analyzes not the price, but the spread between markets via
> z-score:
> ```python
> z = (spread_now - mu) / sigma
> # → 3.60
> ```

> 7. Position size is computed via fractional Kelly:
> ```python
> def fractional_kelly(p, b, lam=0.25):
>     f_star = (b * p - (1 - p)) / b
>     return max(lam * f_star, 0)
> ```

> Conclusion: the market of opinions is dead. Long live the market of speed.

— @Dan1ro0, https://x.com/Dan1ro0
