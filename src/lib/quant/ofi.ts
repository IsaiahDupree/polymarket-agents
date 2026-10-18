/**
 * Order Flow Imbalance — Cont, Kukanov & Stoikov (2014) signal over a
 * rolling time window. Ported from HFT/src/lib/backtest/l2/signals.ts
 * (commit af014a3) into PolymarketAutomation.
 *
 * The signal interprets every change in top-of-book as a positive or
 * negative event:
 *
 *   bid event = + size                 if bid price IMPROVED (rose)
 *               − previous bid size    if bid price WORSENED (fell, cancel/burn)
 *               size_now − size_prev   if bid price unchanged (refresh/grow)
 *
 *   ask event = − size                 if ask price IMPROVED (fell)
 *               + previous ask size    if ask price WORSENED (rose, cancel/burn)
 *               − (size_now − size_prev)  if ask price unchanged
 *
 * The running sum over a `windowSec` rolling window is the OFI signal.
 * Positive values mean buy pressure; negative values mean sell pressure.
 * Cont et al. found R² > 65 % relating OFI to short-horizon price changes
 * (handbook §8 / HFT microstructure-signals.md §2.3).
 *
 * Distinction from `orderbookImbalance()` (src/lib/quant/microstructure.ts):
 *   OBI = snapshot depth ratio at top-N levels.
 *   OFI = event-driven — what is CHANGING in the book.
 * OFI is the more reliable predictor (HFT doc §2.3); OBI is what you can
 * compute when you only have snapshots, not the event stream.
 *
 * Pure / deterministic. The class maintains running state across updates;
 * for use by decide functions, the runOfiOverHistory() helper below
 * replays an array of snapshots and returns the final OFI value.
 */

export class OFICalculator {
  private readonly windowSec: number;
  private events: Array<{ ts: number; e: number }> = [];
  private prevBidPx: number | null = null;
  private prevBidSz = 0;
  private prevAskPx = 0;
  private prevAskSz = 0;

  /** windowSec — rolling sum window. Cont et al. used ~1 second. */
  constructor(windowSec = 1.0) {
    this.windowSec = windowSec;
  }

  /**
   * Feed a top-of-book update. Returns the OFI value AFTER this update —
   * sum of events in the trailing `windowSec` window.
   *
   * The first update primes the prev-state and returns 0 (no event yet).
   */
  update(ts: number, bidPx: number, bidSz: number, askPx: number, askSz: number): number {
    if (this.prevBidPx === null) {
      this.prevBidPx = bidPx; this.prevBidSz = bidSz;
      this.prevAskPx = askPx; this.prevAskSz = askSz;
      return 0;
    }
    // Bid contribution.
    let eBid: number;
    if (bidPx > this.prevBidPx) eBid = bidSz;                  // price improved → add
    else if (bidPx < this.prevBidPx) eBid = -this.prevBidSz;   // price worsened → remove prev depth
    else eBid = bidSz - this.prevBidSz;                        // same price → net refresh

    // Ask contribution — sign flipped vs bid (an improving ask = falling
    // best ask = bullish in price-pressure terms is debatable; we follow
    // Cont et al. exactly: improving ask is BEARISH for OFI).
    let eAsk: number;
    if (askPx < this.prevAskPx) eAsk = -askSz;                 // ask improved (fell) → sellers stepped in
    else if (askPx > this.prevAskPx) eAsk = this.prevAskSz;    // ask worsened (rose) → sellers pulled back
    else eAsk = -(askSz - this.prevAskSz);                     // same price → net change in sell depth

    this.events.push({ ts, e: eBid + eAsk });
    // Drop events older than the rolling window.
    while (this.events.length && ts - this.events[0].ts > this.windowSec) {
      this.events.shift();
    }

    this.prevBidPx = bidPx; this.prevBidSz = bidSz;
    this.prevAskPx = askPx; this.prevAskSz = askSz;
    return this.events.reduce((s, x) => s + x.e, 0);
  }

  /** Current OFI (sum over the current window). */
  value(): number {
    return this.events.reduce((s, x) => s + x.e, 0);
  }

  /** Number of events currently in the window — useful sanity diagnostic. */
  eventCount(): number {
    return this.events.length;
  }
}

export type TopOfBookSample = {
  /** Unix seconds (or any consistent time unit; window is in the same unit). */
  ts: number;
  bidPx: number;
  bidSz: number;
  askPx: number;
  askSz: number;
};

/**
 * Replay an array of top-of-book samples through a fresh OFICalculator
 * and return the final OFI value. Decide functions use this when they
 * pull a recent snapshot history from the DB — instead of holding the
 * calculator's state in process memory (which doesn't survive worker
 * restarts), they replay the last N samples on demand.
 *
 * Returns 0 when fewer than 2 samples are supplied (no event possible).
 */
export function runOfiOverHistory(
  samples: readonly TopOfBookSample[],
  windowSec = 1.0,
): number {
  if (samples.length < 2) return 0;
  const c = new OFICalculator(windowSec);
  for (const s of samples) c.update(s.ts, s.bidPx, s.bidSz, s.askPx, s.askSz);
  return c.value();
}

/**
 * Normalize OFI to [-1, +1] using a simple scale. Useful for surfacing
 * in dashboards or for use as a confirmation signal alongside OBI.
 * `scaleSize` is the size-magnitude that maps to ±1 (or saturates).
 */
export function normalizeOfi(ofi: number, scaleSize: number): number {
  if (scaleSize <= 0) return 0;
  const x = ofi / scaleSize;
  if (x > 1) return 1;
  if (x < -1) return -1;
  return x;
}
