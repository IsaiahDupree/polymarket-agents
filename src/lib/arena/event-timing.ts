/**
 * Event-timing helpers — porting the latency / event-phase framework from
 * the HFT repo (../HFT/docs/strategies/{latency-arbitrage,event-driven}.md)
 * into PolymarketAutomation. Pure functions only — no DB, no I/O — so
 * decide() callers can use them inline without async pain.
 *
 * Framework summary (HFT latency-arbitrage.md §2.1):
 *   T0  microsecond, wire           firm-only
 *   T1  microsecond, kernel-bypass  firm-only
 *   T2  millisecond, same-region    accessible w/ infra
 *   T3  hundred-ms, REST polling    *** our tier ***
 *   T4  second+, blockchain blocks  our live-execution tier
 *
 * Polymarket binary lifecycle (HFT event-driven.md §2.6):
 *   pre-window     market exists but window hasn't opened (rare in 5-min)
 *   opening        first ~25 % of window — signal forming
 *   mid-window     middle ~50 % — signal established, edge widest
 *   late-window    last ~25 % — sample-size dominated, exit-liq premium grows
 *   post-cutoff    < pre_cutoff_min to expiry — Polymarket's order-book cutoff
 *   resolved       expiry passed, settled in DB
 *
 * Bridge to PolymarketAutomation:
 *   - poly_binaries.expiry_iso + duration_kind ("5M"/"15M") give us a
 *     deterministic window. Window-open = expiry - duration; window-close = expiry.
 *   - realtime_ticks.ts_unix gives Coinbase-tick freshness. Stale tick means
 *     the lagger-leader race is already over and signal is rotten.
 *
 * Used by: decideMarkovPersistence (sim.ts) to gate entries on the right phase
 * + freshness. Cheap helpers — every decision call pays µs cost, no DB.
 */

export type EventPhase =
  | "pre-window"
  | "opening"
  | "mid-window"
  | "late-window"
  | "post-cutoff"
  | "resolved"
  | "unknown";

/**
 * Map a duration_kind tag ("5M", "15M", "1H", etc.) to minutes. Returns
 * null for unrecognized inputs so callers can decide whether to treat
 * it as a long event market (months) or skip.
 */
export function parseDurationMin(durationKind: string | null | undefined): number | null {
  if (!durationKind) return null;
  const m = String(durationKind).trim().match(/^(\d+)\s*([MmHh])$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2].toUpperCase() === "H" ? n * 60 : n;
}

/**
 * Minutes from `now` to `expiryIso`. Negative when expiry has passed.
 * Returns null when expiryIso is missing or unparseable.
 */
export function minToResolution(expiryIso: string | null | undefined, now: string): number | null {
  if (!expiryIso) return null;
  const exp = Date.parse(expiryIso);
  const n = Date.parse(now);
  if (!Number.isFinite(exp) || !Number.isFinite(n)) return null;
  return (exp - n) / 60_000;
}

/**
 * Classify a binary market's lifecycle phase from its expiry, duration,
 * the current time, and the cutoff zone (Polymarket's late-window order-book
 * cutoff — typically 2-4 minutes before expiry, per pre_cutoff_min on
 * poly_short_binary_directional).
 *
 *   pre-window     elapsed < 0 (now is before window-open)
 *   opening        elapsed/duration in [0, 0.25)
 *   mid-window     [0.25, 0.75)
 *   late-window    [0.75, 1.0) AND minToResolution > cutoffMin
 *   post-cutoff    minToResolution <= cutoffMin (and > 0)
 *   resolved       minToResolution <= 0
 *
 * When `durationMin` or `expiryIso` is null, returns "unknown" rather
 * than guessing. The settled column on poly_binaries is the source of
 * truth for "resolved"; this helper uses time-only and is a safe
 * conservative proxy.
 */
export function eventPhase(args: {
  expiryIso: string | null | undefined;
  durationMin: number | null;
  now: string;
  cutoffMin: number;
}): EventPhase {
  const m = minToResolution(args.expiryIso, args.now);
  if (m === null) return "unknown";
  if (m <= 0) return "resolved";
  if (m <= args.cutoffMin) return "post-cutoff";
  if (args.durationMin === null || args.durationMin <= 0) return "unknown";
  const elapsedMin = args.durationMin - m;
  if (elapsedMin < 0) return "pre-window";
  const elapsedFrac = elapsedMin / args.durationMin;
  if (elapsedFrac < 0.25) return "opening";
  if (elapsedFrac < 0.75) return "mid-window";
  return "late-window";
}

/**
 * Seconds since a Coinbase tick was last recorded. Caller must pass in
 * the tick's `ts_unix` (seconds, not ms — matches the realtime_ticks
 * schema). Returns null when no recent tick exists.
 *
 * Stale ticks signal the leader-lagger race window is over — the Polymarket
 * order book has already caught up to whatever moved on Coinbase. Trading
 * on a stale tick is buying repriced liquidity.
 */
export function coinbaseTickAgeSec(
  lastTickTsUnix: number | null | undefined,
  now: string,
): number | null {
  if (lastTickTsUnix == null || !Number.isFinite(lastTickTsUnix)) return null;
  const nowSec = Date.parse(now) / 1000;
  if (!Number.isFinite(nowSec)) return null;
  return nowSec - lastTickTsUnix;
}

/**
 * Match an event-phase against a filter spec. The filter accepts:
 *   "any"          — pass everything
 *   "opening"      — only the opening quarter of the window
 *   "mid-window"   — only the middle half
 *   "late-window"  — only the closing quarter (but still pre-cutoff)
 *   "mid-or-late"  — mid OR late (most common entry zone)
 *   "tradeable"    — opening OR mid OR late (anything except post-cutoff/resolved/unknown/pre-window)
 *
 * Returns false on resolved/post-cutoff/pre-window/unknown for non-"any"
 * filters — those phases are never a green light for entry.
 */
export type EventPhaseFilter = "any" | "opening" | "mid-window" | "late-window" | "mid-or-late" | "tradeable";

export function matchesPhase(phase: EventPhase, filter: EventPhaseFilter): boolean {
  if (filter === "any") return true;
  if (phase === "resolved" || phase === "post-cutoff" || phase === "pre-window" || phase === "unknown") {
    return false;
  }
  switch (filter) {
    case "opening":     return phase === "opening";
    case "mid-window":  return phase === "mid-window";
    case "late-window": return phase === "late-window";
    case "mid-or-late": return phase === "mid-window" || phase === "late-window";
    case "tradeable":   return phase === "opening" || phase === "mid-window" || phase === "late-window";
  }
}
