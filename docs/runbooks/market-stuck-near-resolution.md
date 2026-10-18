# Runbook: "MARKET UP stuck at 99% — is the data pipeline broken?"

**Symptom:** the LiveBinaryPanel on `/arena/high-pnl-agents` shows
`MARKET · UP 99.00%` for many minutes with no movement. The pulsing dot and
"last fetch Xms ago" badge confirm polling, but the number is static.

## TL;DR

**This is correct behavior, not a bug.** Near-resolution 5-min binaries are
*supposed* to converge to 99% / 1% when the outcome is effectively decided
by the underlying spot move. The MARKET value reflects the Polymarket
orderbook ask; when nobody wants to take the other side at $0.01, the book
locks at $0.99 and the midpoint sits there until expiry.

The polling IS working. What's *not* changing is the underlying value, and
the panel has multiple visible indicators to prove it.

## Why does this happen?

A 5-min "Bitcoin Up or Down" binary resolves at expiry based on whether
spot has moved up or down from window start. If BTC has already moved 0.4%
up by the 3-minute mark of a 5-minute window:

1. The probability of the binary resolving UP is effectively 100%
2. Polymarket traders converge to that view; UP best ask climbs to $0.99
3. Anyone selling UP at $0.99 is offering 1¢ for 1-minute reverse risk; few
   takers
4. The book stops moving because there's no trade flow at the converged price
5. Our 1Hz poll keeps returning the same `upImpliedProb = 0.99` because
   that's the truth on the wire

## How to verify the polling is alive

The LiveBinaryPanel exposes five independent proof-of-life indicators that
all update independently of the MARKET UP value:

1. **Live UTC clock in the header** (`now 01:48:30Z●`) — Date.now() ticking
   every 100ms via the render-clock useEffect. If this is frozen, the panel
   itself is dead.
2. **Window progress bar** — fills smoothly from 0 to 100% via a CSS
   `transition-[width] duration-100`. If this isn't sliding, the React tree
   isn't re-rendering.
3. **Elapsed/remaining timer** — `elapsed 3:14 · remaining 1:46` ticks every
   100ms.
4. **Pulsing green dot** next to MARKET · UP / DOWN labels — pure CSS
   `animate-pulse`, doesn't depend on data.
5. **"last fetch Xms ago" badge** in the footer — counts up from 0 each poll,
   turns red >4s. Direct evidence of polling cadence.
6. **"last moved Xs ago" badge** under each MARKET panel — shows how long
   since the value LAST CHANGED (with a 0.05pp tolerance to filter book noise).
   When this reads `last moved 215s ago`, that's the answer: the market value
   has been stable for 215 seconds.

If you see (1)-(5) ticking but the MARKET % is static, the system is healthy
and the market is just stable.

## How to verify Polymarket itself is responding

Look at the **Polymarket pipeline health** card directly below the panel.
It polls `/api/polymarket/health` every 3 seconds and shows:

  • Per-endpoint latency for CLOB orderbook (UP + DOWN), CLOB midpoint, and
    Gamma search
  • Color-coded latency badges (green <200ms, amber <700ms, red ≥700ms)
  • Sample top-3 bid/ask levels for both binary tokens
  • A green `4/4 endpoints OK` chip when all four pings succeed

If MARKET is stuck *and* an endpoint is red, the data layer is broken. If
MARKET is stuck and all four are green, the market just isn't moving.

## When to actually worry

Treat any of these as real failures:

  • The pipeline health card shows < 4/4 endpoints OK for more than 30s
  • The "last fetch Xms ago" badge climbs past 4s (red) and stays there
  • The UTC clock is frozen
  • The progress bar stops sliding mid-window
  • The Polymarket diagnostic panel's `show raw samples` reveals an empty
    orderbook for the current binary
  • The book has activity (recent trades, depth changes) but our number isn't
    updating — check the `/api/arena/binary-now` server elapsed_ms; if it's
    > 1000ms, the route handler is slow

## Reproducing the converged-market state

The simplest reproduction: pick any binary with ≥3min elapsed and a directional
spot move of ≥0.3% in the asset (BTC, ETH, etc.). The market will converge
within seconds. To watch:

  1. Open the page on `/arena/high-pnl-agents`
  2. Click `BTC spot` on the chart toggle; verify the price has moved
     significantly from the dashed `▶ target` line (start-of-window reference)
  3. Click back to `MARKET UP%` — you'll see the chart held at 99% for the
     latter half of the window

## Related code

  • Server query: `src/lib/arena/binary-window.ts` `fetchMarketQuote()`
  • Polling loop: `src/components/LiveBinaryPanel.tsx` `fetchOnce()`
  • Last-changed tracker: `LiveBinaryPanel.tsx` `lastChangedMsRef`
  • Health endpoint: `src/app/api/polymarket/health/route.ts`
  • Health UI: `src/components/PolymarketDiagnosticPanel.tsx`
