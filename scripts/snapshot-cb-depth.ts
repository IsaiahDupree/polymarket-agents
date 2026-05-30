/**
 * snapshot:cb-depth — periodic L2 orderbook snapshots from Coinbase.
 *
 * Pulls cb.getProductBook(limit=10) for a configured list of products at a
 * fixed cadence. Writes one row per (product, time) to coinbase_l2_snapshots
 * with the top 10 bid + ask levels and pre-computed total notional + the
 * imbalance ratio so decision functions can SELECT a single row.
 *
 * Retention is enforced inline (--keep-hours, default 24h) — the table is
 * append-only, so without trimming it would grow unbounded.
 *
 * Usage:
 *   npx tsx scripts/snapshot-cb-depth.ts
 *   npx tsx scripts/snapshot-cb-depth.ts --products BTC-USD,ETH-USD,SOL-USD --interval-sec 30
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { cb } from "@adapters/coinbase/client";

const args = process.argv.slice(2);
function flagStr(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function flagNum(name: string, fallback: number): number {
  const v = flagStr(name, "");
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PRODUCTS = flagStr("products", "BTC-USD,ETH-USD,SOL-USD").split(",").map((s) => s.trim()).filter(Boolean);
const INTERVAL_SEC = flagNum("interval-sec", 30);
const KEEP_HOURS = flagNum("keep-hours", 24);
const DEPTH = 10;

console.log(`[snapshot-cb-depth] products=${PRODUCTS.join(",")} interval=${INTERVAL_SEC}s retention=${KEEP_HOURS}h`);

type Level = { price: number; size_usd: number };

function topLevels(book: { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> }, side: "bid" | "ask", depth: number): Level[] {
  const arr = side === "bid" ? book.bids : book.asks;
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, depth).map((lvl) => {
    const p = Number(lvl.price);
    const s = Number(lvl.size);
    if (!Number.isFinite(p) || !Number.isFinite(s)) return null;
    return { price: p, size_usd: p * s };
  }).filter((x): x is Level => x !== null);
}

const insertStmt = db().prepare(
  `INSERT INTO coinbase_l2_snapshots
     (product_id, bid_levels_json, ask_levels_json, total_bid_usd, total_ask_usd, imbalance_ratio)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
const trimStmt = db().prepare(
  `DELETE FROM coinbase_l2_snapshots WHERE captured_at < datetime('now', ?)`,
);

async function snapshotOnce(product: string): Promise<void> {
  try {
    const book = await cb.getProductBook({ product_id: product, limit: DEPTH }) as {
      pricebook?: { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> };
      bids?: Array<{ price: string; size: string }>;
      asks?: Array<{ price: string; size: string }>;
    };
    // Coinbase wraps the book in a `pricebook` envelope on Advanced Trade.
    const inner = book.pricebook ?? book;
    const bids = topLevels(inner, "bid", DEPTH);
    const asks = topLevels(inner, "ask", DEPTH);
    if (bids.length === 0 && asks.length === 0) {
      console.warn(`  [${product}] empty book — skipped`);
      return;
    }
    const totalBid = bids.reduce((s, l) => s + l.size_usd, 0);
    const totalAsk = asks.reduce((s, l) => s + l.size_usd, 0);
    const ratio = totalBid + totalAsk > 0 ? totalBid / (totalBid + totalAsk) : 0.5;
    insertStmt.run(product, JSON.stringify(bids), JSON.stringify(asks), totalBid, totalAsk, ratio);
    console.log(`  [${product}] bid=$${totalBid.toFixed(0)} ask=$${totalAsk.toFixed(0)} imbalance=${(ratio * 100).toFixed(1)}%`);
  } catch (err) {
    console.error(`  [${product}] err: ${(err as Error).message?.slice(0, 120)}`);
  }
}

async function tick(): Promise<void> {
  await Promise.all(PRODUCTS.map((p) => snapshotOnce(p)));
  trimStmt.run(`-${KEEP_HOURS} hours`);
}

async function main(): Promise<void> {
  process.on("SIGINT", () => { console.log("\n[snapshot-cb-depth] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error("[snapshot-cb-depth] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
  while (true) {
    try { await tick(); }
    catch (err) { console.error("[snapshot-cb-depth] tick err:", (err as Error)?.message?.slice(0, 200)); }
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
