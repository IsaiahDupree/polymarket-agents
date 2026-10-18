# PRD: Polymarket Up/Down 5-min binary bot archetypes

**Source:** @RetroValix, "6 Main Types of Trading Bots on Up/Down Markets on Polymarket" (May 16, 2026)
**Imported:** 2026-05-29
**Status:** in progress — agents seeded, performance TBD

## Why this matters

The article analyzes 1,000 profitable bots on Polymarket's crypto Up/Down 5-min binaries
and clusters them into 6 archetypes. The repeated finding: profitable bots do not
predict direction; they **trade market microstructure** — repricing delays, orderbook
imbalance, arbitrage between UP and DOWN, lag between 5-min and 15-min contracts,
and the final seconds before resolution.

All 6 archetypes share the same operational pattern:
**limit orders + small repeatable edge + precise execution + hedging + speed.**

This PRD seeds one paper agent per archetype (varying params) so we can observe each
archetype's PnL signature against our existing genome roster.

---

## The six archetypes

### 1. Pure Arbitrage Bot
**Core:** buy UP + DOWN when their combined price is below $1.00. One side must pay
$1 → guaranteed profit.

Example: UP @ $0.45 + DOWN @ $0.46 = $0.91 cost, $1.00 payoff = +$0.09 / pair.

Difficulty: opportunities are short-lived; needs fast detection + limit orders to avoid
slippage that destroys the edge.

**Mapped genome:** `poly_binary_arbitrage` (NEW, this PRD adds it)
  - params: `max_combined_price` (e.g. 0.99), `min_edge_pts`, `min_book_depth_usd`,
    `entry_size_usd`, `max_remaining_sec`, `direction_bias = "neutral"`

### 2. Directional Arbitrage Bot
**Core:** start from arbitrage structure (#1), then size up one side if a model signal
shows asymmetric edge. Arb base = downside protection, tilt = directional alpha.

**Mapped genome:** same `poly_binary_arbitrage` with `direction_bias = "tilt_up"` or
`"tilt_down"` and `tilt_ratio` > 1. When the strategy reads the underlying CB velocity
and the tilt-side matches the velocity sign, it sizes that leg up by `tilt_ratio`.

### 3. Repricing / Fair Value Model Bot
**Core:** compute fair UP probability from the underlying asset (BTC spot move,
Black-Scholes-style or raw delta), compare to Polymarket UP ask. Buy the undervalued
side when poly lags. This is **not** pure arb — it's a directional bet on the lag.

**Mapped genome:** existing `cross_venue_arb` already does this for the long-horizon
case. For 5-min binaries, `poly_short_binary_directional` covers the "buy ahead of
poly catch-up" pattern (it reads CB velocity, then bets UP/DOWN).

Confirmed existing coverage. No new kind needed; we'll seed extra agents with
`poly_short_binary_directional` configured to enter early (low `pre_cutoff_min`) and
trade frequently.

### 4. Cross-Timeframe / Multi-Market Bot
**Core:** trade 5-min + 15-min contracts simultaneously, capture the lag between how
each contract reprices a BTC move.

**Mapped genome:** existing strategy `cross-timeframe-spread-trade` (strategies.id=12)
and the dedicated arena worker. The matching genome kind that consumes
`cross-timeframe-opportunity` events is `poly_short_binary_directional` (matcher already
includes that event_type in its compat set).

Confirmed existing coverage.

### 5. Order Book Imbalance Bot
**Core:** read OB skew to identify temporarily undervalued sides. Builds the position in
parts; uses the second side as a partial hedge.

**Mapped genome:**
  - On Polymarket: existing `polymarket_market_maker` (spreads + alternate sides) and
    `orderbook-imbalance-watch` strategy (id=13).
  - On Coinbase: existing `cb_orderbook_imbalance` we added in the previous PRD pass.

Confirmed existing coverage. Will seed both types so they're visible in the panel.

### 6. Near-Resolution Bot
**Core:** in the final seconds of a 5-min binary, the winning side often trades at
$0.98–$0.99 instead of $1.00. Bot scoops the residual yield. High win rate,
tail-risk on last-second reversals.

**Mapped genome:** existing `late-window-scalp` strategy (strategies.id=24) — the
observer script `observe:late-window-scalp` produces `late-window-scalp-opportunity`
events. Compatible genome kinds: `poly_short_binary_directional`.

Confirmed existing coverage. The `late-window-scalp` paper capsule already runs in
sim — we'll seed additional `poly_short_binary_directional` agents with very high
`pre_cutoff_min` (~3.5–4 min after window start) to mimic this archetype.

---

## What ships with this PRD

1. **One new genome kind** — `poly_binary_arbitrage` (covers archetypes #1 + #2)
2. **Seeded agents** via `npm run seed:bot-archetypes` (tagged
   `introduced_by = 'archetype-prd-2026-05-29'`):
   - 5 `poly_binary_arbitrage` agents — pure arb + tilt variants
   - 3 `poly_short_binary_directional` agents — repricing/fair-value (archetype #3)
   - 3 `poly_short_binary_directional` agents — cross-timeframe (low pre_cutoff_min,
     short vel_window_min) for archetype #4
   - 3 `polymarket_market_maker` agents — imbalance / two-sided spread for #5
   - 3 `poly_short_binary_directional` agents — high pre_cutoff_min, hugging
     resolution for archetype #6

Total: 17 new paper agents, distributed across the 6 archetypes.

---

## Cross-cutting properties (from the article)

All 6 archetypes share:

1. **Limit orders.** Market orders kill small-edge strategies via slippage.
2. **Small repeatable edge.** No single huge prediction; hundreds of small wins compounded.
3. **Trades structure, not direction.** Asks "where is the price lagging reality?",
   not "where is BTC going?"
4. **Exploits inefficiency / lag.** Underlying moves → fair prob changes → Polymarket
   reprices. The trading window is between step 2 and step 3.
5. **Manages risk via position structure.** Hedge legs, asymmetric sizing, multi-market
   pairs — not just buy-and-pray.

**What this means for our sim engine:** the current `Signal` type returns one entry per
call. Two-leg arbitrage needs two signals. Workaround for `poly_binary_arbitrage`: emit
one leg per tick, alternating UP/DOWN by `agent.entries_count % 2`. Side picked depends
on `direction_bias` — `neutral` alternates evenly, `tilt_up` favors UP at `tilt_ratio` to
DOWN size, vice versa for `tilt_down`. Acceptable for sim; live execution would need a
multi-leg order primitive.

---

## Open questions / follow-ups

- The article's archetypes assume **limit orders on Polymarket CLOB**. Our live router
  currently submits taker market orders. Live promotion of `poly_binary_arbitrage` is
  blocked until the limit-order path lands.
- Archetype #1 (pure arb) is risk-free in theory but EV per cycle is ~1¢/pair. Real
  edge depends on `min_book_depth_usd` and how many cycles we capture/day. Worth
  measuring once seeded agents have 24h of sim runtime.
- Archetype #3 (repricing) genome maps to `poly_short_binary_directional` today but
  doesn't carry the fair-value computation explicitly. Future enhancement: a separate
  `poly_binary_repricing` kind that pre-computes Black-Scholes implied prob from a
  longer CB lookback and bets the spread vs poly ask.

---

## Article body (verbatim, for the record)

> 6 Main Types of Trading Bots on Up/Down Markets on Polymarket
>
> I analyzed 1,000 profitable trading bots on Up / Down markets with Claude and found
> common patterns that help them consistently grow their PnL.
>
> At first glance, it may seem like these bots all do the same thing: buy an outcome
> and try to guess the direction of the price. But in reality, profitable bots trade
> market microstructure: repricing delays, order book imbalance, arbitrage between Up
> and Down, lag between 5 minute and 15 minute contracts, and the final seconds before
> resolution.
>
> [See full article above — archetypes 1–6 transcribed; common properties; conclusion.]
>
> On Polymarket, these bots make money not because they always know the future. They
> make money because they see market structure faster than most people can realize
> that the price has already become wrong.

— @RetroValix, https://x.com/RetroValix
