# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crypto-detail.spec.ts >> /crypto/[symbol] — Polymarket-faithful deep-dive >> /crypto/SOL-USD renders hero + countdown + similar markets
- Location: tests\ui\crypto-detail.spec.ts:7:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('digit-roller').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('digit-roller').first()

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
      - generic [ref=e20]: trades today
      - generic [ref=e21]: "0"
      - generic [ref=e22]: "|"
      - generic "markets with no snapshot in 10+ min" [ref=e23]: 2673 stale
      - generic [ref=e24]: refresh 30s · 1:35:38 PM
    - banner [ref=e25]:
      - generic [ref=e26]:
        - link "polyagents" [ref=e27] [cursor=pointer]:
          - /url: /
        - navigation [ref=e28]:
          - link "Overview" [ref=e29] [cursor=pointer]:
            - /url: /
          - button "Markets ▼" [ref=e31] [cursor=pointer]:
            - text: Markets
            - generic [ref=e32]: ▼
          - button "Arena ▼" [ref=e34] [cursor=pointer]:
            - text: Arena
            - generic [ref=e35]: ▼
          - button "Capsules ▼" [ref=e37] [cursor=pointer]:
            - text: Capsules
            - generic [ref=e38]: ▼
          - button "Manage ▼" [ref=e40] [cursor=pointer]:
            - text: Manage
            - generic [ref=e41]: ▼
  - main [ref=e42]:
    - generic [ref=e43]:
      - generic [ref=e44]:
        - button "⏸" [ref=e45] [cursor=pointer]
        - generic [ref=e46]: sol 15s
      - link "← back to all crypto markets" [ref=e48] [cursor=pointer]:
        - /url: /crypto
      - generic [ref=e49]:
        - generic [ref=e50]:
          - generic [ref=e51]:
            - generic [ref=e52]:
              - generic [ref=e53]: SOL
              - generic [ref=e54]:
                - heading "SOL Up or Down 5m" [level=1] [ref=e55]
                - generic [ref=e56]:
                  - generic [ref=e57]: May 30, 1:35PM-1:40PM
                  - text: ET
            - generic [ref=e58]:
              - generic [ref=e59]:
                - generic [ref=e60]: Price To Beat
                - generic [ref=e61]: $82.8
              - generic [ref=e62]:
                - generic [ref=e63]: Current Price
                - generic [ref=e66]:
                  - generic [ref=e67]: $
                  - generic "8" [ref=e68]:
                    - generic [ref=e69]:
                      - generic [ref=e70]: "0"
                      - generic [ref=e71]: "1"
                      - generic [ref=e72]: "2"
                      - generic [ref=e73]: "3"
                      - generic [ref=e74]: "4"
                      - generic [ref=e75]: "5"
                      - generic [ref=e76]: "6"
                      - generic [ref=e77]: "7"
                      - generic [ref=e78]: "8"
                      - generic [ref=e79]: "9"
                  - generic "2" [ref=e80]:
                    - generic [ref=e81]:
                      - generic [ref=e82]: "0"
                      - generic [ref=e83]: "1"
                      - generic [ref=e84]: "2"
                      - generic [ref=e85]: "3"
                      - generic [ref=e86]: "4"
                      - generic [ref=e87]: "5"
                      - generic [ref=e88]: "6"
                      - generic [ref=e89]: "7"
                      - generic [ref=e90]: "8"
                      - generic [ref=e91]: "9"
                  - generic [ref=e92]: .
                  - generic "6" [ref=e93]:
                    - generic [ref=e94]:
                      - generic [ref=e95]: "0"
                      - generic [ref=e96]: "1"
                      - generic [ref=e97]: "2"
                      - generic [ref=e98]: "3"
                      - generic [ref=e99]: "4"
                      - generic [ref=e100]: "5"
                      - generic [ref=e101]: "6"
                      - generic [ref=e102]: "7"
                      - generic [ref=e103]: "8"
                      - generic [ref=e104]: "9"
                  - generic "1" [ref=e105]:
                    - generic [ref=e106]:
                      - generic [ref=e107]: "0"
                      - generic [ref=e108]: "1"
                      - generic [ref=e109]: "2"
                      - generic [ref=e110]: "3"
                      - generic [ref=e111]: "4"
                      - generic [ref=e112]: "5"
                      - generic [ref=e113]: "6"
                      - generic [ref=e114]: "7"
                      - generic [ref=e115]: "8"
                      - generic [ref=e116]: "9"
                - generic [ref=e117]: $-0.19 (-0.229%)
          - generic [ref=e118]:
            - generic [ref=e119]: Time remaining
            - generic [ref=e121]:
              - generic [ref=e122]: "04"
              - generic [ref=e123]: mins
              - generic [ref=e124]: "21"
              - generic [ref=e125]: secs
            - generic [ref=e126]:
              - text: "data:"
              - generic [ref=e127]: Coinbase SOL-USD
              - generic [ref=e128]: · 4m ago
            - generic [ref=e129]: window auto-rolls every 5m
        - generic [ref=e130]:
          - generic [ref=e131]:
            - heading "Recent windows (close − open per window)" [level=3] [ref=e132]
            - generic [ref=e133]: last 9 × 5m
          - img [ref=e134]:
            - 'generic "12:45PM: $+0.00"'
            - 'generic "12:50PM: $+0.01" [ref=e135]'
            - 'generic "12:55PM: $+0.03" [ref=e137]'
            - 'generic "1:00PM: $+0.04" [ref=e139]'
            - 'generic "1:05PM: $-0.10" [ref=e141]'
            - 'generic "1:10PM: $+0.04" [ref=e143]'
            - 'generic "1:15PM: $+0.00"'
            - 'generic "1:20PM: $+0.08" [ref=e145]'
            - 'generic "1:25PM: $-0.08" [ref=e147]'
          - generic [ref=e149]:
            - generic [ref=e150]: 12:45PM
            - generic [ref=e151]: 1:05PM
            - generic [ref=e152]: 1:25PM
      - generic [ref=e153]:
        - generic [ref=e154]:
          - generic [ref=e155]:
            - heading "Our Up estimate (next 5m)" [level=3] [ref=e156]
            - generic [ref=e157]:
              - generic [ref=e158]:
                - generic [ref=e159]: Implied prob (Up)
                - generic [ref=e160]: 20%
              - generic [ref=e161]:
                - generic [ref=e162]: 5-min velocity
                - generic [ref=e163]: "-0.229%"
              - generic [ref=e164]:
                - generic [ref=e165]: Acceleration
                - generic [ref=e166]: "-0.181%"
            - paragraph [ref=e167]: Naïve logistic on 5-min velocity. ±0.5% velocity ⇒ ~95% confidence. Replace with a Black-Scholes prob(end > start | T, σ) once Chainlink stream is plumbed.
          - generic [ref=e168]:
            - heading "How this market resolves" [level=3] [ref=e169]
            - paragraph [ref=e170]:
              - text: This market resolves to
              - strong [ref=e171]: Up
              - text: if the Solana price at the end of the window is greater than or equal to the price at the beginning, otherwise
              - strong [ref=e172]: Down
              - text: .
            - paragraph [ref=e173]:
              - strong [ref=e174]: Polymarket's settlement source
              - text: is the
              - link "Chainlink SOL/USD data stream" [ref=e175] [cursor=pointer]:
                - /url: https://data.chain.link/streams/btc-usd
              - text: .
              - strong [ref=e176]: Our truth source
              - text: for live signals on this page is the Coinbase spot ticker for
              - code [ref=e177]: SOL-USD
              - text: (1-min candles via
              - code [ref=e178]: publicGetProductCandles
              - text: ). They generally track within a few cents, but for serious live trading you should subscribe to the same Chainlink stream Polymarket settles from to remove the basis risk between Coinbase last-trade and Chainlink composite.
            - paragraph [ref=e179]: Live data may be delayed by a few seconds and can be influenced by price activity on other exchanges and broader market conditions.
          - generic [ref=e180]:
            - heading "What an arena agent would do this tick" [level=3] [ref=e181]
            - paragraph [ref=e182]:
              - text: The momentum-burst genome (kind=
              - code [ref=e183]: cb_momentum_burst
              - text: ) would fire if velocity ≥
              - code [ref=e184]: vel_entry_pct
              - text: AND acceleration ≥
              - code [ref=e185]: accel_min
              - text: . Below — given current signal, here's the verdict.
            - generic [ref=e186]:
              - generic [ref=e187]: "Long: skip"
              - generic [ref=e188]: "Short: FIRE"
            - link "→ See live arena leaderboard" [ref=e189] [cursor=pointer]:
              - /url: /arena
        - complementary [ref=e190]:
          - generic [ref=e191]:
            - heading "Similar markets" [level=3] [ref=e192]
            - list [ref=e193]:
              - listitem [ref=e194]:
                - link "Bitcoin Up or Down — 5 Min 32% Up" [ref=e195] [cursor=pointer]:
                  - /url: /crypto/BTC-USD
                  - generic [ref=e196]: Bitcoin Up or Down — 5 Min
                  - generic [ref=e197]:
                    - generic [ref=e198]: 32%
                    - generic [ref=e199]: Up
              - listitem [ref=e200]:
                - link "Ethereum Up or Down — 5 Min 19% Up" [ref=e201] [cursor=pointer]:
                  - /url: /crypto/ETH-USD
                  - generic [ref=e202]: Ethereum Up or Down — 5 Min
                  - generic [ref=e203]:
                    - generic [ref=e204]: 19%
                    - generic [ref=e205]: Up
              - listitem [ref=e206]:
                - link "XRP Up or Down — 5 Min 16% Up" [ref=e207] [cursor=pointer]:
                  - /url: /crypto/XRP-USD
                  - generic [ref=e208]: XRP Up or Down — 5 Min
                  - generic [ref=e209]:
                    - generic [ref=e210]: 16%
                    - generic [ref=e211]: Up
              - listitem [ref=e212]:
                - link "Dogecoin Up or Down — 5 Min 23% Up" [ref=e213] [cursor=pointer]:
                  - /url: /crypto/DOGE-USD
                  - generic [ref=e214]: Dogecoin Up or Down — 5 Min
                  - generic [ref=e215]:
                    - generic [ref=e216]: 23%
                    - generic [ref=e217]: Up
          - generic [ref=e218]:
            - generic [ref=e219]: Status
            - generic [ref=e220]:
              - generic [ref=e221]: SOL Up or Down 5m
              - generic [ref=e222]: Down
            - button "One-tap buy (arena agents only)" [disabled] [ref=e223]
            - paragraph [ref=e224]:
              - text: Manual entry intentionally disabled. Live fills come from arena agents bound to a capsule via the unified ExecutionRouter — gated by
              - code [ref=e225]: COINBASE_ALLOW_TRADE=1
              - text: + per-trade caps.
  - generic [ref=e227]:
    - generic [ref=e228]: TRADES (12)
    - generic [ref=e230]:
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e231] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e232]: entry/SELL
        - generic [ref=e233]: poly:17172924
        - generic [ref=e234]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e235] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e236]: entry/SELL
        - generic [ref=e237]: poly:10164958
        - generic [ref=e238]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e239] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e240]: entry/SELL
        - generic [ref=e241]: poly:84871768
        - generic [ref=e242]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e243] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e244]: entry/BUY
        - generic [ref=e245]: poly:10963197
        - generic [ref=e246]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e247] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e248]: entry/SELL
        - generic [ref=e249]: poly:10164958
        - generic [ref=e250]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e251] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e252]: entry/BUY
        - generic [ref=e253]: poly:49014332
        - generic [ref=e254]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e255] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e256]: entry/BUY
        - generic [ref=e257]: poly:20447903
        - generic [ref=e258]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e259] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e260]: entry/SELL
        - generic [ref=e261]: poly:15962792
        - generic [ref=e262]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e263] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e264]: entry/BUY
        - generic [ref=e265]: poly:51183104
        - generic [ref=e266]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e267] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e268]: entry/BUY
        - generic [ref=e269]: poly:98733003
        - generic [ref=e270]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e271] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e272]: entry/BUY
        - generic [ref=e273]: poly:66651858
        - generic [ref=e274]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e275] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e276]: entry/BUY
        - generic [ref=e277]: poly:89717335
        - generic [ref=e278]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e279] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e280]: entry/SELL
        - generic [ref=e281]: poly:17172924
        - generic [ref=e282]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e283] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e284]: entry/SELL
        - generic [ref=e285]: poly:10164958
        - generic [ref=e286]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e287] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e288]: entry/SELL
        - generic [ref=e289]: poly:84871768
        - generic [ref=e290]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e291] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e292]: entry/BUY
        - generic [ref=e293]: poly:10963197
        - generic [ref=e294]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e295] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e296]: entry/SELL
        - generic [ref=e297]: poly:10164958
        - generic [ref=e298]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e299] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e300]: entry/BUY
        - generic [ref=e301]: poly:49014332
        - generic [ref=e302]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e303] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e304]: entry/BUY
        - generic [ref=e305]: poly:20447903
        - generic [ref=e306]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e307] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e308]: entry/SELL
        - generic [ref=e309]: poly:15962792
        - generic [ref=e310]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e311] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e312]: entry/BUY
        - generic [ref=e313]: poly:51183104
        - generic [ref=e314]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e315] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e316]: entry/BUY
        - generic [ref=e317]: poly:98733003
        - generic [ref=e318]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e319] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e320]: entry/BUY
        - generic [ref=e321]: poly:66651858
        - generic [ref=e322]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e323] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e324]: entry/BUY
        - generic [ref=e325]: poly:89717335
        - generic [ref=e326]: $0.00
        - text: ◆
  - button "Open Next.js Dev Tools" [ref=e332] [cursor=pointer]:
    - img [ref=e333]
  - alert [ref=e336]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | const PRODUCTS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"];
  4  | 
  5  | test.describe("/crypto/[symbol] — Polymarket-faithful deep-dive", () => {
  6  |   for (const pid of PRODUCTS) {
  7  |     test(`/crypto/${pid} renders hero + countdown + similar markets`, async ({ page }) => {
  8  |       await page.goto(`/crypto/${pid}`);
  9  |       const sym = pid.split("-")[0];
  10 | 
  11 |       // Header — symbol pill + market title
  12 |       await expect(page.locator("h1")).toContainText(`${sym} Up or Down 5m`);
  13 | 
  14 |       // Price To Beat + Current Price prominently labeled
  15 |       await expect(page.getByText("Price To Beat")).toBeVisible();
  16 |       await expect(page.getByText("Current Price")).toBeVisible();
  17 | 
  18 |       // Mins:Secs big countdown visible
  19 |       await expect(page.getByTestId("live-countdown-secs").first()).toBeVisible();
  20 | 
  21 |       // Digit roller renders the current price
> 22 |       await expect(page.getByTestId("digit-roller").first()).toBeVisible();
     |                                                              ^ Error: expect(locator).toBeVisible() failed
  23 | 
  24 |       // Resolution explainer
  25 |       await expect(page.getByText("How this market resolves")).toBeVisible();
  26 |       // "Chainlink" appears in both prose and the link — use the link for unambiguous match.
  27 |       await expect(page.getByRole("link", { name: /Chainlink/ })).toBeVisible();
  28 | 
  29 |       // Similar markets sidebar — should NOT include the current symbol but should
  30 |       // include each of the other 4.
  31 |       const sidebar = page.getByText("Similar markets").locator("..");
  32 |       await expect(sidebar).toBeVisible();
  33 |       for (const other of PRODUCTS.filter((p) => p !== pid)) {
  34 |         const otherSym = other.split("-")[0];
  35 |         const fullName = otherSym === "BTC" ? "Bitcoin"
  36 |           : otherSym === "ETH" ? "Ethereum"
  37 |           : otherSym === "SOL" ? "Solana"
  38 |           : otherSym === "XRP" ? "XRP"
  39 |           : otherSym === "DOGE" ? "Dogecoin" : otherSym;
  40 |         await expect(page.getByRole("link", { name: new RegExp(`${fullName}.*Up or Down`) })).toBeVisible();
  41 |       }
  42 | 
  43 |       // "One-tap buy" button matches Polymarket layout (disabled in our build)
  44 |       await expect(page.getByRole("button", { name: /One-tap buy/ })).toBeVisible();
  45 |     });
  46 |   }
  47 | 
  48 |   test("/crypto/UNKNOWN returns 404", async ({ page }) => {
  49 |     const r = await page.goto("/crypto/NOTAREALSYMBOL");
  50 |     expect(r?.status()).toBe(404);
  51 |   });
  52 | 
  53 |   test("countdown digit ticks on the deep-dive page too", async ({ page }) => {
  54 |     await page.goto("/crypto/BTC-USD");
  55 |     const secs = page.getByTestId("live-countdown-secs").first();
  56 |     await expect(secs).toBeVisible();
  57 |     const before = (await secs.textContent()) ?? "";
  58 |     await page.waitForTimeout(2200);
  59 |     const after = (await secs.textContent()) ?? "";
  60 |     expect(before).not.toBe(after);
  61 |   });
  62 | });
  63 | 
```