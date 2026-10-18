/**
 * Seed 3 "Hermes-style" multi_strategy agents inspired by @antpalkin's
 * Polymarket Hermes/Opus stack (cvxv666 article, May 24 2026):
 *
 *   Claude Opus 4.7 scores every 5-min BTC market by Markov persistence
 *   × Kelly edge, surfacing the windows where Polymarket hasn't priced in
 *   what Binance and Coinbase already confirmed. Hermes executes.
 *
 * We don't have Hermes itself, and we can't run a nightly self-rewriting
 * .env loop yet — but we can compose the two existing genome kinds that
 * map most directly onto the described pipeline:
 *
 *   1. llm_probability_oracle — Opus/Haiku scoring P_true → EV/Kelly rail
 *   2. poly_short_binary_directional — reads CB velocity → 5-min binary
 *                                      directional execution (the lag-capture)
 *
 * Three agents seeded:
 *   hermes-opus-tight   — Opus model, tight min_ev_pct (0.10), conservative
 *   hermes-opus-balanced — Opus model, medium min_ev_pct (0.06), balanced
 *   hermes-haiku-fast   — Haiku model (cheap), looser min_ev_pct (0.05), fast
 *
 * Tagged introduced_by='hermes-archetype-2026-05-29' so the LiveBinaryPanel's
 * archetypes toggle surfaces them alongside the 17 PRD-seeded agents.
 *
 * Usage:
 *   npm run seed:hermes-archetype
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertPaperAgent, getCurrentGeneration, listGenerations, startGeneration, markElite } from "../src/lib/arena/db.ts";
import { GenomeSchema, type Genome } from "../src/lib/arena/genome.ts";

const INTRODUCED_BY = "hermes-archetype-2026-05-29";

function hermes(name: string, model: "claude-opus-4-7" | "claude-haiku-4-5-20251001" | "claude-sonnet-4-6", minEv: number, velPct: number, size: number): { name: string; genome: Genome } {
  const g = GenomeSchema.parse({
    kind: "multi_strategy",
    params: {
      selection: "priority",
      entry_size_usd: size,
      subs: [
        {
          kind: "llm_probability_oracle",
          params: {
            model,
            min_ev_pct: minEv,
            max_calls_per_tick: 2,
            prompt_version: "v1",
            cache_ttl_min: 10,
            entry_size_usd: size,
          },
        },
        {
          kind: "poly_short_binary_directional",
          params: {
            assets: "BTC,ETH,SOL,XRP,DOGE,BNB,HYPE",
            vel_window_min: 2,
            vel_entry_pct: velPct,
            pre_cutoff_min: 2,
            max_window_min: 6,
            max_yes_price_for_buy: 0.80,
            min_yes_price_for_sell: 0.20,
            entry_size_usd: size,
            max_positions_per_asset: 2,
          },
        },
      ],
    },
  });
  return { name, genome: g };
}

// entry_size_usd has different floors per sub-genome (llm_probability_oracle
// requires ≥ 5). Keep the composite sizing ≥ 5 so both subs validate.
const SPECS = [
  hermes("hermes-opus-tight",    "claude-opus-4-7",            0.10, 0.0015, 5),
  hermes("hermes-opus-balanced", "claude-opus-4-7",            0.06, 0.0010, 8),
  hermes("hermes-haiku-fast",    "claude-haiku-4-5-20251001",  0.05, 0.0008, 5),
];

function main(): void {
  let gen = getCurrentGeneration();
  if (!gen) {
    const last = listGenerations(1)[0];
    const nextNumber = last ? last.gen_number + 1 : 0;
    const newId = startGeneration(nextNumber, undefined, "Opened by seed-hermes-archetype");
    gen = { id: newId, gen_number: nextNumber } as ReturnType<typeof getCurrentGeneration>;
    console.log(`[seed-hermes] No open generation — opened gen ${nextNumber} (id=${newId})`);
  }
  console.log(`[seed-hermes] Seeding ${SPECS.length} Hermes-style multi_strategy agents into gen ${gen!.gen_number}`);

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
    markElite(id);  // PRD seeds survive future gen culls
    console.log(`  [ok]   #${id.toString().padStart(4)} ${s.name} (elite)`);
    inserted++;
  }
  console.log("");
  console.log(`[seed-hermes] done. inserted=${inserted} skipped=${skipped}`);
}

main();
