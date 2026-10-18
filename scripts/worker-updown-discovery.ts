/**
 * worker:updown-discovery — periodic scanner for the live BTC/ETH/SOL/XRP
 * Up-Down crypto binary series on Polymarket. Without this worker the
 * arena was using event-resolution markets (Kraken IPO, MSTR sells BTC,
 * etc.) as its data substrate, which is the WRONG market type for the
 * strategies we've ported (markov_persistence, poly_repricing,
 * poly_near_resolution, poly_short_binary_directional).
 *
 * Each cycle:
 *   1. For every (asset, recurrence) in (BTC,ETH,SOL,XRP,DOGE × 5m,15m)
 *      compute the slug list for [lookback, current, …, lookahead].
 *   2. Hit Gamma /markets?slug=… for each — deterministic, no pagination.
 *   3. Upsert resolving ones into poly_binaries with proper duration_kind
 *      so getBinaryMeta(tokenId) returns valid metadata at decide time.
 *   4. Log the cycle result to evolution_log for the operator dashboard.
 *
 * Default cadence: 60 s. This is fast enough to catch new windows as
 * Polymarket publishes them but slow enough to be polite to the Gamma
 * endpoint. Override with --interval-sec.
 *
 *   npm run worker:updown-discovery               # forever, 60 s
 *   npm run worker:updown-discovery -- --once     # one pass then exit
 *   npm run worker:updown-discovery -- --assets BTC,ETH --recurrences 5m
 *
 * Source mapping: polymarket-2dollar-bot/scripts/scan_updown.py.
 */
import "./_env.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import {
  scanAndUpsertUpdownWindows,
  type Recurrence,
} from "../src/lib/scanners/updown-discovery.ts";
import type { BinaryAsset } from "../src/lib/arena/short-binaries.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const intervalSec = Number(arg("interval-sec", "60"));
const runOnce = flag("once");
const dryRun = flag("dry-run");

const ASSETS: BinaryAsset[] = (arg("assets", "BTC,ETH,SOL,XRP,DOGE") ?? "BTC")
  .split(",")
  .map((s) => s.trim().toUpperCase() as BinaryAsset);
const RECURRENCES: Recurrence[] = (arg("recurrences", "5m,15m") ?? "5m")
  .split(",")
  .map((s) => s.trim() as Recurrence);
const LOOKAHEAD = Number(arg("lookahead", "3"));
const LOOKBACK = Number(arg("lookback", "1"));

async function pass(): Promise<void> {
  const t0 = Date.now();
  if (dryRun) {
    console.log(
      `[updown-discovery] DRY-RUN: would scan ${ASSETS.join(",")} × ${RECURRENCES.join(",")} ` +
      `with lookback=${LOOKBACK} lookahead=${LOOKAHEAD}`,
    );
    return;
  }
  try {
    const r = await scanAndUpsertUpdownWindows({
      assets: ASSETS,
      recurrences: RECURRENCES,
      lookahead: LOOKAHEAD,
      lookback: LOOKBACK,
    });
    const elapsedMs = Date.now() - t0;
    console.log(
      `[updown-discovery] pass: attempted=${r.attempted} fetched=${r.fetched} ` +
      `upserted=${r.upserted} not_found=${r.notFound} errors=${r.errors} ` +
      `elapsed=${elapsedMs}ms`,
    );
    if (r.missingSlugs.length > 0) {
      console.log(`[updown-discovery]   missing (sample): ${r.missingSlugs.slice(0, 3).join(", ")}`);
    }
    try {
      insertEvolutionEvent({
        event_type: "updown-discovery",
        summary:
          `attempted=${r.attempted} fetched=${r.fetched} upserted=${r.upserted} ` +
          `not_found=${r.notFound} errors=${r.errors}`,
        payload_json: JSON.stringify({
          assets: ASSETS,
          recurrences: RECURRENCES,
          attempted: r.attempted,
          fetched: r.fetched,
          upserted: r.upserted,
          not_found: r.notFound,
          errors: r.errors,
          elapsed_ms: elapsedMs,
        }),
      });
    } catch (logErr) {
      console.error(`[updown-discovery] failed to log: ${(logErr as Error).message}`);
    }
  } catch (err) {
    console.error(`[updown-discovery] cycle error: ${(err as Error).message}`);
  }
}

console.log(
  `[updown-discovery] starting (interval=${intervalSec}s once=${runOnce} ` +
  `dry=${dryRun} assets=${ASSETS.join(",")} recurrences=${RECURRENCES.join(",")})`,
);
await pass();
if (!runOnce) {
  setInterval(pass, intervalSec * 1000);
  process.on("SIGINT", () => { console.log("\n[updown-discovery] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error(`[updown-discovery] unhandledRejection: ${(reason as Error)?.message ?? reason}`);
  });
}
