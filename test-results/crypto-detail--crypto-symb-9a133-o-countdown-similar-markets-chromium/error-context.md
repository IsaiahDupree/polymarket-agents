# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crypto-detail.spec.ts >> /crypto/[symbol] — Polymarket-faithful deep-dive >> /crypto/XRP-USD renders hero + countdown + similar markets
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
      - generic "markets with no snapshot in 10+ min" [ref=e23]: 2680 stale
      - generic [ref=e24]: refresh 30s · 1:38:22 PM
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
        - generic [ref=e46]: xrp 15s
      - link "← back to all crypto markets" [ref=e48] [cursor=pointer]:
        - /url: /crypto
      - generic [ref=e49]:
        - generic [ref=e50]:
          - generic [ref=e51]:
            - generic [ref=e52]:
              - generic [ref=e53]: XRP
              - generic [ref=e54]:
                - heading "XRP Up or Down 5m" [level=1] [ref=e55]
                - generic [ref=e56]:
                  - generic [ref=e57]: May 30, 1:35PM-1:40PM
                  - text: ET
            - generic [ref=e58]:
              - generic [ref=e59]:
                - generic [ref=e60]: Price To Beat
                - generic [ref=e61]: $1.35
              - generic [ref=e62]:
                - generic [ref=e63]: Current Price
                - generic [ref=e64]: $––,––
                - generic [ref=e65]: $-0.00 (-0.275%)
          - generic [ref=e66]:
            - generic [ref=e67]: Time remaining
            - generic [ref=e69]:
              - generic [ref=e70]: "01"
              - generic [ref=e71]: mins
              - generic [ref=e72]: "34"
              - generic [ref=e73]: secs
            - generic [ref=e74]:
              - text: "data:"
              - generic [ref=e75]: Coinbase XRP-USD
              - generic [ref=e76]: · 7m ago
            - generic [ref=e77]: window auto-rolls every 5m
        - generic [ref=e78]:
          - generic [ref=e79]:
            - heading "Recent windows (close − open per window)" [level=3] [ref=e80]
            - generic [ref=e81]: last 9 × 5m
          - img [ref=e82]:
            - 'generic "12:45PM: $+0.00" [ref=e83]'
            - 'generic "12:50PM: $+0.00" [ref=e85]'
            - 'generic "12:55PM: $+0.00" [ref=e87]'
            - 'generic "1:00PM: $+0.00" [ref=e89]'
            - 'generic "1:05PM: $-0.00" [ref=e91]'
            - 'generic "1:10PM: $+0.00" [ref=e93]'
            - 'generic "1:15PM: $+0.00" [ref=e95]'
            - 'generic "1:20PM: $+0.00" [ref=e97]'
            - 'generic "1:25PM: $-0.00" [ref=e99]'
          - generic [ref=e101]:
            - generic [ref=e102]: 12:45PM
            - generic [ref=e103]: 1:05PM
            - generic [ref=e104]: 1:25PM
      - generic [ref=e105]:
        - generic [ref=e106]:
          - generic [ref=e107]:
            - heading "Our Up estimate (next 5m)" [level=3] [ref=e108]
            - generic [ref=e109]:
              - generic [ref=e110]:
                - generic [ref=e111]: Implied prob (Up)
                - generic [ref=e112]: 16%
              - generic [ref=e113]:
                - generic [ref=e114]: 5-min velocity
                - generic [ref=e115]: "-0.275%"
              - generic [ref=e116]:
                - generic [ref=e117]: Acceleration
                - generic [ref=e118]: "-0.008%"
            - paragraph [ref=e119]: Naïve logistic on 5-min velocity. ±0.5% velocity ⇒ ~95% confidence. Replace with a Black-Scholes prob(end > start | T, σ) once Chainlink stream is plumbed.
          - generic [ref=e120]:
            - heading "How this market resolves" [level=3] [ref=e121]
            - paragraph [ref=e122]:
              - text: This market resolves to
              - strong [ref=e123]: Up
              - text: if the XRP price at the end of the window is greater than or equal to the price at the beginning, otherwise
              - strong [ref=e124]: Down
              - text: .
            - paragraph [ref=e125]:
              - strong [ref=e126]: Polymarket's settlement source
              - text: is the
              - link "Chainlink XRP/USD data stream" [ref=e127] [cursor=pointer]:
                - /url: https://data.chain.link/streams/btc-usd
              - text: .
              - strong [ref=e128]: Our truth source
              - text: for live signals on this page is the Coinbase spot ticker for
              - code [ref=e129]: XRP-USD
              - text: (1-min candles via
              - code [ref=e130]: publicGetProductCandles
              - text: ). They generally track within a few cents, but for serious live trading you should subscribe to the same Chainlink stream Polymarket settles from to remove the basis risk between Coinbase last-trade and Chainlink composite.
            - paragraph [ref=e131]: Live data may be delayed by a few seconds and can be influenced by price activity on other exchanges and broader market conditions.
          - generic [ref=e132]:
            - heading "What an arena agent would do this tick" [level=3] [ref=e133]
            - paragraph [ref=e134]:
              - text: The momentum-burst genome (kind=
              - code [ref=e135]: cb_momentum_burst
              - text: ) would fire if velocity ≥
              - code [ref=e136]: vel_entry_pct
              - text: AND acceleration ≥
              - code [ref=e137]: accel_min
              - text: . Below — given current signal, here's the verdict.
            - generic [ref=e138]:
              - generic [ref=e139]: "Long: skip"
              - generic [ref=e140]: "Short: skip"
            - link "→ See live arena leaderboard" [ref=e141] [cursor=pointer]:
              - /url: /arena
        - complementary [ref=e142]:
          - generic [ref=e143]:
            - heading "Similar markets" [level=3] [ref=e144]
            - list [ref=e145]:
              - listitem [ref=e146]:
                - link "Bitcoin Up or Down — 5 Min 32% Up" [ref=e147] [cursor=pointer]:
                  - /url: /crypto/BTC-USD
                  - generic [ref=e148]: Bitcoin Up or Down — 5 Min
                  - generic [ref=e149]:
                    - generic [ref=e150]: 32%
                    - generic [ref=e151]: Up
              - listitem [ref=e152]:
                - link "Ethereum Up or Down — 5 Min 19% Up" [ref=e153] [cursor=pointer]:
                  - /url: /crypto/ETH-USD
                  - generic [ref=e154]: Ethereum Up or Down — 5 Min
                  - generic [ref=e155]:
                    - generic [ref=e156]: 19%
                    - generic [ref=e157]: Up
              - listitem [ref=e158]:
                - link "Solana Up or Down — 5 Min 20% Up" [ref=e159] [cursor=pointer]:
                  - /url: /crypto/SOL-USD
                  - generic [ref=e160]: Solana Up or Down — 5 Min
                  - generic [ref=e161]:
                    - generic [ref=e162]: 20%
                    - generic [ref=e163]: Up
              - listitem [ref=e164]:
                - link "Dogecoin Up or Down — 5 Min 23% Up" [ref=e165] [cursor=pointer]:
                  - /url: /crypto/DOGE-USD
                  - generic [ref=e166]: Dogecoin Up or Down — 5 Min
                  - generic [ref=e167]:
                    - generic [ref=e168]: 23%
                    - generic [ref=e169]: Up
          - generic [ref=e170]:
            - generic [ref=e171]: Status
            - generic [ref=e172]:
              - generic [ref=e173]: XRP Up or Down 5m
              - generic [ref=e174]: Down
            - button "One-tap buy (arena agents only)" [disabled] [ref=e175]
            - paragraph [ref=e176]:
              - text: Manual entry intentionally disabled. Live fills come from arena agents bound to a capsule via the unified ExecutionRouter — gated by
              - code [ref=e177]: COINBASE_ALLOW_TRADE=1
              - text: + per-trade caps.
  - generic [ref=e179]:
    - generic [ref=e180]: TRADES (12)
    - generic [ref=e182]:
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e183] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e184]: entry/SELL
        - generic [ref=e185]: poly:17172924
        - generic [ref=e186]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e187] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e188]: entry/SELL
        - generic [ref=e189]: poly:10164958
        - generic [ref=e190]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e191] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e192]: entry/SELL
        - generic [ref=e193]: poly:84871768
        - generic [ref=e194]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e195] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e196]: entry/BUY
        - generic [ref=e197]: poly:10963197
        - generic [ref=e198]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e199] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e200]: entry/SELL
        - generic [ref=e201]: poly:10164958
        - generic [ref=e202]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e203] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e204]: entry/BUY
        - generic [ref=e205]: poly:49014332
        - generic [ref=e206]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e207] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e208]: entry/BUY
        - generic [ref=e209]: poly:20447903
        - generic [ref=e210]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e211] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e212]: entry/SELL
        - generic [ref=e213]: poly:15962792
        - generic [ref=e214]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e215] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e216]: entry/BUY
        - generic [ref=e217]: poly:51183104
        - generic [ref=e218]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e219] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e220]: entry/BUY
        - generic [ref=e221]: poly:98733003
        - generic [ref=e222]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e223] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e224]: entry/BUY
        - generic [ref=e225]: poly:66651858
        - generic [ref=e226]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e227] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e228]: entry/BUY
        - generic [ref=e229]: poly:89717335
        - generic [ref=e230]: $0.00
        - text: ◆
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
  - button "Open Next.js Dev Tools" [ref=e284] [cursor=pointer]:
    - img [ref=e285]
  - alert [ref=e288]
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