#!/usr/bin/env tsx
/**
 * worker:book-snapshot — 1 Hz top-of-book poller for the active set of
 * binary tokens. Feeds `book_snapshots`, which the OFI calculator + the
 * Cont-Kukanov-Stoikov strategies read at decide time.
 *
 * Selection model: every cycle we pull the unsettled rows from
 * poly_binaries that expire within `--horizon-min` (default 60 minutes
 * forward) and poll both YES and NO token CLOB books for each. This
 * matches Polymarket's market lifecycle — the upcoming hour of 5-min
 * and 15-min binaries is the universe agents are likely to act on.
 *
 *   npm run worker:book-snapshot                  # forever, 1 s cadence
 *   npm run worker:book-snapshot -- --once        # one pass then exit
 *   npm run worker:book-snapshot -- --horizon-min 30   # narrower universe
 *
 * Polite to the CLOB:
 *   - Skips already-settled markets.
 *   - Hard cap at MAX_TOKENS per cycle (env default 60) — keeps RPS bounded.
 *   - Logs +prunes every PRUNE_EVERY cycles (default 600 → about 10 min).
 *   - Backs off (multiplicative) when /book starts returning 429 or 5xx.
 */
import "./_env.ts";
import { poly } from "@adapters/polymarket/client";
import { db } from "../src/lib/db/client.ts";
import { recordHeartbeat } from "../src/lib/heartbeat.ts";
import {
  parseClobBook,
  recordBookSnapshot,
  pruneOldBookSnapshots,
} from "../src/lib/quant/book-snapshot-lookup.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
const runOnce = process.argv.includes("--once");
const cadenceSec = Number(arg("cadence-sec", "1"));
const horizonMin = Number(arg("horizon-min", "60"));
const maxTokens = Number(process.env.BOOK_SNAPSHOT_MAX_TOKENS ?? "60");
const pruneEvery = Number(process.env.BOOK_SNAPSHOT_PRUNE_EVERY ?? "600");
const keepHours = Number(process.env.BOOK_SNAPSHOT_KEEP_HOURS ?? "24");

let cycleCount = 0;
let backoffMs = 0;  // multiplicative when we see 429/5xx

type BinaryRow = { yes_token_id: string; no_token_id: string | null; question: string };

function pickActiveTokens(): string[] {
  // Active = expires within horizon + not yet settled. We also clip to
  // markets newer than 30 minutes in the past (a market that just
  // resolved is no longer interesting for top-of-book — its book is
  // typically empty).
  const horizonIso = new Date(Date.now() + horizonMin * 60_000).toISOString();
  const minIso = new Date(Date.now() - 30 * 60_000).toISOString();
  const rows = db().prepare(`
    SELECT token_id AS yes_token_id, no_token_id, question
      FROM poly_binaries
     WHERE settled = 0
       AND expiry_iso BETWEEN ? AND ?
     ORDER BY expiry_iso ASC
     LIMIT ?
  `).all(minIso, horizonIso, maxTokens) as BinaryRow[];

  const tokens: string[] = [];
  for (const r of rows) {
    tokens.push(r.yes_token_id);
    if (r.no_token_id) tokens.push(r.no_token_id);
  }
  return tokens;
}

async function pollOne(tokenId: string): Promise<"ok" | "rate-limited" | "error"> {
  try {
    const tsMs = Date.now();
    const book = await poly.orderbook(tokenId);
    const snap = parseClobBook(book, tokenId, tsMs);
    recordBookSnapshot(snap);
    return "ok";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("429") || msg.includes("5")) return "rate-limited";
    if (msg.includes("404")) return "ok"; // market gone; tolerate silently
    return "error";
  }
}

async function pass(): Promise<void> {
  const t0 = Date.now();
  const tokens = pickActiveTokens();
  if (tokens.length === 0) {
    console.log(`[book-snapshot] no active tokens in next ${horizonMin}min — sleeping`);
    return;
  }
  let okCount = 0; let rateLimited = 0; let errorCount = 0;
  // Poll all tokens in parallel — CLOB /book is cheap and the cycle is
  // intentionally tight (1 s). On rate limits we back off below.
  const results = await Promise.all(tokens.map(pollOne));
  for (const r of results) {
    if (r === "ok") okCount++;
    else if (r === "rate-limited") rateLimited++;
    else errorCount++;
  }
  if (rateLimited > 0) {
    backoffMs = Math.min(30_000, Math.max(1_000, backoffMs * 2 || 1_000));
    console.warn(`[book-snapshot] ${rateLimited} rate-limited → backoff ${backoffMs}ms`);
  } else if (backoffMs > 0) {
    backoffMs = Math.max(0, Math.floor(backoffMs / 2));
  }
  cycleCount++;
  if (cycleCount % 60 === 0) {
    console.log(`[book-snapshot] cycle ${cycleCount} | tokens=${tokens.length} ok=${okCount} rate=${rateLimited} err=${errorCount} | took ${Date.now() - t0}ms`);
    // Heartbeat once a minute. Writing every cycle would flood evolution_log.
    recordHeartbeat("book-snapshot", { cycle: cycleCount, tokens: tokens.length, ok: okCount, errors: errorCount });
  }
  if (cycleCount % pruneEvery === 0) {
    const deleted = pruneOldBookSnapshots(keepHours);
    console.log(`[book-snapshot] pruned ${deleted} rows older than ${keepHours}h`);
  }
}

(async () => {
  if (runOnce) {
    await pass();
    return;
  }
  console.log(`[book-snapshot] starting | cadence=${cadenceSec}s horizon=${horizonMin}min maxTokens=${maxTokens}`);
  while (true) {
    const t0 = Date.now();
    try { await pass(); }
    catch (e) { console.error(`[book-snapshot] pass failed: ${e instanceof Error ? e.message : String(e)}`); }
    const elapsed = Date.now() - t0;
    const sleep = Math.max(0, cadenceSec * 1000 - elapsed) + backoffMs;
    await new Promise((r) => setTimeout(r, sleep));
  }
})().catch((e) => {
  console.error(`[book-snapshot] fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
