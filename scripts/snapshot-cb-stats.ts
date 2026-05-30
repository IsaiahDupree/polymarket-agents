/**
 * snapshot:cb-stats — 24h product stats snapshots from Coinbase.
 *
 * Pulls cb.publicGetProduct(productId) for each configured product and
 * captures the 24-hour rolling fields (price_change_pct, volume, high, low).
 * Writes one row per (product, time) so a strategy can read the latest
 * snapshot OR a series.
 *
 * Much lower frequency than depth/trades — defaults to 5min, --keep-hours
 * defaults to 168h (7 days).
 *
 * Usage:
 *   npx tsx scripts/snapshot-cb-stats.ts
 *   npx tsx scripts/snapshot-cb-stats.ts --products BTC-USD,ETH-USD --interval-sec 300
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
const INTERVAL_SEC = flagNum("interval-sec", 300);
const KEEP_HOURS = flagNum("keep-hours", 168);

console.log(`[snapshot-cb-stats] products=${PRODUCTS.join(",")} interval=${INTERVAL_SEC}s retention=${KEEP_HOURS}h`);

const insertStmt = db().prepare(
  `INSERT INTO coinbase_product_stats
     (product_id, price, volume_24h, volume_24h_usd, price_change_pct_24h, price_high_24h, price_low_24h)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const trimStmt = db().prepare(
  `DELETE FROM coinbase_product_stats WHERE captured_at < datetime('now', ?)`,
);

async function snapshotOnce(product: string): Promise<void> {
  try {
    // publicGetProduct returns the same shape as the authed getProduct.
    const p = await cb.publicGetProduct(product) as {
      price?: string;
      price_percentage_change_24h?: string;
      volume_24h?: string;
      volume_percentage_change_24h?: string;
      // Some Coinbase responses include these too:
      approximate_quote_24h_volume?: string;
      high_24h?: string;
      low_24h?: string;
    };
    const price = Number(p.price);
    if (!Number.isFinite(price)) {
      console.warn(`  [${product}] no price — skipped`);
      return;
    }
    const vol = Number(p.volume_24h);
    const volUsd = Number(p.approximate_quote_24h_volume);
    const changePct = Number(p.price_percentage_change_24h);
    const high = Number(p.high_24h);
    const low = Number(p.low_24h);
    insertStmt.run(
      product, price,
      Number.isFinite(vol) ? vol : null,
      Number.isFinite(volUsd) ? volUsd : null,
      Number.isFinite(changePct) ? changePct : null,
      Number.isFinite(high) ? high : null,
      Number.isFinite(low) ? low : null,
    );
    console.log(`  [${product}] $${price.toFixed(2)} 24h ${Number.isFinite(changePct) ? (changePct >= 0 ? "+" : "") + changePct.toFixed(2) + "%" : "—"} vol=${Number.isFinite(vol) ? vol.toFixed(2) : "—"}`);
  } catch (err) {
    console.error(`  [${product}] err: ${(err as Error).message?.slice(0, 120)}`);
  }
}

async function tick(): Promise<void> {
  await Promise.all(PRODUCTS.map((p) => snapshotOnce(p)));
  trimStmt.run(`-${KEEP_HOURS} hours`);
}

async function main(): Promise<void> {
  process.on("SIGINT", () => { console.log("\n[snapshot-cb-stats] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error("[snapshot-cb-stats] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
  while (true) {
    try { await tick(); }
    catch (err) { console.error("[snapshot-cb-stats] tick err:", (err as Error)?.message?.slice(0, 200)); }
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
