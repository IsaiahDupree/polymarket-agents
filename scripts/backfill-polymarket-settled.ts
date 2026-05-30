/**
 * backfill:polymarket-settled — page back through closed Polymarket events
 * and store every resolved crypto Up/Down binary's outcome in
 * data/historical-candles.db / poly_binaries_settled_history.
 *
 * Stored fields:
 *   - condition_id, question, asset (BTC|ETH|SOL|...), duration_kind (5M|15M|...)
 *   - start_ts_unix, expiry_ts_unix
 *   - up_token_id, down_token_id
 *   - winner: 'UP' | 'DOWN' | 'INVALID'
 *   - source = 'gamma'
 *
 * Resumable via the earliest-stored expiry — script paginates backwards from
 * the earliest known expiry to the configured --since date (default 2022-01-01,
 * when Polymarket's 5M crypto binaries became regular).
 *
 * Usage:
 *   npm run backfill:poly-settled
 *   npm run backfill:poly-settled -- --since 2024-01-01
 *   npm run backfill:poly-settled -- --assets BTC,ETH    # only certain assets
 *   npm run backfill:poly-settled -- --dry-run --pages 3 # show 3 pages, no writes
 *
 * Rate limit: Gamma is friendly but page size is capped at 100 events. We
 * pace at 5 req/sec.
 *
 * Cost estimate (3 years of 5M binaries, ~5 assets):
 *   5 assets × 288 binaries/day × 365 × 3 = ~1.6M binaries
 *   ÷ 100 per page                          = ~16k pages
 *   ÷ 5 pages/sec                           = ~55 min
 */
import "./_env.ts";
import { poly } from "../packages/adapters/polymarket/src/client.ts";
import { openHistoricalDbRW } from "../src/lib/historical/db.ts";

// ---------------------------------------------------------------------------
// CLI args

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const sinceArg = arg("since") ?? "2022-01-01";
const assetsFilter = (arg("assets") ?? "BTC,ETH,SOL,XRP,DOGE,BNB,HYPE").split(",").map((s) => s.trim().toUpperCase());
const maxPages = Number(arg("pages") ?? "999999");
const dryRun = flag("dry-run");

const sinceMs = new Date(sinceArg + "T00:00:00Z").getTime();
const RATE_LIMIT_DELAY_MS = 200;  // 5 req/sec
const PAGE_SIZE = 100;

console.log(`[backfill-poly] since=${sinceArg} assets=${assetsFilter.join(",")} dry-run=${dryRun} max-pages=${maxPages}`);

// ---------------------------------------------------------------------------
// Parsing helpers

const TITLE_RE = /^(Bitcoin|Ethereum|Solana|XRP|Dogecoin|BNB|Hype|Hyperliquid)\s+(?:Up or Down|Higher or Lower)/i;
const ASSET_MAP: Record<string, string> = {
  bitcoin: "BTC", ethereum: "ETH", solana: "SOL", xrp: "XRP",
  dogecoin: "DOGE", bnb: "BNB", hype: "HYPE", hyperliquid: "HYPE",
};

/**
 * Parse "9:25PM-9:30PM ET" out of an event title and return the duration in
 * minutes (e.g. 5 for that example). Returns null when no explicit range is
 * present in the title (i.e. daily binary like "Bitcoin Up or Down - May 28").
 *
 * The regex tolerates spacing variations and AM/PM in either or both ends.
 */
const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?(AM|PM)\s*-\s*(\d{1,2})(?::(\d{2}))?(AM|PM)/i;
function parseTitleDurationMinutes(title: string): number | null {
  const m = TIME_RANGE_RE.exec(title);
  if (!m) return null;
  const startMin = toMinutes(Number(m[1]), Number(m[2] ?? "0"), m[3]);
  const endMin = toMinutes(Number(m[4]), Number(m[5] ?? "0"), m[6]);
  let span = endMin - startMin;
  if (span <= 0) span += 24 * 60; // crosses midnight
  return span;
}
function toMinutes(h: number, m: number, ampm: string): number {
  let hh = h % 12;
  if (ampm.toUpperCase() === "PM") hh += 12;
  return hh * 60 + m;
}

type ParsedBinary = {
  condition_id: string;
  question: string;
  asset: string;
  duration_kind: string;  // '5M' | '15M' | etc.
  start_ts_unix: number;
  expiry_ts_unix: number;
  up_token_id: string;
  down_token_id: string;
  winner: "UP" | "DOWN" | "INVALID";
};

function parseUpDownBinary(eventTitle: string, market: any): ParsedBinary | null {
  if (typeof eventTitle !== "string") return null;
  const m = TITLE_RE.exec(eventTitle);
  if (!m) return null;
  const asset = ASSET_MAP[m[1].toLowerCase()];
  if (!asset) return null;

  // Required fields
  const conditionId = market.conditionId;
  const startIso = market.startDate ?? market.startDateIso;
  const endIso = market.endDate ?? market.endDateIso;
  if (!conditionId || !startIso || !endIso) return null;

  // Parse outcomes + outcomePrices (stored as JSON strings)
  let outcomes: string[]; let prices: string[]; let tokenIds: string[];
  try {
    outcomes = JSON.parse(market.outcomes ?? "[]");
    prices = JSON.parse(market.outcomePrices ?? "[]");
    tokenIds = JSON.parse(market.clobTokenIds ?? "[]");
  } catch {
    return null;
  }
  if (outcomes.length !== 2 || prices.length !== 2 || tokenIds.length !== 2) return null;

  // Identify UP vs DOWN by outcome label
  const upIdx = outcomes.findIndex((o) => /up|higher/i.test(o));
  const downIdx = outcomes.findIndex((o) => /down|lower/i.test(o));
  if (upIdx === -1 || downIdx === -1) return null;
  const upTokenId = tokenIds[upIdx];
  const downTokenId = tokenIds[downIdx];

  // Winner: the side with final price = "1" (vs "0")
  const upWon = Number(prices[upIdx]) >= 0.5;
  const downWon = Number(prices[downIdx]) >= 0.5;
  const winner: ParsedBinary["winner"] =
    upWon && !downWon ? "UP" :
    downWon && !upWon ? "DOWN" :
    "INVALID";

  // Duration: prefer parsing the title's explicit time-range (e.g.
  // "9:25PM-9:30PM ET" = 5 min). market.startDate is the market CREATION
  // time, not the trading window start, so subtracting it from endDate
  // misclassifies every short binary as 1D.
  const expiryTs = Math.floor(new Date(endIso).getTime() / 1000);
  const titleRangeMinutes = parseTitleDurationMinutes(eventTitle);
  let startTs: number;
  let durationKind: string;
  if (titleRangeMinutes != null) {
    startTs = expiryTs - titleRangeMinutes * 60;
    durationKind =
      titleRangeMinutes <= 5  ? "5M" :
      titleRangeMinutes <= 15 ? "15M" :
      titleRangeMinutes <= 60 ? "1H" :
      titleRangeMinutes <= 6 * 60  ? "6H" :
      titleRangeMinutes <= 24 * 60 ? "1D" :
      "LONG";
  } else {
    // No explicit range in title — fall back to a coarse classification.
    // Title without a time range usually means daily resolution (resolves
    // on the calendar date in the title).
    startTs = Math.floor(new Date(startIso).getTime() / 1000);
    durationKind = "1D";
  }

  return {
    condition_id: conditionId,
    question: market.question ?? eventTitle,
    asset,
    duration_kind: durationKind,
    start_ts_unix: startTs,
    expiry_ts_unix: expiryTs,
    up_token_id: upTokenId,
    down_token_id: downTokenId,
    winner,
  };
}

// ---------------------------------------------------------------------------
// Scrape loop

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function getEarliestExpiry(): Promise<number | null> {
  if (dryRun) return null;
  const db = openHistoricalDbRW();
  const row = db
    .prepare("SELECT MIN(expiry_ts_unix) AS earliest FROM poly_binaries_settled_history")
    .get() as { earliest: number | null };
  return row?.earliest ?? null;
}

async function backfill(): Promise<void> {
  const t0 = Date.now();
  let cursorIso = new Date().toISOString();
  const earliest = await getEarliestExpiry();
  if (earliest && earliest * 1000 > sinceMs) {
    cursorIso = new Date(earliest * 1000).toISOString();
    console.log(`[backfill-poly] resuming from earliest stored expiry=${cursorIso}`);
  }

  const db = !dryRun ? openHistoricalDbRW() : null;
  const insertStmt = db?.prepare(
    `INSERT OR IGNORE INTO poly_binaries_settled_history
       (condition_id, question, asset, duration_kind, start_ts_unix, expiry_ts_unix,
        up_token_id, down_token_id, winner, source)
     VALUES
       (@condition_id, @question, @asset, @duration_kind, @start_ts_unix, @expiry_ts_unix,
        @up_token_id, @down_token_id, @winner, 'gamma')`,
  );

  let pagesFetched = 0;
  let eventsScanned = 0;
  let binariesInserted = 0;
  let binariesSkippedNotCrypto = 0;
  let binariesSkippedAsset = 0;
  let consecutiveEmpty = 0;

  while (pagesFetched < maxPages) {
    pagesFetched += 1;
    try {
      const events = await poly.events({
        limit: PAGE_SIZE,
        closed: true,
        end_date_max: cursorIso,
        order: "endDate",
        ascending: false,
      });
      if (events.length === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= 3) {
          console.log(`[backfill-poly] 3 consecutive empty pages — stopping at ${cursorIso}`);
          break;
        }
        await sleep(RATE_LIMIT_DELAY_MS);
        continue;
      }
      consecutiveEmpty = 0;

      // Find the OLDEST endDate in this page to advance the cursor.
      let oldestEndMs = Infinity;
      const parsedThisPage: ParsedBinary[] = [];
      for (const ev of events) {
        eventsScanned += 1;
        const evEndMs = new Date(ev.endDate ?? ev.closedTime ?? cursorIso).getTime();
        if (Number.isFinite(evEndMs) && evEndMs < oldestEndMs) oldestEndMs = evEndMs;

        const markets = Array.isArray(ev.markets) ? ev.markets : [];
        for (const m of markets) {
          const parsed = parseUpDownBinary(ev.title, m);
          if (!parsed) { binariesSkippedNotCrypto += 1; continue; }
          if (!assetsFilter.includes(parsed.asset)) { binariesSkippedAsset += 1; continue; }
          parsedThisPage.push(parsed);
        }
      }
      if (!dryRun && db && insertStmt) {
        const tx = db.transaction((batch: ParsedBinary[]) => {
          for (const b of batch) {
            const r = insertStmt.run(b);
            if (r.changes > 0) binariesInserted += 1;
          }
        });
        tx(parsedThisPage);
      } else {
        binariesInserted += parsedThisPage.length;
      }

      if (Number.isFinite(oldestEndMs) && oldestEndMs <= sinceMs) {
        console.log(`[backfill-poly] reached --since cutoff (${sinceArg}) at page ${pagesFetched}`);
        break;
      }

      if (Number.isFinite(oldestEndMs)) {
        // Move cursor 1 second before the oldest so the next page picks up
        // from "earlier than that".
        cursorIso = new Date(oldestEndMs - 1000).toISOString();
      }

      if (pagesFetched % 10 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        console.log(
          `  page ${pagesFetched}: cursor=${cursorIso.slice(0, 10)}  scanned=${eventsScanned}  inserted=${binariesInserted}  elapsed=${elapsed.toFixed(0)}s`,
        );
      }
    } catch (err) {
      console.error(`  page ${pagesFetched} err: ${(err as Error).message.slice(0, 200)}`);
      await sleep(2000);
      continue;
    }
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\n[backfill-poly] DONE: pages=${pagesFetched} events=${eventsScanned} inserted=${binariesInserted} skipped(not-crypto)=${binariesSkippedNotCrypto} skipped(asset-filter)=${binariesSkippedAsset} elapsed=${(elapsed / 60).toFixed(1)}min`);

  if (!dryRun) {
    const summary = openHistoricalDbRW()
      .prepare(
        `SELECT asset, duration_kind, COUNT(*) AS n, MIN(expiry_ts_unix) AS earliest, MAX(expiry_ts_unix) AS latest
           FROM poly_binaries_settled_history GROUP BY asset, duration_kind ORDER BY asset, duration_kind`,
      )
      .all() as Array<{ asset: string; duration_kind: string; n: number; earliest: number; latest: number }>;
    console.log("\ncoverage:");
    for (const s of summary) {
      const earliest = new Date(s.earliest * 1000).toISOString().slice(0, 10);
      const latest = new Date(s.latest * 1000).toISOString().slice(0, 10);
      console.log(`  ${s.asset.padEnd(8)} ${s.duration_kind.padEnd(4)} ${earliest} → ${latest}  n=${s.n}`);
    }
  }
}

backfill().catch((err) => { console.error(err); process.exit(1); });
