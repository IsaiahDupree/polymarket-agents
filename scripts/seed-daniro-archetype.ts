/**
 * Seed 3 cross-market z-score agents inspired by the Daniro PRD §4.
 * Each agent uses `poly_cross_market_zscore` with different gate tightness.
 *
 * Tagged introduced_by='daniro-archetype-2026-05-29' so the LiveBinaryPanel's
 * archetypes toggle surfaces them alongside the other PRD-seeded agents.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertPaperAgent, getCurrentGeneration, listGenerations, startGeneration, markElite } from "../src/lib/arena/db.ts";
import { GenomeSchema, type Genome } from "../src/lib/arena/genome.ts";

const INTRODUCED_BY = "daniro-archetype-2026-05-29";

function zsp(name: string, z: number, baseline: number, size: number): { name: string; genome: Genome } {
  const g = GenomeSchema.parse({
    kind: "poly_cross_market_zscore",
    params: {
      baseline_min: baseline,
      spread_window_min: Math.min(5, baseline),
      z_threshold: z,
      max_minutes_to_expiry: 8,
      entry_size_usd: size,
      assets: "BTC,ETH,SOL,XRP,DOGE,BNB,HYPE",
    },
  });
  return { name, genome: g };
}

const SPECS = [
  zsp("zsp-tight-z3",      3.0, 60, 2),
  zsp("zsp-balanced-z2",   2.0, 30, 5),
  zsp("zsp-loose-z15-fast", 1.5, 15, 5),
];

function main(): void {
  let gen = getCurrentGeneration();
  if (!gen) {
    const last = listGenerations(1)[0];
    const nextNumber = last ? last.gen_number + 1 : 0;
    const newId = startGeneration(nextNumber, undefined, "Opened by seed-daniro-archetype");
    gen = { id: newId, gen_number: nextNumber } as ReturnType<typeof getCurrentGeneration>;
    console.log(`[seed-daniro] No open generation — opened gen ${nextNumber} (id=${newId})`);
  }
  console.log(`[seed-daniro] Seeding ${SPECS.length} z-score agents into gen ${gen!.gen_number}`);
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
  console.log(`[seed-daniro] done. inserted=${inserted} skipped=${skipped}`);
}

main();
