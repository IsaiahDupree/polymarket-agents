# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crypto-detail.spec.ts >> /crypto/[symbol] — Polymarket-faithful deep-dive >> /crypto/DOGE-USD renders hero + countdown + similar markets
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
        - button "⏸" [ref=e37] [cursor=pointer]
        - generic [ref=e38]: doge 15s
      - link "← back to all crypto markets" [ref=e40] [cursor=pointer]:
        - /url: /crypto
      - generic [ref=e41]:
        - generic [ref=e42]:
          - generic [ref=e43]:
            - generic [ref=e44]:
              - generic [ref=e45]: DOGE
              - generic [ref=e46]:
                - heading "DOGE Up or Down 5m" [level=1] [ref=e47]
                - generic [ref=e48]:
                  - generic [ref=e49]: May 30, 1:40PM-1:45PM
                  - text: ET
            - generic [ref=e50]:
              - generic [ref=e51]:
                - generic [ref=e52]: Price To Beat
                - generic [ref=e53]: $0.1011
              - generic [ref=e54]:
                - generic [ref=e55]: Current Price
                - generic [ref=e56]: $––,––
                - generic [ref=e57]: +$0.00 (0.059%)
          - generic [ref=e58]:
            - generic [ref=e59]: Time remaining
            - generic [ref=e61]:
              - generic [ref=e62]: "02"
              - generic [ref=e63]: mins
              - generic [ref=e64]: "49"
              - generic [ref=e65]: secs
            - generic [ref=e66]:
              - text: "data:"
              - generic [ref=e67]: Coinbase DOGE-USD
              - generic [ref=e68]: · 13s ago
            - generic [ref=e69]: window auto-rolls every 5m
        - generic [ref=e70]:
          - generic [ref=e71]:
            - heading "Recent windows (close − open per window)" [level=3] [ref=e72]
            - generic [ref=e73]: last 10 × 5m
          - img [ref=e74]:
            - 'generic "12:50PM: $+0.00" [ref=e75]'
            - 'generic "12:55PM: $-0.00" [ref=e77]'
            - 'generic "1:00PM: $+0.00"'
            - 'generic "1:05PM: $-0.00" [ref=e79]'
            - 'generic "1:10PM: $+0.00" [ref=e81]'
            - 'generic "1:15PM: $-0.00" [ref=e83]'
            - 'generic "1:20PM: $+0.00" [ref=e85]'
            - 'generic "1:25PM: $-0.00" [ref=e87]'
            - 'generic "1:30PM: $-0.00" [ref=e89]'
            - 'generic "1:35PM: $+0.00" [ref=e91]'
          - generic [ref=e93]:
            - generic [ref=e94]: 12:50PM
            - generic [ref=e95]: 1:15PM
            - generic [ref=e96]: 1:35PM
      - generic [ref=e97]:
        - generic [ref=e98]:
          - generic [ref=e99]:
            - heading "Our Up estimate (next 5m)" [level=3] [ref=e100]
            - generic [ref=e101]:
              - generic [ref=e102]:
                - generic [ref=e103]: Implied prob (Up)
                - generic [ref=e104]: 67%
              - generic [ref=e105]:
                - generic [ref=e106]: 5-min velocity
                - generic [ref=e107]: +0.119%
              - generic [ref=e108]:
                - generic [ref=e109]: Acceleration
                - generic [ref=e110]: "-0.059%"
            - paragraph [ref=e111]: Naïve logistic on 5-min velocity. ±0.5% velocity ⇒ ~95% confidence. Replace with a Black-Scholes prob(end > start | T, σ) once Chainlink stream is plumbed.
          - generic [ref=e112]:
            - heading "How this market resolves" [level=3] [ref=e113]
            - paragraph [ref=e114]:
              - text: This market resolves to
              - strong [ref=e115]: Up
              - text: if the Dogecoin price at the end of the window is greater than or equal to the price at the beginning, otherwise
              - strong [ref=e116]: Down
              - text: .
            - paragraph [ref=e117]:
              - strong [ref=e118]: Polymarket's settlement source
              - text: is the
              - link "Chainlink DOGE/USD data stream" [ref=e119] [cursor=pointer]:
                - /url: https://data.chain.link/streams/btc-usd
              - text: .
              - strong [ref=e120]: Our truth source
              - text: for live signals on this page is the Coinbase spot ticker for
              - code [ref=e121]: DOGE-USD
              - text: (1-min candles via
              - code [ref=e122]: publicGetProductCandles
              - text: ). They generally track within a few cents, but for serious live trading you should subscribe to the same Chainlink stream Polymarket settles from to remove the basis risk between Coinbase last-trade and Chainlink composite.
            - paragraph [ref=e123]: Live data may be delayed by a few seconds and can be influenced by price activity on other exchanges and broader market conditions.
          - generic [ref=e124]:
            - heading "What an arena agent would do this tick" [level=3] [ref=e125]
            - paragraph [ref=e126]:
              - text: The momentum-burst genome (kind=
              - code [ref=e127]: cb_momentum_burst
              - text: ) would fire if velocity ≥
              - code [ref=e128]: vel_entry_pct
              - text: AND acceleration ≥
              - code [ref=e129]: accel_min
              - text: . Below — given current signal, here's the verdict.
            - generic [ref=e130]:
              - generic [ref=e131]: "Long: skip"
              - generic [ref=e132]: "Short: skip"
            - link "→ See live arena leaderboard" [ref=e133] [cursor=pointer]:
              - /url: /arena
        - complementary [ref=e134]:
          - generic [ref=e135]:
            - heading "Similar markets" [level=3] [ref=e136]
            - list [ref=e137]:
              - listitem [ref=e138]:
                - link "Bitcoin Up or Down — 5 Min 67% Up" [ref=e139] [cursor=pointer]:
                  - /url: /crypto/BTC-USD
                  - generic [ref=e140]: Bitcoin Up or Down — 5 Min
                  - generic [ref=e141]:
                    - generic [ref=e142]: 67%
                    - generic [ref=e143]: Up
              - listitem [ref=e144]:
                - link "Ethereum Up or Down — 5 Min 74% Up" [ref=e145] [cursor=pointer]:
                  - /url: /crypto/ETH-USD
                  - generic [ref=e146]: Ethereum Up or Down — 5 Min
                  - generic [ref=e147]:
                    - generic [ref=e148]: 74%
                    - generic [ref=e149]: Up
              - listitem [ref=e150]:
                - link "Solana Up or Down — 5 Min 76% Up" [ref=e151] [cursor=pointer]:
                  - /url: /crypto/SOL-USD
                  - generic [ref=e152]: Solana Up or Down — 5 Min
                  - generic [ref=e153]:
                    - generic [ref=e154]: 76%
                    - generic [ref=e155]: Up
              - listitem [ref=e156]:
                - link "XRP Up or Down — 5 Min 79% Up" [ref=e157] [cursor=pointer]:
                  - /url: /crypto/XRP-USD
                  - generic [ref=e158]: XRP Up or Down — 5 Min
                  - generic [ref=e159]:
                    - generic [ref=e160]: 79%
                    - generic [ref=e161]: Up
          - generic [ref=e162]:
            - generic [ref=e163]: Status
            - generic [ref=e164]:
              - generic [ref=e165]: DOGE Up or Down 5m
              - generic [ref=e166]: Up
            - button "One-tap buy (arena agents only)" [disabled] [ref=e167]
            - paragraph [ref=e168]:
              - text: Manual entry intentionally disabled. Live fills come from arena agents bound to a capsule via the unified ExecutionRouter — gated by
              - code [ref=e169]: COINBASE_ALLOW_TRADE=1
              - text: + per-trade caps.
  - generic [ref=e170]: TRADES — no fills yet. Random walkers + momentum agents fire as data accumulates.
  - alert [ref=e171]
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