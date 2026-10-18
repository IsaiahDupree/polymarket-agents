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
- generic [ref=e3]:
  - 'heading "Application error: a server-side exception has occurred while loading localhost (see the server logs for more information)." [level=2] [ref=e4]'
  - paragraph [ref=e5]: "Digest: 3551099167"
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