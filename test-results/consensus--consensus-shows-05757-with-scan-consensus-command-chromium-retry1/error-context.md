# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: consensus.spec.ts >> /consensus >> shows the explanation paragraph with scan:consensus command
- Location: tests\ui\consensus.spec.ts:25:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/npm run scan:consensus/i)
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText(/npm run scan:consensus/i)

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [active]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]:
          - navigation [ref=e7]:
            - button "previous" [disabled] [ref=e8]:
              - img "previous" [ref=e9]
            - generic [ref=e11]:
              - generic [ref=e12]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e13]:
              - img "next" [ref=e14]
          - img
        - generic [ref=e16]:
          - link "Next.js 15.5.14 (outdated) Turbopack" [ref=e17] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e18]
            - generic "An outdated version detected (latest is 16.2.6), upgrade is highly recommended!" [ref=e20]: Next.js 15.5.14 (outdated)
            - generic [ref=e21]: Turbopack
          - img
      - dialog "Runtime TypeError" [ref=e23]:
        - generic [ref=e26]:
          - generic [ref=e27]:
            - generic [ref=e28]:
              - generic [ref=e29]:
                - generic [ref=e30]: Runtime TypeError
                - generic [ref=e31]: Server
              - generic [ref=e32]:
                - button "Copy Error Info" [ref=e33] [cursor=pointer]:
                  - img [ref=e34]
                - button "No related documentation found" [disabled] [ref=e36]:
                  - img [ref=e37]
                - link "Learn more about enabling Node.js inspector for server code with Chrome DevTools" [ref=e39] [cursor=pointer]:
                  - /url: https://nextjs.org/docs/app/building-your-application/configuring/debugging#server-side-code
                  - img [ref=e40]
            - paragraph [ref=e49]: Cannot read properties of undefined (reading 'length')
          - generic [ref=e50]:
            - generic [ref=e51]:
              - paragraph [ref=e53]:
                - img [ref=e55]
                - generic [ref=e58]: src\app\consensus\page.tsx (98:82) @ <anonymous>
                - button "Open in editor" [ref=e59] [cursor=pointer]:
                  - img [ref=e61]
              - generic [ref=e64]:
                - generic [ref=e65]: 96 | <div>
                - generic [ref=e66]: 97 | <div className="text-sm text-zinc-300">
                - generic [ref=e67]: "> 98 | <span className=\"text-accent-blue tabular-nums\">{p.wallets.length} wallets</span>{\" \"}"
                - generic [ref=e68]: "| ^"
                - generic [ref=e69]: "99 | <span className={p.direction === \"YES\" || p.direction === \"BUY\" || p.direction === \"UP\" ? \"text-accent-green\" : \"text-accent-red\"}>"
                - generic [ref=e70]: "100 | {p.direction}"
                - generic [ref=e71]: 101 | </span>
            - generic [ref=e72]:
              - generic [ref=e73]:
                - paragraph [ref=e74]:
                  - text: Call Stack
                  - generic [ref=e75]: "8"
                - button "Show 5 ignore-listed frame(s)" [ref=e76] [cursor=pointer]:
                  - text: Show 5 ignore-listed frame(s)
                  - img [ref=e77]
              - generic [ref=e79]:
                - generic [ref=e80]:
                  - text: <anonymous>
                  - button "Open <anonymous> in editor" [ref=e81] [cursor=pointer]:
                    - img [ref=e82]
                - text: src\app\consensus\page.tsx (98:82)
              - generic [ref=e84]:
                - generic [ref=e85]: Array.map
                - text: <anonymous>
              - generic [ref=e86]:
                - generic [ref=e87]:
                  - text: ConsensusPage
                  - button "Open ConsensusPage in editor" [ref=e88] [cursor=pointer]:
                    - img [ref=e89]
                - text: src\app\consensus\page.tsx (90:17)
        - generic [ref=e91]:
          - generic [ref=e92]: "1"
          - generic [ref=e93]: "2"
    - generic [ref=e98] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e99]:
        - img [ref=e100]
      - generic [ref=e103]:
        - button "Open issues overlay" [ref=e104]:
          - generic [ref=e105]:
            - generic [ref=e106]: "0"
            - generic [ref=e107]: "1"
          - generic [ref=e108]: Issue
        - button "Collapse issues badge" [ref=e109]:
          - img [ref=e110]
  - generic [ref=e113]:
    - 'heading "Application error: a server-side exception has occurred while loading localhost (see the server logs for more information)." [level=2] [ref=e114]'
    - paragraph [ref=e115]: "Digest: 3551099167"
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | /**
  4  |  * /consensus — cross-wallet signal UI.
  5  |  *
  6  |  * Two states the page must handle:
  7  |  *   1. No signals logged → shows the "no signals yet" empty state with the
  8  |  *      runbook hint
  9  |  *   2. Signals present → renders signal cards with wallets, prices, windows
  10 |  *
  11 |  * Run `npm run scan:consensus -- --min 2 --window 360 --trust 0` against a
  12 |  * seeded DB to force state #2 before this suite.
  13 |  */
  14 | 
  15 | test.describe("/consensus", () => {
  16 |   test.beforeEach(async ({ page }) => {
  17 |     await page.goto("/consensus");
  18 |   });
  19 | 
  20 |   test("renders header + 'how to use this' footer", async ({ page }) => {
  21 |     await expect(page.getByRole("heading", { name: /Cross-wallet consensus/ })).toBeVisible();
  22 |     await expect(page.getByText(/How to use this/i)).toBeVisible();
  23 |   });
  24 | 
  25 |   test("shows the explanation paragraph with scan:consensus command", async ({ page }) => {
> 26 |     await expect(page.getByText(/npm run scan:consensus/i)).toBeVisible();
     |                                                             ^ Error: expect(locator).toBeVisible() failed
  27 |   });
  28 | 
  29 |   test("either shows signals or the empty-state hint, never blank", async ({ page }) => {
  30 |     // Two acceptable states:
  31 |     //   (a) at least one wallet table inside a signal card
  32 |     //   (b) an empty-state message guiding the operator to run the scan
  33 |     const tables = page.locator("table.list");
  34 |     const emptyState = page.getByText(/No consensus signals logged yet/i);
  35 |     const tablesCount = await tables.count();
  36 |     if (tablesCount > 0) {
  37 |       // Signal state — verify the first signal card has a direction + price
  38 |       const firstCard = page.locator(".card").nth(1); // first .card after the header card
  39 |       await expect(firstCard).toBeVisible();
  40 |       await expect(firstCard.getByText(/wallets/)).toBeVisible();
  41 |     } else {
  42 |       await expect(emptyState).toBeVisible();
  43 |     }
  44 |   });
  45 | 
  46 |   test("wallet links inside signals route to /wallets/[address]", async ({ page }) => {
  47 |     const walletLink = page.locator(`a[href^="/wallets/0x"]`).first();
  48 |     const exists = await walletLink.count();
  49 |     if (exists === 0) test.skip(true, "no consensus signals logged — run `npm run scan:consensus` first");
  50 |     await walletLink.click();
  51 |     await expect(page).toHaveURL(/\/wallets\/0x/);
  52 |   });
  53 | });
  54 | 
```