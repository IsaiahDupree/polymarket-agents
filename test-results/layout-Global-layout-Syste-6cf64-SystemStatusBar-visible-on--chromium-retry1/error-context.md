# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: layout.spec.ts >> Global layout (SystemStatusBar + NavMenu + TradeTicker) >> SystemStatusBar visible on /
- Location: tests\ui\layout.spec.ts:5:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('SYSTEM')
Expected: visible
Error: strict mode violation: getByText('SYSTEM') resolved to 2 elements:
    1) <span class="font-semibold text-zinc-300 mr-1">SYSTEM</span> aka getByText('SYSTEM', { exact: true })
    2) <p class="text-xs text-zinc-500 leading-snug">Mirror the operator's manual winning pattern on P…</p> aka getByText('Mirror the operator\'s manual')

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('SYSTEM')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e4]:
      - generic [ref=e5]: SYSTEM
      - generic [ref=e6]: OK
      - generic [ref=e7]: "|"
      - generic "Polymarket mode" [ref=e8]: poly —
      - generic "Coinbase mode" [ref=e9]: cb —
      - generic [ref=e10]: "|"
      - generic [ref=e11]: alive
      - generic [ref=e12]: —
      - generic [ref=e13]: "|"
      - generic [ref=e14]: trades today
      - generic [ref=e15]: "0"
      - generic [ref=e16]: refresh 30s · —
    - banner [ref=e17]:
      - generic [ref=e18]:
        - link "polyagents" [ref=e19] [cursor=pointer]:
          - /url: /
        - navigation [ref=e20]:
          - link "Overview" [ref=e21] [cursor=pointer]:
            - /url: /
          - button "Markets ▼" [ref=e23] [cursor=pointer]:
            - text: Markets
            - generic [ref=e24]: ▼
          - button "Arena ▼" [ref=e26] [cursor=pointer]:
            - text: Arena
            - generic [ref=e27]: ▼
          - button "Capsules ▼" [ref=e29] [cursor=pointer]:
            - text: Capsules
            - generic [ref=e30]: ▼
          - button "Manage ▼" [ref=e32] [cursor=pointer]:
            - text: Manage
            - generic [ref=e33]: ▼
  - main [ref=e34]:
    - generic [ref=e35]:
      - generic [ref=e36]:
        - heading "Control plane" [level=1] [ref=e37]
        - paragraph [ref=e38]: Local workspace for AI-agent prediction-market strategies and research.
      - generic [ref=e39]:
        - generic [ref=e40]:
          - generic [ref=e41]: Active agents
          - generic [ref=e42]: 15/15
        - generic [ref=e43]:
          - generic [ref=e44]: Strategies
          - generic [ref=e45]: "16"
        - generic [ref=e46]:
          - generic [ref=e47]: Risk budget (USD)
          - generic [ref=e48]: $2,205
        - generic [ref=e49]:
          - generic [ref=e50]: Open interest (live)
          - generic [ref=e51]: "[{\"market\":\"GLOBAL\",\"val"
      - generic [ref=e52]:
        - generic [ref=e53]:
          - heading "Agents" [level=2] [ref=e54]
          - list [ref=e55]:
            - listitem [ref=e56]:
              - link "Atlas Macroatlas-macro $500 risk" [ref=e57] [cursor=pointer]:
                - /url: /agents/atlas-macro
                - generic [ref=e58]: Atlas Macroatlas-macro
                - generic [ref=e59]: $500 risk
              - paragraph [ref=e60]: Top-down macro/politics agent. Trades long-horizon (>14d) markets where consensus has drifted from priced odds. Bias toward mean-reversion after one-sided news cycles.
            - listitem [ref=e61]:
              - link "Scribe Sportsscribe-sports $250 risk" [ref=e62] [cursor=pointer]:
                - /url: /agents/scribe-sports
                - generic [ref=e63]: Scribe Sportsscribe-sports
                - generic [ref=e64]: $250 risk
              - paragraph [ref=e65]: In-game sports agent. Pulls live odds + sports websocket signals, looks for stale-quote arbs vs. game state.
            - listitem [ref=e66]:
              - link "Oracle Researchoracle-research $0 risk" [ref=e67] [cursor=pointer]:
                - /url: /agents/oracle-research
                - generic [ref=e68]: Oracle Researchoracle-research
                - generic [ref=e69]: $0 risk
              - paragraph [ref=e70]: Slow-thinker that produces written theses + confidence scores; does not place trades directly but proposes them to other agents.
            - listitem [ref=e71]:
              - link "Ember Momentumember-momentum $300 risk" [ref=e72] [cursor=pointer]:
                - /url: /agents/ember-momentum
                - generic [ref=e73]: Ember Momentumember-momentum
                - generic [ref=e74]: $300 risk
              - paragraph [ref=e75]: Trend-follower on high-volume markets. Rides moves with strict trailing stops; designed to be the opposite of Atlas Macro for diversification.
            - listitem [ref=e76]:
              - link "Aurora Crossaurora-cross $400 risk" [ref=e77] [cursor=pointer]:
                - /url: /agents/aurora-cross
                - generic [ref=e78]: Aurora Crossaurora-cross
                - generic [ref=e79]: $400 risk
              - paragraph [ref=e80]: Cross-venue agent. Pairs Polymarket binary/scalar markets with Coinbase spot to score implied-vs-realized probability spreads. Trades both sides when EV > 1% net of fees.
            - listitem [ref=e81]:
              - link "Paper Flow Demopaper-flow-516f78c7 $100 risk" [ref=e82] [cursor=pointer]:
                - /url: /agents/paper-flow-516f78c7
                - generic [ref=e83]: Paper Flow Demopaper-flow-516f78c7
                - generic [ref=e84]: $100 risk
              - paragraph [ref=e85]: sim trades only — safe to ignore
            - listitem [ref=e86]:
              - link "Paper Flow Demopaper-flow-ece6f26a $100 risk" [ref=e87] [cursor=pointer]:
                - /url: /agents/paper-flow-ece6f26a
                - generic [ref=e88]: Paper Flow Demopaper-flow-ece6f26a
                - generic [ref=e89]: $100 risk
              - paragraph [ref=e90]: sim trades only — safe to ignore
            - listitem [ref=e91]:
              - link "Paper Flow Demopaper-flow-f6771485 $100 risk" [ref=e92] [cursor=pointer]:
                - /url: /agents/paper-flow-f6771485
                - generic [ref=e93]: Paper Flow Demopaper-flow-f6771485
                - generic [ref=e94]: $100 risk
              - paragraph [ref=e95]: sim trades only — safe to ignore
            - listitem [ref=e96]:
              - link "Paper Flow Demopaper-flow-f630f230 $100 risk" [ref=e97] [cursor=pointer]:
                - /url: /agents/paper-flow-f630f230
                - generic [ref=e98]: Paper Flow Demopaper-flow-f630f230
                - generic [ref=e99]: $100 risk
              - paragraph [ref=e100]: sim trades only — safe to ignore
            - listitem [ref=e101]:
              - link "Nereid Scrapenereid-scrape $200 risk" [ref=e102] [cursor=pointer]:
                - /url: /agents/nereid-scrape
                - generic [ref=e103]: Nereid Scrapenereid-scrape
                - generic [ref=e104]: $200 risk
              - paragraph [ref=e105]: Harvest the time-decay premium on near-resolution binary markets. Buy the winning side at 0.95+ on near-certain markets with weeks to resolution, hold to settlement, collect the 1-5% convergence. Proven viable by wallet 0x6e1d5040 banking $2M doing exactly this.
            - listitem [ref=e106]:
              - link "Lyra Cross-Timeframelyra-cross-timeframe $50 risk" [ref=e107] [cursor=pointer]:
                - /url: /agents/lyra-cross-timeframe
                - generic [ref=e108]: Lyra Cross-Timeframelyra-cross-timeframe
                - generic [ref=e109]: $50 risk
              - paragraph [ref=e110]: Exploit the lag between short and long timeframe Polymarket crypto markets. When the 5m and 15m BTC markets diverge by ≥3 standard deviations on the rolling spread, buy the cheap side and exit on reversion. Direct adaptation of the Daniro article z-score formula.
            - listitem [ref=e111]:
              - link "Pulse Microstructurepulse-microstructure $0 risk" [ref=e112] [cursor=pointer]:
                - /url: /agents/pulse-microstructure
                - generic [ref=e113]: Pulse Microstructurepulse-microstructure
                - generic [ref=e114]: $0 risk
              - paragraph [ref=e115]: Research-only orderbook-pressure observer. Surfaces top-3 bid/ask depth imbalances ≥3:1 on active Polymarket binaries for operator review. NOT a trading agent — signals decay in seconds and our polling-based detection can't reliably capture them. Exists to feed the signal layer + agent context, not to place orders.
            - listitem [ref=e116]:
              - link "Hydra Consensushydra-consensus $100 risk" [ref=e117] [cursor=pointer]:
                - /url: /agents/hydra-consensus
                - generic [ref=e118]: Hydra Consensushydra-consensus
                - generic [ref=e119]: $100 risk
              - paragraph [ref=e120]: Act on cross-wallet consensus signals when ≥3 distinct clusters of high-trust tracked wallets agree on a market+direction within 30min. The platform's defensible edge is cross-sectional vision — one wallet can't see what other top wallets are doing in real time; we can.
            - listitem [ref=e121]:
              - link "Drift Midwindowdrift-midwindow $0 risk" [ref=e122] [cursor=pointer]:
                - /url: /agents/drift-midwindow
                - generic [ref=e123]: Drift Midwindowdrift-midwindow
                - generic [ref=e124]: $0 risk
              - paragraph [ref=e125]: Trajectory extrapolation on Polymarket 5-min crypto Up/Down binaries. Sample the first 2 min of intra-window price action; if the elapsed move is ≥1σ AND the trajectory-extrapolated final spot implies a probability ≥5pp away from the current Polymarket UP price, place a directional bet on the chosen side. Risk-budget $0 until a real-Polymarket-historicals backtest validates that the trajectory edge survives MM repricing — current crypto-only backtest only proves trajectory is informative, not that it beats the live quote.
            - listitem [ref=e126]:
              - link "Scalp Late-Windowscalp-late-window $5 risk" [ref=e127] [cursor=pointer]:
                - /url: /agents/scalp-late-window
                - generic [ref=e128]: Scalp Late-Windowscalp-late-window
                - generic [ref=e129]: $5 risk
              - paragraph [ref=e130]: "Mirror the operator's manual winning pattern on Polymarket 5m crypto Up/Down binaries: buy the heavily-favored side ($0.85-$0.98) in the last 1-3 minutes before resolution. Small bets ($2 default), high win-rate (~80% on operator's 39-trade sample). Codifies what a human is empirically doing well — the bot just systematizes it."
        - generic [ref=e131]:
          - heading "Recent trades" [level=2] [ref=e132]
          - paragraph [ref=e133]: No trades recorded yet. Once agents run, executions land here.
      - generic [ref=e134]:
        - generic [ref=e135]:
          - heading "Evolution log" [level=2] [ref=e136]
          - list [ref=e137]:
            - listitem [ref=e138]:
              - generic [ref=e139]: wallet-trade-classified
              - text: 0x53757615… BUY YES 0xfef657b2f9ed83… @ 0.090 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e140]:
              - generic [ref=e141]: wallet-trade-classified
              - text: 0x53757615… BUY SPURS 0x215be7e1cbc744… @ 0.430 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e142]:
              - generic [ref=e143]: wallet-trade-classified
              - text: 0x53757615… BUY YES 0xfef657b2f9ed83… @ 0.090 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e144]:
              - generic [ref=e145]: wallet-trade-classified
              - text: 0x53757615… BUY YES 0xfef657b2f9ed83… @ 0.092 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e146]:
              - generic [ref=e147]: wallet-trade-classified
              - text: 0x53757615… BUY SPURS 0x215be7e1cbc744… @ 0.430 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e148]:
              - generic [ref=e149]: wallet-trade-classified
              - text: 0x53757615… BUY YES 0xfef657b2f9ed83… @ 0.080 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e150]:
              - generic [ref=e151]: wallet-trade-classified
              - text: 0x53757615… BUY SPURS 0x215be7e1cbc744… @ 0.430 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e152]:
              - generic [ref=e153]: wallet-trade-classified
              - text: 0x53757615… BUY SPURS 0x215be7e1cbc744… @ 0.430 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e154]:
              - generic [ref=e155]: wallet-trade-classified
              - text: 0x53757615… BUY ANASTASIA POTAPOVA 0x1349a6b1e7e928… @ 0.350 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
            - listitem [ref=e156]:
              - generic [ref=e157]: wallet-trade-classified
              - text: 0x53757615… BUY YES 0xfef657b2f9ed83… @ 0.072 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 18:01
        - generic [ref=e158]:
          - heading "Today's PnL leaderboard (Polymarket)" [level=2] [ref=e159]
          - list [ref=e160]:
            - listitem [ref=e161]:
              - generic [ref=e162]: "#1 lovelystuff"
              - generic [ref=e163]: $3,769,456.06
            - listitem [ref=e164]:
              - generic [ref=e165]: "#2 shakendbake"
              - generic [ref=e166]: $1,271,608.555
            - listitem [ref=e167]:
              - generic [ref=e168]: "#3 newdogbeginning"
              - generic [ref=e169]: $549,602.688
            - listitem [ref=e170]:
              - generic [ref=e171]: "#4 ReCh4"
              - generic [ref=e172]: $454,800.207
            - listitem [ref=e173]:
              - generic [ref=e174]: "#5 ferrariChampions2026"
              - generic [ref=e175]: $344,746.916
  - generic [ref=e176]: TRADES — no fills yet. Random walkers + momentum agents fire as data accumulates.
  - button "Open Next.js Dev Tools" [ref=e182] [cursor=pointer]:
    - img [ref=e183]
  - alert [ref=e186]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | test.describe("Global layout (SystemStatusBar + NavMenu + TradeTicker)", () => {
  4  |   for (const path of ["/", "/arena", "/safety", "/capsules", "/crypto", "/coinbase"]) {
  5  |     test(`SystemStatusBar visible on ${path}`, async ({ page }) => {
  6  |       await page.goto(path);
> 7  |       await expect(page.getByText("SYSTEM", { exact: false })).toBeVisible();
     |                                                                ^ Error: expect(locator).toBeVisible() failed
  8  |     });
  9  |   }
  10 | 
  11 |   test("grouped nav has Markets / Arena / Capsules / Manage dropdowns", async ({ page }) => {
  12 |     await page.goto("/");
  13 |     for (const label of ["Markets", "Arena", "Capsules", "Manage"]) {
  14 |       await expect(page.locator("nav").getByRole("button", { name: new RegExp(label) })).toBeVisible();
  15 |     }
  16 |   });
  17 | 
  18 |   test("Markets dropdown opens on hover and includes Crypto link", async ({ page }) => {
  19 |     await page.goto("/");
  20 |     await page.locator("nav").getByRole("button", { name: /Markets/ }).hover();
  21 |     await expect(page.getByRole("link", { name: /Crypto live/ })).toBeVisible();
  22 |   });
  23 | 
  24 |   test("TradeTicker present at bottom of every page", async ({ page }) => {
  25 |     await page.goto("/");
  26 |     // Ticker uses one of two top-level labels: "TRADES (N)" when there are
  27 |     // fills, or "TRADES — no fills yet" when empty. Match either via .first().
  28 |     await expect(page.getByText(/^TRADES/).first()).toBeVisible();
  29 |   });
  30 | });
  31 | 
  32 | test.describe("Auto-refresh chips on live pages", () => {
  33 |   for (const path of ["/arena", "/safety", "/capsules", "/crypto"]) {
  34 |     test(`/AutoRefresh chip appears on ${path}`, async ({ page }) => {
  35 |       await page.goto(path);
  36 |       // The chip renders "⏸" then label text like "arena 30s" / "safety 30s" / "crypto 15s"
  37 |       await expect(page.locator("text=/⏸|▶/").first()).toBeVisible();
  38 |     });
  39 |   }
  40 | });
  41 | 
```