---
source: "@de1lymoon (Alex) on X (Twitter)"
url: "https://x.com/de1lymoon"
published: 2026-05-26
archived: 2026-05-30
views_at_archive: 1.1M
disclaimer: |
  Not tagged "Paid partnership". Author bio: "Researcher & Contributor
  @Polymarket | AI maxi". The article is heavy on real, runnable code
  and cites Jonathan Becker's "72.1M trade analysis" — a real dataset
  this codebase already has notes on (see `docs/research/` for prior
  Becker references). No referral links in the body. Treat as a
  substantive technical piece; calibration table is the highest-value
  takeaway and worth re-deriving from our own trade history rather than
  copying verbatim.
tags: [markov, monte-carlo, kelly, calibration, longshot-bias, maker-taker, becker, framework]
key_claims:
  - "72.1M trades / $18.26B volume analyzed (Becker 2026)"
  - "Contracts at 5¢ resolve YES 4.18% of the time (longshot bias measured)"
  - "Contracts at 1¢ resolve YES 0.43% — 'worse than a slot machine'"
  - "Makers earn +1.12% per trade, takers lose −1.12% — 2.24pp 'Optimism Tax'"
  - "NO outperforms YES at 69/99 price levels (taker side bias)"
  - "Maker-taker gap is 0.17pp in Finance vs 4.79–7.32pp in Entertainment/world events"
primary_sources_cited:
  - "Jonathan Becker — 72.1M Polymarket trades empirical analysis (2026)"
recommended_techniques:
  - "Markov transition matrix (10 states, 0–100¢)"
  - "Monte Carlo (10K paths per market)"
  - "Empirical longshot-bias calibration table"
  - "Quarter-Kelly sizing (full Kelly = ruin)"
  - "Maker-only execution unless edge > 20¢ AND time-critical"
---

# How To Use Markov Chains To Win Every Single Trade + [Quant Framework]

> I am going to break down how the top quants on Polymarket model price
> as a sequence of states to find high-probability trades consistently
> and give you the complete framework you can start building today.

## Part 1 — The Core Idea

A Markov Chain models a system that moves between states, where the
probability of the next state depends only on the **current** state —
not the entire history.

On Polymarket, the "state" is the contract price.

A contract trades between 0¢ and 100¢. At any moment, the price sits in
one of those states. Where it moves next depends on where it is now —
not where it was three weeks ago.

That single property is what makes this tractable. You don't need to
model the entire history of a market. You only need to know two things:
**what state it's in now**, and **how often it has historically moved
from that state to every other state**.

That second thing — the map of how prices move between states — is
called the **transition matrix**. Everything starts there.

## Part 2 — Step 1: Build the Transition Matrix

```python
import numpy as np

def build_transition_matrix(prices, n_states=10):
    states = np.clip(
        (np.array(prices) * n_states).astype(int),
        0, n_states - 1
    )
    T = np.zeros((n_states, n_states))
    for i in range(len(states) - 1):
        T[states[i], states[i + 1]] += 1
    row_sums = T.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1
    return T / row_sums
```

**Critical rule:** every state in the matrix needs at least 20–30
observed transitions. If a price bucket has only been visited twice,
its row is noise. Either gather more history or merge sparse states.

The asymmetry — wide distributions near 50¢, narrow at the extremes —
is the foundation of the longshot bias.

## Part 3 — Step 2: Run Monte Carlo Simulation

```python
def monte_carlo(T, start_state, days=30, n_sims=10000):
    n_states = len(T)
    finals = []
    for _ in range(n_sims):
        state = start_state
        for _ in range(days):
            state = np.random.choice(n_states, p=T[state])
        finals.append(state)
    finals = np.array(finals)
    return (finals >= n_states // 2).mean()
```

Each of those 10,000 paths is one possible future. Some shoot to 90¢
(YES resolves). Some crash to 5¢ (NO resolves). The fraction landing in
YES territory is your probability estimate — and 10,000 simulations run
in ~0.1s.

Same method physicists used to simulate neutron behavior in the first
nuclear reactors.

## Part 4 — Step 3: Calibrate Against Longshot Bias

Your Monte Carlo will systematically **overestimate** the probability of
longshots. The raw matrix doesn't know that cheap contracts are
structurally overpriced by the crowd.

In 2026, Jonathan Becker analyzed 72.1M trades across $18.26B volume:

| Price | Naive (should resolve) | Actual resolution rate |
|-------|------------------------|------------------------|
| 1¢    | 1.0%                   | 0.43%                  |
| 5¢    | 5.0%                   | 4.18%                  |
| 10¢   | 10.0%                  | 8.7%                   |
| 20¢   | 20.0%                  | 18.1%                  |
| 30¢   | 30.0%                  | 28.5%                  |
| 50¢   | 50.0%                  | 50.0%                  |
| 70¢   | 70.0%                  | 71.5%                  |
| 80¢   | 80.0%                  | 81.9%                  |
| 90¢   | 90.0%                  | 91.3%                  |
| 95¢   | 95.0%                  | 95.8%                  |

For every dollar you put into 1¢ contracts as a taker, you get back 43
cents. **Worse than a slot machine** (90¢-on-the-dollar return).

**Second finding:** NO outperforms YES at 69 of 99 price levels. Takers
disproportionately buy YES — their team, their candidate, their bags.
That demand inflates YES and depresses NO.

> Rule: if you must trade as a taker below 30¢, buy NO instead of YES.

## Part 5 — Step 4: Size With Kelly

```python
def kelly_fraction(p_win, price_cents):
    cost = price_cents / 100
    payout = 1.0
    if cost >= payout:
        return 0
    b = (payout - cost) / cost
    p = p_win
    q = 1 - p_win
    f = (b * p - q) / b
    return max(0, f)

def position_size(p_win, price_cents, bankroll, kelly_fraction_multiplier=0.25):
    f = kelly_fraction(p_win, price_cents)
    f_adjusted = f * kelly_fraction_multiplier
    dollars = bankroll * f_adjusted
    shares = dollars / (price_cents / 100)
    return {
        "full_kelly_pct": f,
        "quarter_kelly_pct": f_adjusted,
        "dollars": dollars,
        "shares": int(shares),
    }
```

Quarter-Kelly is the professional standard. Full Kelly is optimal on
paper and ruinous in practice.

## Part 6 — Step 5: Execute With Limit Orders

Becker's data on the 72.1M trades:

> **Makers earn +1.12% per trade. Takers lose −1.12% per trade.**
> That's a 2.24 pp swing, statistically bulletproof.

Maker-taker gap by category:

| Category       | Gap (pp) |
|----------------|----------|
| Finance        | 0.17     |
| Crypto         | (mid)    |
| Sports         | (mid)    |
| Entertainment  | 4.79     |
| World events   | 7.32     |

Target Sports / Crypto / Entertainment for maker strategies — that's
where the Optimism Tax is fattest.

```python
def execution_plan(target_shares, current_price_cents, signal_strength):
    limit_price = (current_price_cents - 1) / 100
    plan = {
        "order_type": "LIMIT",
        "limit_price": limit_price,
        "shares": target_shares,
        "rationale": "Maker rebate +1.12% vs taker cost -1.12%",
    }
    if signal_strength > 0.20:
        plan["note"] = "Edge large enough to justify partial taker fill if unfilled in 1hr"
    else:
        plan["note"] = "Wait for maker fill. Do NOT cross the spread."
    return plan
```

## Part 7 — The Full System

Full Python class `MarkovPolymarketSystem` (omitted here for brevity —
see verbatim article). Takes price history + current price + days to
expiry, returns calibrated direction + Kelly size + execution
instruction or `PASS` if edge < 3¢.

## The 5-Step System, Summarized

1. **Build the Markov model.** 30–60 days of history → 10 states →
   transition matrix.
2. **Run Monte Carlo.** 10,000 paths from current state.
3. **Calibrate against the bias.** Apply Becker's empirical correction.
4. **Size with quarter-Kelly.** Full Kelly is ruin.
5. **Execute with limit orders.** Maker = +1.12%. Taker = −1.12%. Never
   cross the spread unless edge is enormous and time-critical.

## What To Do Next

1. **Walk-forward test.** Re-estimate the matrix at each step using only
   data available then. Never let future prices leak into past
   estimates.
2. **Paper trade first.** Run live without money for 2 weeks. Compare
   calibrated probabilities against actual resolutions.
3. **Respect the assumptions.** Markov property is an approximation;
   markets sometimes have longer memory. Transition probabilities drift;
   re-estimate on a rolling window. Never trust a cell built from fewer
   than 20–30 transitions.

> The Markov Chain doesn't predict the future. It quantifies the
> probability of every possible future given where you are now, and
> tells you precisely when the market has mispriced that probability.
> The crowd watches price. You watch the structure underneath it.
