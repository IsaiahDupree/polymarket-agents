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
      - generic "Polymarket mode" [ref=e8]:
        - text: poly
        - generic [ref=e9]: DRY_RUN
      - generic "Coinbase mode" [ref=e10]:
        - text: cb
        - generic [ref=e11]: DRY_RUN
      - generic [ref=e12]: "|"
      - 'generic "PAPER: 15 capsules wired but ALLOW_TRADE unset → DRY_RUN" [ref=e13]':
        - text: 📝 $750
        - generic [ref=e14]: +$0.00
      - generic [ref=e15]: "|"
      - generic [ref=e16]: alive
      - generic [ref=e17]: "168"
      - generic "7 alive agents have an llm_probability_oracle component (Claude-driven decisions). Remaining 161 are deterministic pattern matchers." [ref=e18]: 🧠 7 AI
      - generic [ref=e19]: "|"
      - generic [ref=e20]: gen
      - generic [ref=e21]: "99"
      - generic [ref=e22]: tick
      - generic [ref=e23]: 0/50
      - generic [ref=e24]: → next evolve in 50 ticks
      - generic [ref=e25]: "|"
      - generic [ref=e26]: trades today
      - generic [ref=e27]: "0"
      - generic [ref=e28]: "|"
      - generic "markets with no snapshot in 10+ min" [ref=e29]: 2673 stale
      - generic [ref=e30]: refresh 30s · 2:01:46 PM
    - banner [ref=e31]:
      - generic [ref=e32]:
        - link "polyagents" [ref=e33] [cursor=pointer]:
          - /url: /
        - navigation [ref=e34]:
          - link "Overview" [ref=e35] [cursor=pointer]:
            - /url: /
          - button "Markets ▼" [ref=e37] [cursor=pointer]:
            - text: Markets
            - generic [ref=e38]: ▼
          - button "Arena ▼" [ref=e40] [cursor=pointer]:
            - text: Arena
            - generic [ref=e41]: ▼
          - button "Capsules ▼" [ref=e43] [cursor=pointer]:
            - text: Capsules
            - generic [ref=e44]: ▼
          - button "Manage ▼" [ref=e46] [cursor=pointer]:
            - text: Manage
            - generic [ref=e47]: ▼
  - main [ref=e48]:
    - generic [ref=e49]:
      - generic [ref=e50]:
        - heading "Control plane" [level=1] [ref=e51]
        - paragraph [ref=e52]: Local workspace for AI-agent prediction-market strategies and research.
      - generic [ref=e53]:
        - generic [ref=e54]:
          - generic [ref=e55]: Active agents
          - generic [ref=e56]: 15/15
        - generic [ref=e57]:
          - generic [ref=e58]: Strategies
          - generic [ref=e59]: "16"
        - generic [ref=e60]:
          - generic [ref=e61]: Risk budget (USD)
          - generic [ref=e62]: $2,205
        - generic [ref=e63]:
          - generic [ref=e64]: Open interest (live)
          - generic [ref=e65]: "[{\"market\":\"GLOBAL\",\"val"
      - generic [ref=e66]:
        - generic [ref=e67]:
          - heading "Agents" [level=2] [ref=e68]
          - list [ref=e69]:
            - listitem [ref=e70]:
              - link "Atlas Macroatlas-macro $500 risk" [ref=e71] [cursor=pointer]:
                - /url: /agents/atlas-macro
                - generic [ref=e72]: Atlas Macroatlas-macro
                - generic [ref=e73]: $500 risk
              - paragraph [ref=e74]: Top-down macro/politics agent. Trades long-horizon (>14d) markets where consensus has drifted from priced odds. Bias toward mean-reversion after one-sided news cycles.
            - listitem [ref=e75]:
              - link "Scribe Sportsscribe-sports $250 risk" [ref=e76] [cursor=pointer]:
                - /url: /agents/scribe-sports
                - generic [ref=e77]: Scribe Sportsscribe-sports
                - generic [ref=e78]: $250 risk
              - paragraph [ref=e79]: In-game sports agent. Pulls live odds + sports websocket signals, looks for stale-quote arbs vs. game state.
            - listitem [ref=e80]:
              - link "Oracle Researchoracle-research $0 risk" [ref=e81] [cursor=pointer]:
                - /url: /agents/oracle-research
                - generic [ref=e82]: Oracle Researchoracle-research
                - generic [ref=e83]: $0 risk
              - paragraph [ref=e84]: Slow-thinker that produces written theses + confidence scores; does not place trades directly but proposes them to other agents.
            - listitem [ref=e85]:
              - link "Ember Momentumember-momentum $300 risk" [ref=e86] [cursor=pointer]:
                - /url: /agents/ember-momentum
                - generic [ref=e87]: Ember Momentumember-momentum
                - generic [ref=e88]: $300 risk
              - paragraph [ref=e89]: Trend-follower on high-volume markets. Rides moves with strict trailing stops; designed to be the opposite of Atlas Macro for diversification.
            - listitem [ref=e90]:
              - link "Aurora Crossaurora-cross $400 risk" [ref=e91] [cursor=pointer]:
                - /url: /agents/aurora-cross
                - generic [ref=e92]: Aurora Crossaurora-cross
                - generic [ref=e93]: $400 risk
              - paragraph [ref=e94]: Cross-venue agent. Pairs Polymarket binary/scalar markets with Coinbase spot to score implied-vs-realized probability spreads. Trades both sides when EV > 1% net of fees.
            - listitem [ref=e95]:
              - link "Paper Flow Demopaper-flow-516f78c7 $100 risk" [ref=e96] [cursor=pointer]:
                - /url: /agents/paper-flow-516f78c7
                - generic [ref=e97]: Paper Flow Demopaper-flow-516f78c7
                - generic [ref=e98]: $100 risk
              - paragraph [ref=e99]: sim trades only — safe to ignore
            - listitem [ref=e100]:
              - link "Paper Flow Demopaper-flow-ece6f26a $100 risk" [ref=e101] [cursor=pointer]:
                - /url: /agents/paper-flow-ece6f26a
                - generic [ref=e102]: Paper Flow Demopaper-flow-ece6f26a
                - generic [ref=e103]: $100 risk
              - paragraph [ref=e104]: sim trades only — safe to ignore
            - listitem [ref=e105]:
              - link "Paper Flow Demopaper-flow-f6771485 $100 risk" [ref=e106] [cursor=pointer]:
                - /url: /agents/paper-flow-f6771485
                - generic [ref=e107]: Paper Flow Demopaper-flow-f6771485
                - generic [ref=e108]: $100 risk
              - paragraph [ref=e109]: sim trades only — safe to ignore
            - listitem [ref=e110]:
              - link "Paper Flow Demopaper-flow-f630f230 $100 risk" [ref=e111] [cursor=pointer]:
                - /url: /agents/paper-flow-f630f230
                - generic [ref=e112]: Paper Flow Demopaper-flow-f630f230
                - generic [ref=e113]: $100 risk
              - paragraph [ref=e114]: sim trades only — safe to ignore
            - listitem [ref=e115]:
              - link "Nereid Scrapenereid-scrape $200 risk" [ref=e116] [cursor=pointer]:
                - /url: /agents/nereid-scrape
                - generic [ref=e117]: Nereid Scrapenereid-scrape
                - generic [ref=e118]: $200 risk
              - paragraph [ref=e119]: Harvest the time-decay premium on near-resolution binary markets. Buy the winning side at 0.95+ on near-certain markets with weeks to resolution, hold to settlement, collect the 1-5% convergence. Proven viable by wallet 0x6e1d5040 banking $2M doing exactly this.
            - listitem [ref=e120]:
              - link "Lyra Cross-Timeframelyra-cross-timeframe $50 risk" [ref=e121] [cursor=pointer]:
                - /url: /agents/lyra-cross-timeframe
                - generic [ref=e122]: Lyra Cross-Timeframelyra-cross-timeframe
                - generic [ref=e123]: $50 risk
              - paragraph [ref=e124]: Exploit the lag between short and long timeframe Polymarket crypto markets. When the 5m and 15m BTC markets diverge by ≥3 standard deviations on the rolling spread, buy the cheap side and exit on reversion. Direct adaptation of the Daniro article z-score formula.
            - listitem [ref=e125]:
              - link "Pulse Microstructurepulse-microstructure $0 risk" [ref=e126] [cursor=pointer]:
                - /url: /agents/pulse-microstructure
                - generic [ref=e127]: Pulse Microstructurepulse-microstructure
                - generic [ref=e128]: $0 risk
              - paragraph [ref=e129]: Research-only orderbook-pressure observer. Surfaces top-3 bid/ask depth imbalances ≥3:1 on active Polymarket binaries for operator review. NOT a trading agent — signals decay in seconds and our polling-based detection can't reliably capture them. Exists to feed the signal layer + agent context, not to place orders.
            - listitem [ref=e130]:
              - link "Hydra Consensushydra-consensus $100 risk" [ref=e131] [cursor=pointer]:
                - /url: /agents/hydra-consensus
                - generic [ref=e132]: Hydra Consensushydra-consensus
                - generic [ref=e133]: $100 risk
              - paragraph [ref=e134]: Act on cross-wallet consensus signals when ≥3 distinct clusters of high-trust tracked wallets agree on a market+direction within 30min. The platform's defensible edge is cross-sectional vision — one wallet can't see what other top wallets are doing in real time; we can.
            - listitem [ref=e135]:
              - link "Drift Midwindowdrift-midwindow $0 risk" [ref=e136] [cursor=pointer]:
                - /url: /agents/drift-midwindow
                - generic [ref=e137]: Drift Midwindowdrift-midwindow
                - generic [ref=e138]: $0 risk
              - paragraph [ref=e139]: Trajectory extrapolation on Polymarket 5-min crypto Up/Down binaries. Sample the first 2 min of intra-window price action; if the elapsed move is ≥1σ AND the trajectory-extrapolated final spot implies a probability ≥5pp away from the current Polymarket UP price, place a directional bet on the chosen side. Risk-budget $0 until a real-Polymarket-historicals backtest validates that the trajectory edge survives MM repricing — current crypto-only backtest only proves trajectory is informative, not that it beats the live quote.
            - listitem [ref=e140]:
              - link "Scalp Late-Windowscalp-late-window $5 risk" [ref=e141] [cursor=pointer]:
                - /url: /agents/scalp-late-window
                - generic [ref=e142]: Scalp Late-Windowscalp-late-window
                - generic [ref=e143]: $5 risk
              - paragraph [ref=e144]: "Mirror the operator's manual winning pattern on Polymarket 5m crypto Up/Down binaries: buy the heavily-favored side ($0.85-$0.98) in the last 1-3 minutes before resolution. Small bets ($2 default), high win-rate (~80% on operator's 39-trade sample). Codifies what a human is empirically doing well — the bot just systematizes it."
        - generic [ref=e145]:
          - heading "Recent trades" [level=2] [ref=e146]
          - paragraph [ref=e147]: No trades recorded yet. Once agents run, executions land here.
      - generic [ref=e148]:
        - generic [ref=e149]:
          - heading "Evolution log" [level=2] [ref=e150]
          - list [ref=e151]:
            - listitem [ref=e152]:
              - generic [ref=e153]: realtime-heartbeat
              - text: WS connected=true activity+2814/30s crypto+659092026-05-30 18:01
            - listitem [ref=e154]:
              - generic [ref=e155]: realtime-heartbeat
              - text: WS connected=true activity+3256/30s crypto+658892026-05-30 18:00
            - listitem [ref=e156]:
              - generic [ref=e157]: realtime-heartbeat
              - text: WS connected=true activity+3586/30s crypto+658702026-05-30 18:00
            - listitem [ref=e158]:
              - generic [ref=e159]: realtime-heartbeat
              - text: WS connected=true activity+3486/30s crypto+658492026-05-30 17:59
            - listitem [ref=e160]:
              - generic [ref=e161]: realtime-heartbeat
              - text: WS connected=true activity+2809/30s crypto+658312026-05-30 17:59
            - listitem [ref=e162]:
              - generic [ref=e163]: realtime-heartbeat
              - text: WS connected=true activity+2121/30s crypto+658112026-05-30 17:58
            - listitem [ref=e164]:
              - generic [ref=e165]: realtime-heartbeat
              - text: WS connected=true activity+2861/30s crypto+657922026-05-30 17:58
            - listitem [ref=e166]:
              - generic [ref=e167]: wallet-trade-classified
              - text: 0x53757615… BUY YES 0xfef657b2f9ed83… @ 0.160 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 17:57
            - listitem [ref=e168]:
              - generic [ref=e169]: wallet-trade-classified
              - text: 0x53757615… BUY SPURS 0x215be7e1cbc744… @ 0.430 • scheduled / routine (in peak window @ 17:00 UTC ±2h, normal size) • intent=basket_rotation2026-05-30 17:57
            - listitem [ref=e170]:
              - generic [ref=e171]: realtime-heartbeat
              - text: WS connected=true activity+2442/30s crypto+657742026-05-30 17:57
        - generic [ref=e172]:
          - heading "Today's PnL leaderboard (Polymarket)" [level=2] [ref=e173]
          - list [ref=e174]:
            - listitem [ref=e175]:
              - generic [ref=e176]: "#1 lovelystuff"
              - generic [ref=e177]: $3,769,456.06
            - listitem [ref=e178]:
              - generic [ref=e179]: "#2 shakendbake"
              - generic [ref=e180]: $1,271,608.555
            - listitem [ref=e181]:
              - generic [ref=e182]: "#3 newdogbeginning"
              - generic [ref=e183]: $549,602.688
            - listitem [ref=e184]:
              - generic [ref=e185]: "#4 ReCh4"
              - generic [ref=e186]: $454,800.207
            - listitem [ref=e187]:
              - generic [ref=e188]: "#5 ferrariChampions2026"
              - generic [ref=e189]: $344,746.916
  - generic [ref=e191]:
    - generic [ref=e192]: TRADES (12)
    - generic [ref=e194]:
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e195] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e196]: entry/SELL
        - generic [ref=e197]: poly:17172924
        - generic [ref=e198]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e199] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e200]: entry/SELL
        - generic [ref=e201]: poly:10164958
        - generic [ref=e202]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e203] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e204]: entry/SELL
        - generic [ref=e205]: poly:84871768
        - generic [ref=e206]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e207] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e208]: entry/BUY
        - generic [ref=e209]: poly:10963197
        - generic [ref=e210]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e211] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e212]: entry/SELL
        - generic [ref=e213]: poly:10164958
        - generic [ref=e214]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e215] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e216]: entry/BUY
        - generic [ref=e217]: poly:49014332
        - generic [ref=e218]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e219] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e220]: entry/BUY
        - generic [ref=e221]: poly:20447903
        - generic [ref=e222]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e223] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e224]: entry/SELL
        - generic [ref=e225]: poly:15962792
        - generic [ref=e226]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e227] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e228]: entry/BUY
        - generic [ref=e229]: poly:51183104
        - generic [ref=e230]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e231] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e232]: entry/BUY
        - generic [ref=e233]: poly:98733003
        - generic [ref=e234]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e235] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e236]: entry/BUY
        - generic [ref=e237]: poly:66651858
        - generic [ref=e238]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e239] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e240]: entry/BUY
        - generic [ref=e241]: poly:89717335
        - generic [ref=e242]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e243] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e244]: entry/SELL
        - generic [ref=e245]: poly:17172924
        - generic [ref=e246]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e247] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e248]: entry/SELL
        - generic [ref=e249]: poly:10164958
        - generic [ref=e250]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e251] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e252]: entry/SELL
        - generic [ref=e253]: poly:84871768
        - generic [ref=e254]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e255] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e256]: entry/BUY
        - generic [ref=e257]: poly:10963197
        - generic [ref=e258]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e259] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e260]: entry/SELL
        - generic [ref=e261]: poly:10164958
        - generic [ref=e262]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e263] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e264]: entry/BUY
        - generic [ref=e265]: poly:49014332
        - generic [ref=e266]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e267] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e268]: entry/BUY
        - generic [ref=e269]: poly:20447903
        - generic [ref=e270]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e271] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e272]: entry/SELL
        - generic [ref=e273]: poly:15962792
        - generic [ref=e274]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e275] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e276]: entry/BUY
        - generic [ref=e277]: poly:51183104
        - generic [ref=e278]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e279] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e280]: entry/BUY
        - generic [ref=e281]: poly:98733003
        - generic [ref=e282]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e283] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e284]: entry/BUY
        - generic [ref=e285]: poly:66651858
        - generic [ref=e286]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e287] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e288]: entry/BUY
        - generic [ref=e289]: poly:89717335
        - generic [ref=e290]: $0.00
        - text: ◆
  - button "Open Next.js Dev Tools" [ref=e296] [cursor=pointer]:
    - img [ref=e297]
  - alert [ref=e300]
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