/**
 * Late-window-scalp scanner.
 *
 * Polls poly_binaries (unsettled, has NO token), fetches both Up + Down
 * order books via the proxy-routed Polymarket client, runs the detector,
 * and persists opportunities to evolution_log.
 *
 * Designed for HIGH cadence — these signals only exist for 30-180 seconds.
 * Recommend running every 30 seconds via Task Scheduler (alongside arena
 * tick). Or trigger from a worker loop.
 *
 *   npm run scan:late-window-scalp
 *   npm run scan:late-window-scalp -- --min-ask 0.80 --max-remaining-sec 120 --verbose
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { poly } from "@adapters/polymarket/client";
import {
  detectLateWindowScalp,
  type BinaryBookSnapshot,
} from "../src/lib/strategies/late-window-scalp.ts";
import { recordHeartbeat } from "../src/lib/heartbeat.ts";

const args = process.argv.slice(2);
function flagNum(name: string, fallback: number): number {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return Number(args[i + 1]);
  return fallback;
}
const flag = (name: string) => args.includes(`--${name}`);

const MIN_ASK = flagNum("min-ask", 0.85);
const MAX_ASK = flagNum("max-ask", 0.98);
const MIN_REM_SEC = flagNum("min-remaining-sec", 30);
const MAX_REM_SEC = flagNum("max-remaining-sec", 180);
const MIN_DEPTH = flagNum("min-depth-usd", 2);
const MIN_PAYOFF = flagNum("min-payoff", 0.02);
const FEE_BPS = flagNum("fee-bps", 20);
const LIMIT = flagNum("limit", 100);
const VERBOSE = flag("verbose");

type OrderBookResp = {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
};

/** Top-of-book ask price + USD depth at that price. */
function topAsk(book: OrderBookResp | null): { price: number; depthUsd: number } | null {
  if (!book || !Array.isArray(book.asks) || book.asks.length === 0) return null;
  const cheapest = Number(book.asks[0]!.price);
  if (!Number.isFinite(cheapest)) return null;
  let shares = 0;
  for (const a of book.asks) {
    const p = Number(a.price);
    if (p !== cheapest) break;
    const s = Number(a.size);
    if (Number.isFinite(s)) shares += s;
  }
  return { price: cheapest, depthUsd: shares * cheapest };
}

(async () => {
  console.log(`[scan-late-window-scalp] min_ask=${MIN_ASK} max_ask=${MAX_ASK} window=${MIN_REM_SEC}-${MAX_REM_SEC}s depth≥$${MIN_DEPTH} payoff≥$${MIN_PAYOFF}`);

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  // Only binaries that resolve in the next MAX_REM_SEC seconds — others
  // can't be in our window. Saves polling overhead.
  const cutoffIso = new Date(nowMs + MAX_REM_SEC * 1000).toISOString();
  const binaries = db()
    .prepare(
      `SELECT token_id, condition_id, no_token_id, question, asset, expiry_iso
         FROM poly_binaries
        WHERE settled = 0
          AND no_token_id IS NOT NULL
          AND expiry_iso > ?
          AND expiry_iso <= ?
        ORDER BY expiry_iso ASC
        LIMIT ?`,
    )
    .all(nowIso, cutoffIso, LIMIT) as Array<{
      token_id: string;
      condition_id: string;
      no_token_id: string;
      question: string;
      asset: string;
      expiry_iso: string;
    }>;

  if (binaries.length === 0) {
    console.log(`[scan-late-window-scalp] no binaries resolving in next ${MAX_REM_SEC}s.`);
    recordHeartbeat("snapshot-evolution", { scanner: "late-window-scalp", scanned: 0, opportunities: 0 });
    return;
  }
  console.log(`[scan-late-window-scalp] ${binaries.length} candidate binaries…`);

  let scanned = 0;
  let opportunities = 0;
  let bestPayoff = 0;

  for (const b of binaries) {
    scanned++;
    let upBook: OrderBookResp | null = null;
    let downBook: OrderBookResp | null = null;
    try {
      upBook = (await poly.orderbook(b.token_id)) as OrderBookResp;
    } catch (err) {
      if (VERBOSE) console.warn(`  ! ${b.condition_id.slice(0, 10)} up-book: ${(err as Error).message?.slice(0, 60)}`);
      continue;
    }
    try {
      downBook = (await poly.orderbook(b.no_token_id)) as OrderBookResp;
    } catch (err) {
      if (VERBOSE) console.warn(`  ! ${b.condition_id.slice(0, 10)} down-book: ${(err as Error).message?.slice(0, 60)}`);
      continue;
    }

    const upAsk = topAsk(upBook);
    const downAsk = topAsk(downBook);
    if (!upAsk || !downAsk) continue;

    const snapshot: BinaryBookSnapshot = {
      conditionId: b.condition_id,
      title: b.question,
      asset: b.asset,
      windowCloseMs: Date.parse(b.expiry_iso),
      nowMs,
      upBestAsk: upAsk.price,
      downBestAsk: downAsk.price,
      upDepthUsd: upAsk.depthUsd,
      downDepthUsd: downAsk.depthUsd,
    };

    const opp = detectLateWindowScalp(snapshot, {
      minAsk: MIN_ASK,
      maxAsk: MAX_ASK,
      minRemainingSec: MIN_REM_SEC,
      maxRemainingSec: MAX_REM_SEC,
      minDepthUsd: MIN_DEPTH,
      minPayoffPerShare: MIN_PAYOFF,
      feeBps: FEE_BPS,
    });

    if (!opp) {
      if (VERBOSE) {
        const combined = (upAsk.price + downAsk.price).toFixed(3);
        console.log(`  - ${b.condition_id.slice(0, 10)} ${b.asset.padEnd(5)} U${upAsk.price.toFixed(2)}/D${downAsk.price.toFixed(2)} combined ${combined} — no signal`);
      }
      continue;
    }

    opportunities++;
    if (opp.max_payoff_usd > bestPayoff) bestPayoff = opp.max_payoff_usd;
    console.log(`  ✓ ${b.condition_id.slice(0, 10)} ${b.asset.padEnd(5)} ${opp.reason}`);

    insertEvolutionEvent({
      event_type: "late-window-scalp-opportunity",
      summary: opp.reason.slice(0, 200),
      payload_json: JSON.stringify({
        conditionId: opp.conditionId,
        title: opp.title,
        asset: opp.asset,
        side: opp.side,
        entry_price: opp.entry_price,
        payoff_per_share: opp.payoff_per_share,
        max_shares: opp.max_shares,
        capital_required_usd: opp.capital_required_usd,
        max_payoff_usd: opp.max_payoff_usd,
        remaining_sec: opp.remaining_sec,
        scan_ts: nowIso,
        token_id: opp.side === "UP" ? b.token_id : b.no_token_id,
      }),
    });
  }

  console.log("");
  console.log(`[scan-late-window-scalp] scanned ${scanned} · opportunities ${opportunities} · best $${bestPayoff.toFixed(2)}`);
  recordHeartbeat("snapshot-evolution", { scanner: "late-window-scalp", scanned, opportunities, best_payoff: bestPayoff });
})().catch((err) => {
  console.error(`[scan-late-window-scalp] fatal: ${(err as Error).message}`);
  process.exit(1);
});
