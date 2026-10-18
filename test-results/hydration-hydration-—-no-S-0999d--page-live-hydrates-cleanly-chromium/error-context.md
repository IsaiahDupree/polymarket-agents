# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: hydration.spec.ts >> hydration — no SSR/CSR mismatch on any page >> /live hydrates cleanly
- Location: tests\ui\hydration.spec.ts:86:5

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: page.waitForTimeout: Test timeout of 45000ms exceeded.
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
        - heading "Live" [level=1] [ref=e37]
        - paragraph [ref=e38]: Streaming top-of-book updates from the CLOB market websocket for the top sampling markets.
      - generic [ref=e39]:
        - generic [ref=e40]:
          - generic [ref=e41]: connecting
          - generic [ref=e42]: 6 subscribed tokens
        - table [ref=e43]:
          - rowgroup [ref=e44]:
            - row "Market Outcome Bid Bid sz Ask Ask sz Last Updates Last upd" [ref=e45]:
              - columnheader "Market" [ref=e46]
              - columnheader "Outcome" [ref=e47]
              - columnheader "Bid" [ref=e48]
              - columnheader "Bid sz" [ref=e49]
              - columnheader "Ask" [ref=e50]
              - columnheader "Ask sz" [ref=e51]
              - columnheader "Last" [ref=e52]
              - columnheader "Updates" [ref=e53]
              - columnheader "Last upd" [ref=e54]
          - rowgroup [ref=e55]:
            - row "Reya FDV above $200M one day after launch? Yes — — — — — 0 —" [ref=e56]:
              - cell "Reya FDV above $200M one day after launch?" [ref=e57]
              - cell "Yes" [ref=e58]
              - cell "—" [ref=e59]
              - cell "—" [ref=e60]
              - cell "—" [ref=e61]
              - cell "—" [ref=e62]
              - cell "—" [ref=e63]
              - cell "0" [ref=e64]
              - cell "—" [ref=e65]
            - row "Will Mullins McLeod win the 2026 South Carolina Governor Democratic primary election? Yes — — — — — 0 —" [ref=e66]:
              - cell "Will Mullins McLeod win the 2026 South Carolina Governor Democratic primary election?" [ref=e67]
              - cell "Yes" [ref=e68]
              - cell "—" [ref=e69]
              - cell "—" [ref=e70]
              - cell "—" [ref=e71]
              - cell "—" [ref=e72]
              - cell "—" [ref=e73]
              - cell "0" [ref=e74]
              - cell "—" [ref=e75]
            - row "New Playboi Carti Album before GTA VI? Yes — — — — — 0 —" [ref=e76]:
              - cell "New Playboi Carti Album before GTA VI?" [ref=e77]
              - cell "Yes" [ref=e78]
              - cell "—" [ref=e79]
              - cell "—" [ref=e80]
              - cell "—" [ref=e81]
              - cell "—" [ref=e82]
              - cell "—" [ref=e83]
              - cell "0" [ref=e84]
              - cell "—" [ref=e85]
            - row "Will the Republicans win the Vermont governor race in 2026? Yes — — — — — 0 —" [ref=e86]:
              - cell "Will the Republicans win the Vermont governor race in 2026?" [ref=e87]
              - cell "Yes" [ref=e88]
              - cell "—" [ref=e89]
              - cell "—" [ref=e90]
              - cell "—" [ref=e91]
              - cell "—" [ref=e92]
              - cell "—" [ref=e93]
              - cell "0" [ref=e94]
              - cell "—" [ref=e95]
            - row "Will Nicholas Sciretta be the Democratic nominee for NY-04? Yes — — — — — 0 —" [ref=e96]:
              - cell "Will Nicholas Sciretta be the Democratic nominee for NY-04?" [ref=e97]
              - cell "Yes" [ref=e98]
              - cell "—" [ref=e99]
              - cell "—" [ref=e100]
              - cell "—" [ref=e101]
              - cell "—" [ref=e102]
              - cell "—" [ref=e103]
              - cell "0" [ref=e104]
              - cell "—" [ref=e105]
            - row "Will Xavier Becerra win the California Governor Election in 2026? Yes — — — — — 0 —" [ref=e106]:
              - cell "Will Xavier Becerra win the California Governor Election in 2026?" [ref=e107]
              - cell "Yes" [ref=e108]
              - cell "—" [ref=e109]
              - cell "—" [ref=e110]
              - cell "—" [ref=e111]
              - cell "—" [ref=e112]
              - cell "—" [ref=e113]
              - cell "0" [ref=e114]
              - cell "—" [ref=e115]
  - generic [ref=e116]: TRADES — no fills yet. Random walkers + momentum agents fire as data accumulates.
```

# Test source

```ts
  7   |  * match"). Catches the same class of bug that hit SystemStatusBar — anywhere
  8   |  * we ever render Date.now()/Math.random()/locale-formatted-now in JSX.
  9   |  *
  10  |  * Also fails on any "DOMException" or "Invariant" errors that React emits
  11  |  * during hydration, since those usually mean the SSR/CSR trees diverged.
  12  |  */
  13  | const HYDRATION_PATTERNS = [
  14  |   /Hydration failed/i,
  15  |   /Text content does not match/i,
  16  |   /server-rendered (HTML|text) didn'?t match/i,
  17  |   /Hydration mismatch/i,
  18  | ];
  19  | 
  20  | // Dynamic-route IDs are read from env so CI can override with synthetic DB IDs.
  21  | // Defaults match the locally-seeded DB (atlas-macro + fade-headline-spikes
  22  | // strategy, majorexploiter wallet, a real snapshot condition_id).
  23  | const AGENT_SLUG = process.env.UI_TEST_AGENT_SLUG ?? "atlas-macro";
  24  | const STRATEGY_AGENT = process.env.UI_TEST_STRATEGY_AGENT ?? "atlas-macro";
  25  | const STRATEGY_SLUG = process.env.UI_TEST_STRATEGY_SLUG ?? "fade-headline-spikes";
  26  | const WALLET_ADDR = process.env.UI_TEST_WALLET_ADDR ?? "0x019782cab5d844f02bafb71f512758be78579f3c";
  27  | const CONDITION_ID = process.env.UI_TEST_CONDITION_ID ?? "0x384e2707bbb95da4bfa6f330fe7d5ccbec1c0a85e20be900cbf599987588e1a4";
  28  | 
  29  | const PAGES = [
  30  |   // Top-level dashboards
  31  |   "/",
  32  |   "/agents",
  33  |   "/strategies",
  34  |   "/research",
  35  |   "/evolution",
  36  |   "/trades",
  37  |   "/tracked",
  38  |   "/onchain",
  39  |   "/live",
  40  |   "/markets",
  41  |   "/arb",
  42  |   "/arb/comb",
  43  | 
  44  |   // Arena
  45  |   "/arena",
  46  |   "/arena/generations",
  47  |   "/arena/generations/1",   // gen detail — exercise the dynamic route with an early gen that always exists in seeded DBs
  48  |   "/arena/mutations",
  49  | 
  50  |   // Risk + capsule UX
  51  |   "/capsules",
  52  |   "/safety",
  53  |   "/settings",
  54  | 
  55  |   // Strategy opportunities (gen-2 unified feed)
  56  |   "/opportunities",
  57  | 
  58  |   // Coinbase
  59  |   "/coinbase",
  60  |   "/coinbase/orders",
  61  |   "/coinbase/products",
  62  | 
  63  |   // Crypto
  64  |   "/crypto",
  65  |   "/crypto/BTC-USD",
  66  |   "/crypto/ETH-USD",
  67  | 
  68  |   // New: wallet-scanner + consensus pipeline
  69  |   "/consensus",
  70  |   `/wallets/${WALLET_ADDR}`,
  71  | 
  72  |   // Short-duration binaries dashboard
  73  |   "/binaries",
  74  | 
  75  |   // Polymarket deposit QR generator
  76  |   "/deposit",
  77  | 
  78  |   // Dynamic routes that need real DB-backed IDs
  79  |   `/agents/${AGENT_SLUG}`,
  80  |   `/strategies/${STRATEGY_AGENT}/${STRATEGY_SLUG}`,
  81  |   `/markets/condition/${CONDITION_ID}`,
  82  | ];
  83  | 
  84  | test.describe("hydration — no SSR/CSR mismatch on any page", () => {
  85  |   for (const path of PAGES) {
  86  |     test(`${path} hydrates cleanly`, async ({ page }) => {
  87  |       const offenders: string[] = [];
  88  |       page.on("console", (msg) => {
  89  |         if (msg.type() !== "error") return;
  90  |         const text = msg.text();
  91  |         if (HYDRATION_PATTERNS.some((re) => re.test(text))) {
  92  |           offenders.push(`console: ${text.slice(0, 800)}`);
  93  |         }
  94  |       });
  95  |       page.on("pageerror", (err) => {
  96  |         const text = err.message;
  97  |         if (HYDRATION_PATTERNS.some((re) => re.test(text))) {
  98  |           offenders.push(`pageerror: ${text.slice(0, 1500)}`);
  99  |         }
  100 |       });
  101 |       // Use 'domcontentloaded' instead of the default 'load' wait so pages
  102 |       // with long-lived streams (/onchain SSE, /live WS) don't block the test
  103 |       // navigation. `networkidle` would never fire on those pages.
  104 |       await page.goto(path, { waitUntil: "domcontentloaded" });
  105 |       // Give React 1.5s to attempt hydration + run client effects. If a
  106 |       // mismatch fires, it surfaces in the console listener inside this window.
> 107 |       await page.waitForTimeout(1500);
      |                  ^ Error: page.waitForTimeout: Test timeout of 45000ms exceeded.
  108 |       if (offenders.length > 0) {
  109 |         throw new Error(`Hydration error(s) on ${path}:\n  - ${offenders.join("\n  - ")}`);
  110 |       }
  111 |     });
  112 |   }
  113 | });
  114 | 
```