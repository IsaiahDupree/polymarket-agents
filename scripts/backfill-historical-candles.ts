/**
 * backfill:historical — page back through Coinbase 1-min candles since coin
 * origination (approx 2017 for BTC) and store in data/historical-candles.db.
 *
 * Resumable: re-reads historical_meta.earliest_ts_unix and continues from there.
 * Idempotent: INSERT OR IGNORE means re-running over already-fetched ranges
 * is a silent skip.
 *
 * Usage:
 *   npm run backfill:historical                       # all 5 assets, default since 2017
 *   npm run backfill:historical -- --assets BTC-USD   # one asset
 *   npm run backfill:historical -- --since 2020-01-01 # different earliest date
 *   npm run backfill:historical -- --dry-run          # show what would happen
 *
 * Rate limit: Coinbase Advanced Trade public market data allows ~10 req/sec
 * per IP. We pace at 8 req/sec for headroom + retry on 429.
 *
 * Cost estimate (BTC, 7y of 1-min candles):
 *   7y × 365 × 24 × 60 = 3.68M candles
 *   ÷ 350 per call     = 10,500 calls
 *   ÷ 8 calls/sec      = ~22 min per asset
 *   × 5 assets         = ~110 min total
 *
 * The historical-candles.db file ends up ~860MB for all 5 assets.
 */
import "./_env.ts";
import { cb } from "../packages/adapters/coinbase/src/client.ts";
import {
  insertCandles,
  upsertMeta,
  openHistoricalDbRW,
  listHistoricalMeta,
  type HistoricalCandleInsert,
} from "../src/lib/historical/db.ts";

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

const DEFAULT_ASSETS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"];
const assets = (arg("assets") ?? DEFAULT_ASSETS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const sinceArg = arg("since") ?? "2017-01-01";
const dryRun = flag("dry-run");
const granularityArg = (arg("granularity") ?? "ONE_MINUTE") as "ONE_MINUTE" | "FIVE_MINUTE" | "FIFTEEN_MINUTE" | "ONE_HOUR" | "ONE_DAY";
const granularitySecMap: Record<string, number> = {
  ONE_MINUTE: 60, FIVE_MINUTE: 300, FIFTEEN_MINUTE: 900, ONE_HOUR: 3600, ONE_DAY: 86_400,
};
const granularitySec = granularitySecMap[granularityArg];
if (!granularitySec) {
  console.error(`unknown granularity=${granularityArg}`);
  process.exit(2);
}

const COINBASE_MAX_CANDLES_PER_CALL = 350;
const RATE_LIMIT_DELAY_MS = 125;  // 8 req/sec

const sinceTsUnix = Math.floor(new Date(sinceArg + "T00:00:00Z").getTime() / 1000);

console.log(`[backfill] assets=${assets.join(",")} granularity=${granularityArg} (${granularitySec}s) since=${sinceArg} (${sinceTsUnix})`);
if (dryRun) console.log("[backfill] DRY-RUN — no writes will happen.");

// ---------------------------------------------------------------------------
// Backfill loop

type CandleResp = { candles: Array<{ start: string; open: string; high: string; low: string; close: string; volume: string }> };

async function fetchOnePage(asset: string, fromTsUnix: number, toTsUnix: number): Promise<HistoricalCandleInsert[]> {
  const resp = await cb.publicGetProductCandles(asset, {
    start: String(fromTsUnix),
    end: String(toTsUnix),
    granularity: granularityArg,
    limit: COINBASE_MAX_CANDLES_PER_CALL,
  }) as CandleResp;
  return (resp.candles ?? [])
    .map((c): HistoricalCandleInsert => ({
      asset,
      granularity_sec: granularitySec,
      start_ts_unix: Number(c.start),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }))
    .filter((c) => Number.isFinite(c.start_ts_unix) && Number.isFinite(c.close));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function backfillAsset(asset: string): Promise<void> {
  const t0 = Date.now();
  // Resume from earliest known candle (if any).
  const meta = listHistoricalMeta().find((m) => m.asset === asset && m.granularity_sec === granularitySec);
  const earliest = meta?.earliest_ts_unix ?? Math.floor(Date.now() / 1000);
  const pageSpanSec = COINBASE_MAX_CANDLES_PER_CALL * granularitySec;
  let cursorEnd = earliest;
  let cursorStart = Math.max(sinceTsUnix, cursorEnd - pageSpanSec);

  let pagesFetched = 0;
  let candlesInserted = 0;
  let candlesFetched = 0;
  let consecutiveEmpty = 0;
  console.log(`[${asset}] resume from earliest=${new Date(earliest * 1000).toISOString().slice(0, 16)} (until ${sinceArg})`);

  while (cursorEnd > sinceTsUnix) {
    pagesFetched += 1;
    if (dryRun) {
      console.log(`  [${asset}] DRY page ${pagesFetched}: ${new Date(cursorStart * 1000).toISOString().slice(0, 16)} → ${new Date(cursorEnd * 1000).toISOString().slice(0, 16)}`);
    } else {
      try {
        const page = await fetchOnePage(asset, cursorStart, cursorEnd);
        candlesFetched += page.length;
        if (page.length === 0) {
          consecutiveEmpty += 1;
          if (consecutiveEmpty >= 3) {
            console.log(`  [${asset}] 3 consecutive empty pages — assuming pre-listing, stopping at ${new Date(cursorStart * 1000).toISOString().slice(0, 10)}`);
            break;
          }
        } else {
          consecutiveEmpty = 0;
          const newRows = insertCandles(page);
          candlesInserted += newRows;
        }
        if (pagesFetched % 50 === 0) {
          const elapsed = (Date.now() - t0) / 1000;
          console.log(`  [${asset}] page ${pagesFetched}: ${new Date(cursorStart * 1000).toISOString().slice(0, 10)} | fetched=${candlesFetched} inserted=${candlesInserted} elapsed=${elapsed.toFixed(0)}s`);
        }
      } catch (err) {
        console.error(`  [${asset}] page ${pagesFetched} err: ${(err as Error).message.slice(0, 200)}`);
        await sleep(2000); // backoff on error
        continue;
      }
      await sleep(RATE_LIMIT_DELAY_MS);
    }
    // Step the cursor back one page.
    cursorEnd = cursorStart - 1;
    cursorStart = Math.max(sinceTsUnix, cursorEnd - pageSpanSec);
  }

  if (!dryRun) {
    upsertMeta(asset, granularitySec);
  }
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`[${asset}] DONE: pages=${pagesFetched} fetched=${candlesFetched} new=${candlesInserted} elapsed=${(elapsed / 60).toFixed(1)}min`);
}

// ---------------------------------------------------------------------------
// Main

async function main(): Promise<void> {
  if (!dryRun) {
    openHistoricalDbRW();  // touch the file so schema applies
  }
  for (const asset of assets) {
    try {
      await backfillAsset(asset);
    } catch (err) {
      console.error(`[${asset}] FATAL: ${(err as Error).message}`);
    }
  }
  // Coverage summary
  const meta = listHistoricalMeta();
  console.log("\ncoverage:");
  for (const m of meta) {
    const earliest = m.earliest_ts_unix ? new Date(m.earliest_ts_unix * 1000).toISOString().slice(0, 10) : "—";
    const latest = m.latest_ts_unix ? new Date(m.latest_ts_unix * 1000).toISOString().slice(0, 10) : "—";
    console.log(`  ${m.asset.padEnd(10)} g=${String(m.granularity_sec).padStart(5)}s  ${earliest} → ${latest}  candles=${m.candles_total}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
