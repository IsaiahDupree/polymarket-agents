---
source: "@0xRicker on X (Twitter)"
url: "https://x.com/0xRicker"
published: 2026-05-22
archived: 2026-05-30
views_at_archive: 902K
disclaimer: |
  Tagged "Paid partnership". Article ends with a referral link to
  predictparity.com?code=ricky and links to atomicbot.ai as a "no-code"
  hosting platform. The technical content (Markov filter, Kelly sizing,
  prompt templates) is independently useful even if the recommended
  hosting product is a marketing choice. Wallet PnL figures are
  unverified; classifier output (`npm run classify:wallet`) is the
  authoritative read for any wallet cited here.
tags: [hermes, agentic, btc, markov, kelly, prompts, polymarket]
key_claims:
  - "Bots generated $60M on Polymarket in 2025–2026, 77% of which from BTC 5m Up/Down"
  - "288 windows/day per asset; 1 trade every 81s"
  - "Markov persistence threshold p(j*,j*) ≥ 0.87 yields 63–72% win rate"
  - "Average edge window 5–15%"
  - "Hermes (NousResearch, $70M-backed by Paradigm) surpassed Claude Code in GitHub stars by April 2026"
  - "bonereaper / 0xe1D6b514 / 0xB27BC932 combined PnL: $2.1M"
recommended_repos:
  - "aulekator/polymarket-BTC-15-Minute-Trading-Bot"
  - "JLowo/gengar-polymarket-bot"
  - "dijenne/Polymarket-bot"
---

# Hermes + Polymarket — how to build an AI for a self-learning BTC trading agent ($100 → $10,000)

> Trading bots generated over $60M in profit on Polymarket in 2025–2026.
> 77% of that came from the Crypto UP/DOWN market — driven by persistent
> structural inefficiencies. Here's how to build one.

## 01 — The opportunity

The BTC 5-minute Up/Down market on Polymarket is one of the most
inefficient segments in prediction markets. The crowd prices directional
moves based on emotion — news cycles, social media, gut feel.

Meanwhile, the transition matrix of BTC price states shows something
different. When the market is in a committed directional state, the
**persistence is measurable**. The math knows before the crowd does.

That gap between what the math says and what the market prices is the edge.
And it's repeatable, scalable, and automatable.

The agent framework: **Hermes** — open-source, built by NousResearch
(backed by Paradigm with $70M). By April 2026, Hermes surpassed
Anthropic's Claude Code in total GitHub stars.

- 288 windows/day per asset
- 1 trade every 81 seconds
- Edge window: 5–15% average gap
- Win rate: 63–72% at p ≥ 0.87

### Top wallets cited

- **Bonereaper** — High-Confidence Spread Capture
  https://polymarket.com/@bonereaper
- **0xe1D6b514** — Dual-Mode Expected Value
  https://polymarket.com/@0xe1d6b51521bd4365769199f392f9818661bd907
- **0xB27BC932** — Multi-Asset Variance Reduction
  https://polymarket.com/@0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82-1772569391020

Combined: ~$2.1M across three bots, all in this market segment.

## 02 — The edge

The model is based on **Markov Chain analysis of BTC price states**. The
core insight: price movement is not random. When the market enters a
persistent directional state, the probability of continuation is
measurably above 50%.

### Entry formula

```
Δ⁽ʷ⁾ = p̂⁽ʷ⁾ − q⁽ʷ⁾ ≥ ε   →   ENTER
p̂ = model probability  ·  q = market price  ·  ε = 5% minimum gap
r = (1 − q) / q
At q = 0.647 → r = +54.5% per trade
At q = 0.441 → r = +126.7% per trade
```

The bot only enters when `p(j*, j*) ≥ 0.87` — the Markov persistence
threshold. Below that, no trade.

### Sizing

```
Kelly f* = p − (1−p) / b
Optimal position sizing per trade  ·  f* ≈ 0.71 at p = 0.87, b = 0.647
```

## 03 — The stack

Total cost: under $10/month. $10 min to start → $50 recommended → 2 POL
for gas (~$1) → ~30 min setup.

## 04 — Setup (3 steps)

### Step 1 — Install Atomic, launch Hermes
atomicbot.ai → download Atomic → choose Hermes agent. Run locally on Mac
or "Run in Cloud" with Google login. 100+ integrations, persistent
memory, support for Claude / ChatGPT / Gemini.

### Step 2 — Connect Claude Opus 4.7
Atomic → AI Models → Anthropic → paste API key → select
`claude-opus-4-7-20261001`.

```python
# Atomic → Settings → AI Models → Anthropic
Model:       claude-opus-4-7-20261001
API Key:     sk-ant-...
Max tokens:  4096
Temperature: 0.2  # lower = more consistent decisions
```

### Step 3 — Connect Telegram
Atomic → Skills → Messengers → Telegram → Connect. Create bot via
@BotFather → copy token → paste into Atomic.

## 05 — Trading logic

Instead of building from scratch, use an existing GitHub repo as the base
logic, then feed it to Hermes and let Claude Opus adapt it to Polymarket
CLOB v2.

### Recommended repos

- **aulekator/polymarket-BTC-15-Minute-Trading-Bot** — production-grade,
  7-phase architecture, Grafana, Redis, SL/TP. Best for Markov-based
  entries + Kelly sizing.
- **JLowo/gengar-polymarket-bot** — Quarter-Kelly, Brownian motion,
  calibrated vol. Best for conservative sizing with real-world
  guardrails.
- **dijenne/Polymarket-bot** — arbitrage + momentum + auto-optimization.
  Best for multi-strategy approach.

### Prompt 1 — Build logic

```
Build a Polymarket BTC 5-minute up/down trading agent
from this repo: github.com/aulekator/polymarket-BTC-15-Minute-Trading-Bot

Update it for Polymarket CLOB v2 and make it ready for safe live trading.

Requirements:
- Keep the existing architecture if possible
- Use Python
- Migrate execution to py_clob_client_v2
- Support SAFE_ADDRESS for Polymarket Safe/proxy wallets
- Use collateral balance terminology, not legacy USDC
- Add fee-aware trade evaluation using CLOB v2 market metadata
- Implement Markov persistence filter: enter only when p(j*,j*) ≥ 0.87
- Apply Kelly criterion for position sizing: f* = p - (1-p)/b
- Keep DRY_RUN=true by default
- Do not expose private keys in chat or logs
```

### Prompt 2 — Wallet setup

```
Create a Polymarket trading wallet and send me the address
so I can deposit collateral.

Approve 3 Polymarket contracts:
- CTF Exchange
- Neg Risk CTF Exchange
- Neg Risk Adapter

Confirm you understand the risks before proceeding.
```

### Step 3 — `.env` config

```
PRIVATE_KEY=your_wallet_key
SAFE_ADDRESS=your_safe_address
CLOB_HOST=https://clob.polymarket.com
DRY_RUN=true          # start here always
MIN_EDGE=0.05         # 5% minimum gap
MIN_PROB=0.87         # Markov persistence threshold
MIN_BET=1.00          # $1 minimum for testing
MAX_BET=50.00         # start conservative
BANKROLL=100.00       # initial capital
```

### Step 4 — Run dry-test first

```
Run the bot in DRY_RUN mode for 24 hours.
After each session log:
- Number of signals detected
- Entry prices and Markov state at entry
- Simulated P/L per trade
- Win rate at p(j*,j*) threshold

Send me a summary every 6 hours via Telegram.
```

## 06 — Self-learning loop

This is what separates Hermes from a static bot. Claude Opus 4.7 reads
the execution journal after every session and rewrites the trading rules
based on what worked and what didn't.

1. **Trade executes** — bot enters at `p(j*,j*) ≥ 0.87`. Every entry,
   exit, and P/L is logged to journal.
2. **Nightly review** — Claude Opus reads the journal, analyzes which
   thresholds performed, which windows lost, which entries had best EV.
3. **Strategy update** — Opus rewrites threshold rules, adjusts Kelly
   sizing, updates `MIN_PROB` and `MIN_EDGE` automatically.
4. **Next session runs with updated rules**. The agent is measurably
   smarter after 50–100 trades.
5. **Morning Telegram report** — yesterday's trades, updated rules,
   today's strategy. You review, approve, it runs.

### Nightly loop prompt

```
Every day at midnight, read the trade journal from today.

Analyze:
- Which Markov states had the highest win rate
- Which entry price ranges performed best (EV per trade)
- Whether current MIN_PROB should be adjusted up or down
- Whether Kelly f* is correctly sized given recent results

Then update the .env config and strategy parameters accordingly.
Send me a summary via Telegram with:
- Today's P/L, win rate, number of trades
- What changed in the strategy and why
- Tomorrow's updated thresholds
```

## Conclusion

With agentic frameworks like Hermes + Atomic, you don't need to be a
senior developer to build your own bot. You need Claude Opus as the
brain, a GitHub repo as the starting logic, and time for 50–100 training
trades. Start small. DRY_RUN=true first. $1–$2 per trade while training.

---

## Promotional section (NOT acted on by this codebase)

The article links to `predictparity.com?code=ricky` and `atomicbot.ai`.
Saved here for completeness only — this codebase already has its own
Hermes-archetype seed (`scripts/seed-hermes-archetype.ts`) and a router
with safety gates; we do not host strategy code through third-party
no-code platforms.
