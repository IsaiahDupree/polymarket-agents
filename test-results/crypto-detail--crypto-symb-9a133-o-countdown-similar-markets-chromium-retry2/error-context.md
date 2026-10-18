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
      - generic [ref=e24]: refresh 30s · 1:41:10 PM
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
                  - generic [ref=e57]: May 30, 1:40PM-1:45PM
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
              - generic [ref=e70]: "03"
              - generic [ref=e71]: mins
              - generic [ref=e72]: "47"
              - generic [ref=e73]: secs
            - generic [ref=e74]:
              - text: "data:"
              - generic [ref=e75]: Coinbase XRP-USD
              - generic [ref=e76]: · 9m ago
            - generic [ref=e77]: window auto-rolls every 5m
        - generic [ref=e78]:
          - generic [ref=e79]:
            - heading "Recent windows (close − open per window)" [level=3] [ref=e80]
            - generic [ref=e81]: last 8 × 5m
          - img [ref=e82]:
            - 'generic "12:50PM: $+0.00" [ref=e83]'
            - 'generic "12:55PM: $+0.00" [ref=e85]'
            - 'generic "1:00PM: $+0.00" [ref=e87]'
            - 'generic "1:05PM: $-0.00" [ref=e89]'
            - 'generic "1:10PM: $+0.00" [ref=e91]'
            - 'generic "1:15PM: $+0.00" [ref=e93]'
            - 'generic "1:20PM: $+0.00" [ref=e95]'
            - 'generic "1:25PM: $-0.00" [ref=e97]'
          - generic [ref=e99]:
            - generic [ref=e100]: 12:50PM
            - generic [ref=e101]: 1:10PM
            - generic [ref=e102]: 1:25PM
      - generic [ref=e103]:
        - generic [ref=e104]:
          - generic [ref=e105]:
            - heading "Our Up estimate (next 5m)" [level=3] [ref=e106]
            - generic [ref=e107]:
              - generic [ref=e108]:
                - generic [ref=e109]: Implied prob (Up)
                - generic [ref=e110]: 16%
              - generic [ref=e111]:
                - generic [ref=e112]: 5-min velocity
                - generic [ref=e113]: "-0.275%"
              - generic [ref=e114]:
                - generic [ref=e115]: Acceleration
                - generic [ref=e116]: "-0.008%"
            - paragraph [ref=e117]: Naïve logistic on 5-min velocity. ±0.5% velocity ⇒ ~95% confidence. Replace with a Black-Scholes prob(end > start | T, σ) once Chainlink stream is plumbed.
          - generic [ref=e118]:
            - heading "How this market resolves" [level=3] [ref=e119]
            - paragraph [ref=e120]:
              - text: This market resolves to
              - strong [ref=e121]: Up
              - text: if the XRP price at the end of the window is greater than or equal to the price at the beginning, otherwise
              - strong [ref=e122]: Down
              - text: .
            - paragraph [ref=e123]:
              - strong [ref=e124]: Polymarket's settlement source
              - text: is the
              - link "Chainlink XRP/USD data stream" [ref=e125] [cursor=pointer]:
                - /url: https://data.chain.link/streams/btc-usd
              - text: .
              - strong [ref=e126]: Our truth source
              - text: for live signals on this page is the Coinbase spot ticker for
              - code [ref=e127]: XRP-USD
              - text: (1-min candles via
              - code [ref=e128]: publicGetProductCandles
              - text: ). They generally track within a few cents, but for serious live trading you should subscribe to the same Chainlink stream Polymarket settles from to remove the basis risk between Coinbase last-trade and Chainlink composite.
            - paragraph [ref=e129]: Live data may be delayed by a few seconds and can be influenced by price activity on other exchanges and broader market conditions.
          - generic [ref=e130]:
            - heading "What an arena agent would do this tick" [level=3] [ref=e131]
            - paragraph [ref=e132]:
              - text: The momentum-burst genome (kind=
              - code [ref=e133]: cb_momentum_burst
              - text: ) would fire if velocity ≥
              - code [ref=e134]: vel_entry_pct
              - text: AND acceleration ≥
              - code [ref=e135]: accel_min
              - text: . Below — given current signal, here's the verdict.
            - generic [ref=e136]:
              - generic [ref=e137]: "Long: skip"
              - generic [ref=e138]: "Short: skip"
            - link "→ See live arena leaderboard" [ref=e139] [cursor=pointer]:
              - /url: /arena
        - complementary [ref=e140]:
          - generic [ref=e141]:
            - heading "Similar markets" [level=3] [ref=e142]
            - list [ref=e143]:
              - listitem [ref=e144]:
                - link "Bitcoin Up or Down — 5 Min 32% Up" [ref=e145] [cursor=pointer]:
                  - /url: /crypto/BTC-USD
                  - generic [ref=e146]: Bitcoin Up or Down — 5 Min
                  - generic [ref=e147]:
                    - generic [ref=e148]: 32%
                    - generic [ref=e149]: Up
              - listitem [ref=e150]:
                - link "Ethereum Up or Down — 5 Min 19% Up" [ref=e151] [cursor=pointer]:
                  - /url: /crypto/ETH-USD
                  - generic [ref=e152]: Ethereum Up or Down — 5 Min
                  - generic [ref=e153]:
                    - generic [ref=e154]: 19%
                    - generic [ref=e155]: Up
              - listitem [ref=e156]:
                - link "Solana Up or Down — 5 Min 20% Up" [ref=e157] [cursor=pointer]:
                  - /url: /crypto/SOL-USD
                  - generic [ref=e158]: Solana Up or Down — 5 Min
                  - generic [ref=e159]:
                    - generic [ref=e160]: 20%
                    - generic [ref=e161]: Up
              - listitem [ref=e162]:
                - link "Dogecoin Up or Down — 5 Min 23% Up" [ref=e163] [cursor=pointer]:
                  - /url: /crypto/DOGE-USD
                  - generic [ref=e164]: Dogecoin Up or Down — 5 Min
                  - generic [ref=e165]:
                    - generic [ref=e166]: 23%
                    - generic [ref=e167]: Up
          - generic [ref=e168]:
            - generic [ref=e169]: Status
            - generic [ref=e170]:
              - generic [ref=e171]: XRP Up or Down 5m
              - generic [ref=e172]: Down
            - button "One-tap buy (arena agents only)" [disabled] [ref=e173]
            - paragraph [ref=e174]:
              - text: Manual entry intentionally disabled. Live fills come from arena agents bound to a capsule via the unified ExecutionRouter — gated by
              - code [ref=e175]: COINBASE_ALLOW_TRADE=1
              - text: + per-trade caps.
  - generic [ref=e177]:
    - generic [ref=e178]: TRADES (12)
    - generic [ref=e180]:
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e181] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e182]: entry/SELL
        - generic [ref=e183]: poly:17172924
        - generic [ref=e184]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e185] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e186]: entry/SELL
        - generic [ref=e187]: poly:10164958
        - generic [ref=e188]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e189] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e190]: entry/SELL
        - generic [ref=e191]: poly:84871768
        - generic [ref=e192]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e193] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e194]: entry/BUY
        - generic [ref=e195]: poly:10963197
        - generic [ref=e196]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e197] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e198]: entry/SELL
        - generic [ref=e199]: poly:10164958
        - generic [ref=e200]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e201] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e202]: entry/BUY
        - generic [ref=e203]: poly:49014332
        - generic [ref=e204]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e205] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e206]: entry/BUY
        - generic [ref=e207]: poly:20447903
        - generic [ref=e208]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e209] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e210]: entry/SELL
        - generic [ref=e211]: poly:15962792
        - generic [ref=e212]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e213] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e214]: entry/BUY
        - generic [ref=e215]: poly:51183104
        - generic [ref=e216]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e217] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e218]: entry/BUY
        - generic [ref=e219]: poly:98733003
        - generic [ref=e220]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e221] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e222]: entry/BUY
        - generic [ref=e223]: poly:66651858
        - generic [ref=e224]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e225] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e226]: entry/BUY
        - generic [ref=e227]: poly:89717335
        - generic [ref=e228]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e229] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e230]: entry/SELL
        - generic [ref=e231]: poly:17172924
        - generic [ref=e232]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e233] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e234]: entry/SELL
        - generic [ref=e235]: poly:10164958
        - generic [ref=e236]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e237] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e238]: entry/SELL
        - generic [ref=e239]: poly:84871768
        - generic [ref=e240]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e241] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e242]: entry/BUY
        - generic [ref=e243]: poly:10963197
        - generic [ref=e244]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e245] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e246]: entry/SELL
        - generic [ref=e247]: poly:10164958
        - generic [ref=e248]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e249] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e250]: entry/BUY
        - generic [ref=e251]: poly:49014332
        - generic [ref=e252]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e253] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e254]: entry/BUY
        - generic [ref=e255]: poly:20447903
        - generic [ref=e256]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e257] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e258]: entry/SELL
        - generic [ref=e259]: poly:15962792
        - generic [ref=e260]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e261] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e262]: entry/BUY
        - generic [ref=e263]: poly:51183104
        - generic [ref=e264]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e265] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e266]: entry/BUY
        - generic [ref=e267]: poly:98733003
        - generic [ref=e268]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e269] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e270]: entry/BUY
        - generic [ref=e271]: poly:66651858
        - generic [ref=e272]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e273] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e274]: entry/BUY
        - generic [ref=e275]: poly:89717335
        - generic [ref=e276]: $0.00
        - text: ◆
  - button "Open Next.js Dev Tools" [ref=e282] [cursor=pointer]:
    - img [ref=e283]
  - alert [ref=e286]
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