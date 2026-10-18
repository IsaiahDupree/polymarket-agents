/**
 * One-shot wallet audit. Pulls live state from data-api.polymarket.com:
 *   - account value
 *   - open positions (with current value + unrealized PnL)
 *   - closed positions (with realized PnL, sorted by P&L)
 *   - recent trade activity
 *
 * Highlights the operator's winners — useful when the operator made
 * manual trades and wants to compare against the bot's auto-trades.
 *
 *   npx tsx scripts/audit-wallet.ts
 *   npx tsx scripts/audit-wallet.ts --address 0x...   # override env
 */
import "./_env.ts";
import { polyFetch } from "@adapters/polymarket/proxy-routing";

type Position = {
  conditionId: string;
  title?: string;
  outcome?: string;
  size: number;
  avgPrice: number;
  curPrice?: number;
  currentValue?: number;
  cashPnl?: number;
  realizedPnl?: number;
  percentPnl?: number;
};

type Trade = {
  timestamp: number;
  conditionId: string;
  title?: string;
  side: "BUY" | "SELL";
  size: number;
  price: number;
  usdcSize: number;
  type?: string;
};

async function get<T>(url: string): Promise<T | { error: string } | null> {
  try {
    const r = await polyFetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { error: `HTTP ${r.status}` } as never;
    return (await r.json()) as T;
  } catch (e) {
    return { error: (e as Error).message } as never;
  }
}

async function main() {
  const argAddr = process.argv.find((a, i) => process.argv[i - 1] === "--address");
  const wallet = (argAddr ?? process.env.POLYMARKET_FUNDER_ADDRESS ?? "").toLowerCase();
  if (!wallet.startsWith("0x")) {
    console.error("[audit-wallet] no wallet address (set POLYMARKET_FUNDER_ADDRESS or pass --address 0x...)");
    process.exit(2);
  }

  console.log(`Wallet: ${wallet}`);
  console.log("=".repeat(72));

  // Account value
  const value = (await get<Array<{ user: string; value: number }>>(`https://data-api.polymarket.com/value?user=${wallet}`)) as Array<{ user: string; value: number }> | { error: string } | null;
  if (Array.isArray(value)) {
    console.log(`\nAccount value: $${value[0]?.value?.toFixed(2) ?? "—"}`);
  } else {
    console.log(`\nAccount value: ${(value as { error?: string })?.error ?? "—"}`);
  }

  // Open positions
  const positions = (await get<Position[]>(`https://data-api.polymarket.com/positions?user=${wallet}&limit=50`)) as Position[] | { error: string } | null;
  console.log(`\n--- Open positions ---`);
  if (Array.isArray(positions) && positions.length > 0) {
    for (const p of positions) {
      const pnl = p.cashPnl ?? p.realizedPnl ?? 0;
      const pnlColor = pnl > 0 ? "+" : "";
      console.log(
        `  ${(p.outcome || "?").padEnd(5)} ${(p.size ?? 0).toFixed(2).padStart(8)} sh @ $${p.avgPrice?.toFixed(3) ?? "?"}  now $${(p.curPrice ?? 0).toFixed(3)}  value $${(p.currentValue ?? 0).toFixed(2)}  pnl ${pnlColor}$${pnl.toFixed(2)}  | ${(p.title || "").slice(0, 50)}`,
      );
    }
  } else if (Array.isArray(positions)) {
    console.log("  (none open)");
  } else {
    console.log(`  ${(positions as { error?: string })?.error ?? "—"}`);
  }

  // Closed positions — sorted by realized PnL
  const closed = (await get<Position[]>(`https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=200`)) as Position[] | { error: string } | null;
  console.log(`\n--- Closed positions (last 200) ---`);
  if (Array.isArray(closed)) {
    const withPnl = closed.filter((p) => typeof p.realizedPnl === "number");
    const sorted = [...withPnl].sort((a, b) => (b.realizedPnl! - a.realizedPnl!));
    const winners = sorted.filter((p) => p.realizedPnl! > 0);
    const losers = sorted.filter((p) => p.realizedPnl! < 0);
    const total = withPnl.reduce((s, p) => s + p.realizedPnl!, 0);

    console.log(`  ${closed.length} positions · ${winners.length} winners · ${losers.length} losers · net $${total.toFixed(2)}`);
    console.log(`\n  TOP 10 WINNERS:`);
    for (const p of sorted.slice(0, 10)) {
      console.log(
        `    +$${p.realizedPnl!.toFixed(2).padStart(7)}  ${(p.outcome || "?").padEnd(5)}  size ${(p.size ?? 0).toFixed(2).padStart(6)}  @ $${p.avgPrice?.toFixed(3) ?? "?"}  | ${(p.title || "").slice(0, 55)}`,
      );
    }
    console.log(`\n  TOP 10 LOSERS:`);
    for (const p of sorted.slice(-10).reverse()) {
      console.log(
        `    -$${Math.abs(p.realizedPnl!).toFixed(2).padStart(7)}  ${(p.outcome || "?").padEnd(5)}  size ${(p.size ?? 0).toFixed(2).padStart(6)}  @ $${p.avgPrice?.toFixed(3) ?? "?"}  | ${(p.title || "").slice(0, 55)}`,
      );
    }
  } else {
    console.log(`  ${(closed as { error?: string })?.error ?? "—"}`);
  }

  // Recent trades — both TRADE and REDEEM
  for (const type of ["TRADE", "REDEEM"]) {
    const acts = (await get<Trade[]>(`https://data-api.polymarket.com/activity?user=${wallet}&limit=20&type=${type}`)) as Trade[] | { error: string } | null;
    console.log(`\n--- Recent ${type} (last 20) ---`);
    if (Array.isArray(acts) && acts.length > 0) {
      for (const a of acts.slice(0, 10)) {
        const ts = new Date(a.timestamp * 1000).toISOString().slice(0, 16).replace("T", " ");
        const side = (a.side ?? "?").padEnd(5);
        console.log(
          `  ${ts}  ${side}  ${(a.size ?? 0).toFixed(2).padStart(8)} sh @ $${a.price?.toFixed(3) ?? "?"}  = $${(a.usdcSize ?? 0).toFixed(2).padStart(7)}  | ${(a.title || a.conditionId?.slice(0, 12) || "").slice(0, 45)}`,
        );
      }
    } else if (Array.isArray(acts)) {
      console.log("  (none)");
    } else {
      console.log(`  ${(acts as { error?: string })?.error ?? "—"}`);
    }
  }
}

main().catch((e) => {
  console.error(`fatal: ${(e as Error).message}`);
  process.exit(1);
});
