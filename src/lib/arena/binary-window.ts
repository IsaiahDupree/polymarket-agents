/**
 * 5-minute binary window finder + market quote.
 *
 * Drives /arena/high-pnl-agents' focused panel: given an asset (default BTC),
 * find the 5-min binary currently active OR a specific window navigated to
 * via prev/next, fetch both UP and DOWN orderbooks live, return the market's
 * implied UP% / DOWN% and depth, plus window time math (elapsed, remaining,
 * "in the optimal betting window" flag).
 *
 * Convention: "current window" = the binary whose expiry is *next* in the
 * future (i.e. the open trading window). Prev = the window before that.
 * Next = the window after that. Each window is 5 minutes.
 */
import { db } from "@/lib/db/client";
import { poly } from "@adapters/polymarket/client";

export type BinaryWindow = {
  upTokenId: string;
  downTokenId: string | null;
  conditionId: string;
  question: string;
  asset: string;
  startIso: string;
  expiryIso: string;
  durationMin: number;
};

export type MarketQuote = {
  upBestAsk: number | null;
  upBestBid: number | null;
  upAskDepthShares: number;
  upAskDepthUsd: number;
  downBestAsk: number | null;
  downBestBid: number | null;
  downAskDepthShares: number;
  downAskDepthUsd: number;
  topNDepthUsd: number;
  upImpliedProb: number | null;
};

export type WindowTime = {
  nowIso: string;
  nowEpochMs: number;
  startEpochMs: number | null;
  expiryEpochMs: number;
  elapsedSec: number;
  remainingSec: number;
  fractionElapsed: number;
  optimalBetWindowStartSec: number;
  optimalBetWindowEndSec: number;
  inOptimalBetWindow: boolean;
  pastOptimalBetWindow: boolean;
};

type BinaryRow = {
  token_id: string;
  no_token_id: string | null;
  condition_id: string;
  question: string;
  asset: string;
  start_iso: string;
  expiry_iso: string;
  duration_kind: string;
};

export function findBinaryWindow(asset = "BTC", epochMs: number | null = null): BinaryWindow | null {
  const handle = db();
  if (epochMs == null) {
    // Current window — earliest 5M binary whose expiry is still in the future.
    // strftime('%s', expiry_iso) > strftime('%s','now') compares epoch seconds
    // — necessary because expiry_iso is ISO-with-T-and-Z while datetime('now')
    // returns space-separated UTC, and lexical compare across formats is wrong.
    const row = handle
      .prepare(
        `SELECT token_id, no_token_id, condition_id, question, asset, start_iso, expiry_iso, duration_kind
         FROM poly_binaries
        WHERE asset = ? AND settled = 0
          AND duration_kind = '5M'
          AND strftime('%s', expiry_iso) > strftime('%s', 'now')
        ORDER BY expiry_iso ASC
        LIMIT 1`,
      )
      .get(asset) as BinaryRow | undefined;
    if (!row) return null;
    return toBinary(row);
  }
  // Nearest binary whose expiry_iso is within ±10 min of the requested epoch.
  const lo = new Date(epochMs - 10 * 60_000).toISOString().slice(0, 19).replace("T", " ");
  const hi = new Date(epochMs + 10 * 60_000).toISOString().slice(0, 19).replace("T", " ");
  const row = handle
    .prepare(
      `SELECT token_id, no_token_id, condition_id, question, asset, start_iso, expiry_iso, duration_kind
       FROM poly_binaries
      WHERE asset = ? AND expiry_iso BETWEEN ? AND ?
      ORDER BY ABS(strftime('%s', expiry_iso) - ?) ASC
      LIMIT 1`,
    )
    .get(asset, lo, hi, Math.floor(epochMs / 1000)) as BinaryRow | undefined;
  if (!row) return null;
  return toBinary(row);
}

function toBinary(row: BinaryRow): BinaryWindow {
  const duration = row.duration_kind === "15M" ? 15 : 5;
  return {
    upTokenId: row.token_id,
    downTokenId: row.no_token_id,
    conditionId: row.condition_id,
    question: row.question,
    asset: row.asset,
    startIso: row.start_iso,
    expiryIso: row.expiry_iso,
    durationMin: duration,
  };
}

export function stepWindow(current: BinaryWindow, deltaSlots: number): BinaryWindow | null {
  const expiryMs = parseDbIsoToMs(current.expiryIso);
  if (!Number.isFinite(expiryMs)) return null;
  const target = expiryMs + deltaSlots * current.durationMin * 60_000;
  return findBinaryWindow(current.asset, target);
}

export async function fetchMarketQuote(win: BinaryWindow): Promise<MarketQuote> {
  const fetchSide = async (tokenId: string | null) => {
    if (!tokenId) return null;
    try {
      return await poly.orderbook(tokenId);
    } catch {
      return null;
    }
  };
  const [upBook, downBook] = await Promise.all([fetchSide(win.upTokenId), fetchSide(win.downTokenId)]);
  const ask = (b: any) => {
    if (!b || !Array.isArray(b.asks) || b.asks.length === 0) return { price: null as number | null, depthShares: 0, depthUsd: 0 };
    const cheapest = Number(b.asks[0].price);
    if (!Number.isFinite(cheapest)) return { price: null as number | null, depthShares: 0, depthUsd: 0 };
    let shares = 0;
    let topN = 0;
    let topNUsd = 0;
    for (const a of b.asks) {
      const p = Number(a.price);
      const s = Number(a.size);
      if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
      if (p === cheapest) shares += s;
      if (topN < 3) {
        topN++;
        topNUsd += s * p;
      }
    }
    return { price: cheapest, depthShares: shares, depthUsd: shares * cheapest };
  };
  const bid = (b: any) => {
    if (!b || !Array.isArray(b.bids) || b.bids.length === 0) return null;
    const p = Number(b.bids[0].price);
    return Number.isFinite(p) ? p : null;
  };
  const u = ask(upBook);
  const d = ask(downBook);
  // top-3 depth across both sides
  const top3 = (b: any) => {
    if (!b || !Array.isArray(b.asks)) return 0;
    let n = 0, sumUsd = 0;
    for (const a of b.asks) {
      if (n >= 3) break;
      const p = Number(a.price);
      const s = Number(a.size);
      if (!Number.isFinite(p) || !Number.isFinite(s)) continue;
      sumUsd += p * s;
      n++;
    }
    return sumUsd;
  };
  const topNDepthUsd = top3(upBook) + top3(downBook);
  // Market-implied UP probability — prefer up best-ask, fall back to (1 − down best-ask).
  let upImplied: number | null = null;
  if (u.price != null) upImplied = u.price;
  else if (d.price != null) upImplied = 1 - d.price;
  return {
    upBestAsk: u.price,
    upBestBid: bid(upBook),
    upAskDepthShares: u.depthShares,
    upAskDepthUsd: u.depthUsd,
    downBestAsk: d.price,
    downBestBid: bid(downBook),
    downAskDepthShares: d.depthShares,
    downAskDepthUsd: d.depthUsd,
    topNDepthUsd,
    upImpliedProb: upImplied,
  };
}

export function windowTimeMath(win: BinaryWindow, nowMs: number = Date.now()): WindowTime {
  const expiryMs = parseDbIsoToMs(win.expiryIso);
  // The catalogue's `start_iso` is actually the row's *insertion* time, not
  // the natural window start. Derive the start from `expiry - durationMin`
  // so the progress bar shows the trading window, not "agent was bred X hrs ago".
  const startMs = expiryMs - win.durationMin * 60_000;
  const elapsedMs = nowMs - startMs;
  const totalMs = win.durationMin * 60_000;
  const fractionElapsed = Math.max(0, Math.min(1, elapsedMs / totalMs));
  const optimalLoSec = 2 * 60;
  const optimalHiSec = 3 * 60;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const remainingSec = Math.max(0, Math.floor((expiryMs - nowMs) / 1000));
  return {
    nowIso: new Date(nowMs).toISOString(),
    nowEpochMs: nowMs,
    startEpochMs: Number.isFinite(startMs) ? startMs : null,
    expiryEpochMs: expiryMs,
    elapsedSec,
    remainingSec,
    fractionElapsed,
    optimalBetWindowStartSec: optimalLoSec,
    optimalBetWindowEndSec: optimalHiSec,
    inOptimalBetWindow: elapsedSec >= optimalLoSec && elapsedSec <= optimalHiSec,
    pastOptimalBetWindow: elapsedSec > optimalHiSec,
  };
}

/**
 * SQLite stores 'YYYY-MM-DD HH:MM:SS' (UTC, no T, no Z). The bare format is
 * parsed as LOCAL time by V8 — same fix as match-opportunities + sim.ts.
 */
function parseDbIsoToMs(iso: string): number {
  return Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
}
