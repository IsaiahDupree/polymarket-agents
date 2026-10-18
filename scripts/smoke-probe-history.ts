import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { poly } from "@adapters/polymarket/client";

const row = db()
  .prepare(
    "SELECT token_id, question FROM poly_binaries WHERE settled = 0 AND asset = 'BTC' AND duration_kind = '5M' LIMIT 1",
  )
  .get() as { token_id: string; question: string } | undefined;
if (!row) {
  console.log("no BTC 5M markets in DB");
  process.exit(0);
}
console.log(`market: ${row.question}`);
console.log(`token_id: ${row.token_id}\n`);

for (const interval of ["1h", "6h", "1d", "1w", "max"] as const) {
  for (const fid of [1, 5, 60]) {
    try {
      const h = await poly.pricesHistory(row.token_id, interval, fid);
      const arr = h.history ?? [];
      const last = arr[arr.length - 1];
      console.log(
        `  interval=${interval} fid=${fid}: ${arr.length} samples` +
          (last ? ` (last @ ${new Date(last.t * 1000).toISOString()} = ${last.p})` : ""),
      );
    } catch (e) {
      console.log(`  interval=${interval} fid=${fid}: ERROR ${(e as Error).message}`);
    }
  }
}
