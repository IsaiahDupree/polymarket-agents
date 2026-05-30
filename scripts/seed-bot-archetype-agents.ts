/**
 * Seed 17 paper agents distributed across the 6 Polymarket bot archetypes
 * from docs/prds/poly-up-down-bot-archetypes-2026-05-29.md:
 *
 *   #1 Pure arbitrage         → 3× poly_binary_arbitrage (neutral)
 *   #2 Directional arbitrage  → 2× poly_binary_arbitrage (tilt_up / tilt_down)
 *   #3 Repricing / fair value → 3× poly_short_binary_directional (early entry)
 *   #4 Cross-timeframe        → 3× poly_short_binary_directional (wide window)
 *   #5 Orderbook imbalance    → 3× polymarket_market_maker (small spreads)
 *   #6 Near-resolution        → 3× poly_short_binary_directional (late entry)
 *
 * Each agent gets:
 *   - introduced_by = 'archetype-prd-2026-05-29'
 *   - cash_usd_start = $1000 (default arena bankroll)
 *   - inserted into the current open generation
 *
 * Idempotent: refuses to insert if an agent with the same name already exists.
 *
 * Usage:
 *   npm run seed:bot-archetypes
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertPaperAgent, getCurrentGeneration, listGenerations, startGeneration, markElite } from "../src/lib/arena/db.ts";
import { GenomeSchema, type Genome } from "../src/lib/arena/genome.ts";

type Spec = {
  archetype: string;
  name: string;
  genome: Genome;
};

const INTRODUCED_BY = "archetype-prd-2026-05-29";

function arb(name: string, opts: { max: number; bias: "neutral" | "tilt_up" | "tilt_down"; tilt: number; size: number }): Spec {
  const g = GenomeSchema.parse({
    kind: "poly_binary_arbitrage",
    params: {
      max_combined_price: opts.max,
      min_book_depth_usd: 50,
      max_minutes_to_expiry: 4,
      direction_bias: opts.bias,
      tilt_ratio: opts.tilt,
      entry_size_usd: opts.size,
      assets: "BTC,ETH,SOL,XRP,DOGE,BNB,HYPE",
    },
  });
  return { archetype: opts.bias === "neutral" ? "#1 Pure arb" : "#2 Directional arb", name, genome: g };
}

function shortBinary(name: string, archetype: string, opts: { vel_min: number; vel_pct: number; pre_cutoff_min: number; max_window_min: number; size: number }): Spec {
  const g = GenomeSchema.parse({
    kind: "poly_short_binary_directional",
    params: {
      assets: "BTC,ETH,SOL,XRP,DOGE,BNB,HYPE",
      vel_window_min: opts.vel_min,
      vel_entry_pct: opts.vel_pct,
      pre_cutoff_min: opts.pre_cutoff_min,
      max_window_min: opts.max_window_min,
      max_yes_price_for_buy: 0.75,
      min_yes_price_for_sell: 0.25,
      entry_size_usd: opts.size,
      max_positions_per_asset: 2,
    },
  });
  return { archetype, name, genome: g };
}

function mmAgent(name: string, opts: { spread: number; stop: number; size: number }): Spec {
  const g = GenomeSchema.parse({
    kind: "polymarket_market_maker",
    params: {
      token_id: "any",
      spread_pts: opts.spread,
      stop_pts: opts.stop,
      time_stop_h: 1,
      entry_size_usd: opts.size,
    },
  });
  return { archetype: "#5 Imbalance / MM", name, genome: g };
}

const SPECS: Spec[] = [
  // #1 Pure Arbitrage — three variants on max_combined_price gate tightness
  arb("arb-pure-99-2usd",  { max: 0.99,  bias: "neutral", tilt: 1.0, size: 2 }),
  arb("arb-pure-98-5usd",  { max: 0.98,  bias: "neutral", tilt: 1.0, size: 5 }),
  arb("arb-pure-995-1usd", { max: 0.995, bias: "neutral", tilt: 1.0, size: 1 }),
  // #2 Directional Arbitrage — tilted variants
  arb("arb-tilt-up-99",   { max: 0.99, bias: "tilt_up",   tilt: 2.0, size: 3 }),
  arb("arb-tilt-down-99", { max: 0.99, bias: "tilt_down", tilt: 2.0, size: 3 }),
  // #3 Repricing / Fair Value — early-window entries reading velocity
  shortBinary("repricing-early-fast",  "#3 Repricing", { vel_min: 1, vel_pct: 0.0008, pre_cutoff_min: 2, max_window_min: 5, size: 3 }),
  shortBinary("repricing-early-med",   "#3 Repricing", { vel_min: 2, vel_pct: 0.0012, pre_cutoff_min: 2, max_window_min: 6, size: 5 }),
  shortBinary("repricing-early-slow",  "#3 Repricing", { vel_min: 3, vel_pct: 0.0020, pre_cutoff_min: 2, max_window_min: 8, size: 5 }),
  // #4 Cross-Timeframe — wider max_window_min to catch 15m binaries too
  shortBinary("xtime-wide-fast",  "#4 Cross-timeframe", { vel_min: 1, vel_pct: 0.0010, pre_cutoff_min: 3, max_window_min: 14, size: 3 }),
  shortBinary("xtime-wide-med",   "#4 Cross-timeframe", { vel_min: 2, vel_pct: 0.0015, pre_cutoff_min: 3, max_window_min: 14, size: 5 }),
  shortBinary("xtime-wide-slow",  "#4 Cross-timeframe", { vel_min: 4, vel_pct: 0.0025, pre_cutoff_min: 3, max_window_min: 16, size: 5 }),
  // #5 Orderbook Imbalance — three MM variants with different spread targets
  mmAgent("imbalance-mm-tight", { spread: 1.0, stop: 3, size: 2 }),
  mmAgent("imbalance-mm-mid",   { spread: 2.0, stop: 4, size: 3 }),
  mmAgent("imbalance-mm-wide",  { spread: 3.0, stop: 6, size: 5 }),
  // #6 Near-Resolution — high pre_cutoff_min, low max_window_min, mimicking the
  // late-window-scalp pattern with the short-binary genome
  shortBinary("near-resolution-3m",  "#6 Near-resolution", { vel_min: 1, vel_pct: 0.0005, pre_cutoff_min: 3, max_window_min: 4, size: 2 }),
  shortBinary("near-resolution-35m", "#6 Near-resolution", { vel_min: 1, vel_pct: 0.0005, pre_cutoff_min: 4, max_window_min: 5, size: 2 }),
  shortBinary("near-resolution-4m",  "#6 Near-resolution", { vel_min: 1, vel_pct: 0.0008, pre_cutoff_min: 4, max_window_min: 5, size: 2 }),
];

function main(): void {
  // Use the open gen if one exists; otherwise open a fresh one so the new
  // archetype agents have a generation to attach to. This matches the
  // arena-evolve script's behavior — after sealing, the next gen is opened
  // before the next evolve cycle, so we're not introducing new lifecycle.
  let gen = getCurrentGeneration();
  if (!gen) {
    const last = listGenerations(1)[0];
    const nextNumber = last ? last.gen_number + 1 : 0;
    const newId = startGeneration(nextNumber, undefined, `Opened by seed-bot-archetypes (archetype-prd-2026-05-29)`);
    gen = { id: newId, gen_number: nextNumber } as ReturnType<typeof getCurrentGeneration>;
    console.log(`[seed-bot-archetypes] No open generation found — opened gen ${nextNumber} (id=${newId})`);
  }
  console.log(`[seed-bot-archetypes] Seeding ${SPECS.length} agents into gen ${gen!.gen_number} (id=${gen!.id})`);

  const existsStmt = db().prepare("SELECT id FROM paper_agents WHERE name = ? AND alive = 1");

  let inserted = 0;
  let skipped = 0;
  for (const s of SPECS) {
    const existing = existsStmt.get(s.name) as { id: number } | undefined;
    if (existing) {
      console.log(`  [skip] ${s.name} — already exists as #${existing.id}`);
      skipped++;
      continue;
    }
    const id = insertPaperAgent({
      name: s.name,
      generation: gen!.gen_number,
      genome: s.genome,
      introduced_by: INTRODUCED_BY,
      cash_usd_start: 1000,
    });
    // Mark elite so the agent survives gen seal — PRD seeds should compound
    // across generations, not get culled before they've had a chance to fire.
    markElite(id);
    console.log(`  [ok]   #${id.toString().padStart(4)} ${s.archetype.padEnd(22)} ${s.name} (elite)`);
    inserted++;
  }

  console.log("");
  console.log(`[seed-bot-archetypes] done. inserted=${inserted} skipped=${skipped}`);

  // Summary by archetype
  const grouped = new Map<string, number>();
  for (const s of SPECS) grouped.set(s.archetype, (grouped.get(s.archetype) ?? 0) + 1);
  for (const [arch, n] of grouped) console.log(`  ${arch.padEnd(28)} ${n} agents`);
}

main();
