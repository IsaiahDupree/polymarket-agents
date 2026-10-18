/**
 * snapshot:cb-trades — polling firehose of Coinbase market trades.
 *
 * Pulls cb.getMarketTrades(product, limit=100) every interval, INSERT OR
 * IGNORE so trade_id collisions are silently skipped (idempotent). Captures
 * the taker side + USD-notional per trade so flow-based decision functions
 * can compute arrival rate, buy/sell volume split, and trade-size stats from
 * a single SELECT.
 *
 * Retention via --keep-hours (default 48h).
 *
 * Usage:
 *   npx tsx scripts/snapshot-cb-trades.ts
 *   npx tsx scripts/snapshot-cb-trades.ts --products BTC-USD,ETH-USD --interval-sec 20
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
const INTERVAL_SEC = flagNum("interval-sec", 20);
const KEEP_HOURS = flagNum("keep-hours", 48);
const LIMIT_PER_PULL = 100;

console.log(`[snapshot-cb-trades] products=${PRODUCTS.join(",")} interval=${INTERVAL_SEC}s retention=${KEEP_HOURS}h limit=${LIMIT_PER_PULL}/pull`);

const insertStmt = db().prepare(
  `INSERT OR IGNORE INTO coinbase_trades
     (product_id, trade_id, price, size, size_usd, side, trade_time)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const trimStmt = db().prepare(
  `DELETE FROM coinbase_trades WHERE captured_at < datetime('now', ?)`,
);

async function pullProduct(product: string): Promise<{ inserted: number; pulled: number }> {
  try {
    const resp = await cb.getMarketTrades(product, { limit: LIMIT_PER_PULL }) as {
      trades?: Array<{ trade_id?: string; product_id?: string; price?: string; size?: string; time?: string; side?: string }>;
    };
    const trades = resp.trades ?? [];
    let inserted = 0;
    for (const t of trades) {
      if (!t.trade_id || !t.price || !t.size || !t.time || !t.side) continue;
      const price = Number(t.price);
      const size = Number(t.size);
      if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
      const side = t.side.toUpperCase() === "BUY" ? "BUY" : "SELL";
      const result = insertStmt.run(product, t.trade_id, price, size, price * size, side, t.time);
      if (result.changes > 0) inserted++;
    }
    return { inserted, pulled: trades.length };
  } catch (err) {
    console.error(`  [${product}] err: ${(err as Error).message?.slice(0, 120)}`);
    return { inserted: 0, pulled: 0 };
  }
}

async function tick(): Promise<void> {
  const results = await Promise.all(PRODUCTS.map(async (p) => ({ p, r: await pullProduct(p) })));
  for (const { p, r } of results) {
    if (r.pulled > 0 || r.inserted > 0) {
      console.log(`  [${p}] pulled=${r.pulled} new=${r.inserted}`);
    }
  }
  trimStmt.run(`-${KEEP_HOURS} hours`);
}

async function main(): Promise<void> {
  process.on("SIGINT", () => { console.log("\n[snapshot-cb-trades] SIGINT — stopping"); process.exit(0); });
  // Unhandled-rejection guard: a stray promise from a previous tick can
  // crash the loop with exit 0. Catch + log so the process keeps running.
  process.on("unhandledRejection", (reason) => {
    console.error("[snapshot-cb-trades] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
  while (true) {
    try {
      await tick();
    } catch (err) {
      // tick() already catches per-product errors, but belt+braces here so
      // a top-level fetch timeout or DB lock can't kill the loop.
      console.error("[snapshot-cb-trades] tick err:", (err as Error)?.message?.slice(0, 200));
    }
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
