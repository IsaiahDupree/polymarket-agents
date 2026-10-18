/**
 * seed:consistent-winners — burn the $2-stake / $0.30-target / 5-min-binary
 * profile into a generation of paper_agents.
 *
 * What this script does:
 *   1. Loads parent agents that already exhibit the consistent-winner pattern
 *      (poly_short_binary_directional, positive PnL, decent win rate).
 *   2. For each parent, generates 3 children with HARDCODED:
 *        entry_size_usd = 2
 *        max_yes_price_for_buy ∈ [0.85, 0.92]
 *        min_yes_price_for_sell ∈ [0.08, 0.15]
 *        max_positions_per_asset ∈ [2, 3]
 *      Other params perturbed ±10% so children aren't identical.
 *   3. Inserts each child as paper_agents with introduced_by='consistent-winner-2026-05-30',
 *      is_elite=1.
 *   4. Auto-stages each child as a paper capsule via graduateCandidate().
 *
 * Idempotent — re-running detects existing children by introduced_by tag and
 * skips parents that already have ≥3 children.
 *
 * Run: npm run seed:consistent-winners
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertPaperAgent, markElite } from "../src/lib/arena/db.ts";
import { graduateCandidate } from "../src/lib/arena/graduation.ts";
import { parseGenome, serializeGenome, type Genome } from "../src/lib/arena/genome.ts";

const INTRODUCED_BY_TAG = "consistent-winner-2026-05-30";
const TARGET_STAKE_USD = 2;
const CHILDREN_PER_PARENT = 3;

// Parents: proven 5-min binary winners. Either earned-PnL champions
// (#2153, alive winners) or hand-tuned archetypes (#2929, #2928, #2937).
const PARENT_IDS = [2153, 2929, 2928, 2937];

function pickFloat(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}
function pickInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(lo + rng() * (hi - lo + 1));
}
function perturb(rng: () => number, v: number, pct = 0.10): number {
  return v * (1 + (rng() * 2 - 1) * pct);
}

/**
 * Override a poly_short_binary_directional genome to the consistent-winner
 * profile. The hardcoded fields are the contract; everything else gets a
 * mild perturbation so children explore around the parent.
 */
function shapeChild(parentGenome: Genome, rng: () => number, childIdx: number): Genome {
  if ((parentGenome as { kind: string }).kind !== "poly_short_binary_directional") {
    throw new Error(`seed-consistent-winners only handles poly_short_binary_directional (got ${(parentGenome as { kind: string }).kind})`);
  }
  const p = (parentGenome as { params: Record<string, unknown> }).params;

  return {
    kind: "poly_short_binary_directional",
    params: {
      // HARDCODED — the contract:
      entry_size_usd: TARGET_STAKE_USD,
      max_yes_price_for_buy: pickFloat(rng, 0.85, 0.92),
      min_yes_price_for_sell: pickFloat(rng, 0.08, 0.15),
      max_positions_per_asset: pickInt(rng, 2, 3),

      // Inherited + lightly perturbed from parent:
      assets: String(p.assets ?? "BTC,ETH,SOL,XRP,DOGE,BNB,HYPE"),
      vel_window_min: pickInt(rng, 2, 4),
      vel_entry_pct: Math.max(0.0005, Math.min(0.01, perturb(rng, Number(p.vel_entry_pct ?? 0.002), 0.30))),
      pre_cutoff_min: pickInt(rng, 1, 3),
      max_window_min: pickInt(rng, 3, 6),
    },
  } as unknown as Genome;
}

function alreadyExistsForParent(parentId: number): number {
  // Count of children with this tag whose name includes the parent id —
  // simple lineage signal so re-running the script doesn't duplicate.
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM paper_agents
        WHERE introduced_by = ? AND name LIKE ?`,
    )
    .get(INTRODUCED_BY_TAG, `%p${parentId}-%`) as { n: number };
  return row.n;
}

function loadParent(id: number): { id: number; name: string; genome: Genome } | null {
  const row = db()
    .prepare(`SELECT id, name, genome_json FROM paper_agents WHERE id = ?`)
    .get(id) as { id: number; name: string; genome_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, genome: parseGenome(row.genome_json) };
}

function getCurrentGen(): number {
  const gen = db()
    .prepare(`SELECT gen_number FROM paper_generations WHERE sealed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get() as { gen_number: number } | undefined;
  return gen?.gen_number ?? 0;
}

function shortName(parentId: number, childIdx: number, parentName: string): string {
  // Compact agent name following the existing convention: prefix indicates
  // origin + parent + child index so /arena/cohorts shows lineage at a glance.
  const tail = parentName.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 16);
  return `cw-p${parentId}-c${childIdx}-${tail}`;
}

function seedFromParent(parentId: number, rng: () => number): { seeded: number; capsules: number } {
  const parent = loadParent(parentId);
  if (!parent) {
    console.log(`  parent #${parentId} not found — skip`);
    return { seeded: 0, capsules: 0 };
  }
  if ((parent.genome as { kind: string }).kind !== "poly_short_binary_directional") {
    console.log(`  parent #${parentId} ${parent.name} kind=${(parent.genome as { kind: string }).kind} — not a 5-min binary strategy; skip`);
    return { seeded: 0, capsules: 0 };
  }
  const already = alreadyExistsForParent(parentId);
  if (already >= CHILDREN_PER_PARENT) {
    console.log(`  parent #${parentId} ${parent.name} already has ${already} children — skip`);
    return { seeded: 0, capsules: 0 };
  }

  const generation = getCurrentGen();
  let seeded = 0;
  let capsules = 0;

  for (let i = already + 1; i <= CHILDREN_PER_PARENT; i++) {
    const childGenome = shapeChild(parent.genome, rng, i);
    const name = shortName(parentId, i, parent.name);
    const childId = insertPaperAgent({
      name,
      generation,
      parent_paper_agent_id: parentId,
      genome: childGenome,
      introduced_by: INTRODUCED_BY_TAG,
      cash_usd_start: 1000,
    });
    markElite(childId);
    seeded += 1;
    console.log(`  ✓ seeded #${childId} ${name}`);

    // Auto-stage a paper capsule per child. Capital = $50 (covers ~25 trades at $2 stake).
    try {
      const cap = graduateCandidate(childId, {
        capsuleName: `cw-${childId}`,
        capitalUsd: 50,
        maxDailyLossUsd: 10,
        maxTotalDrawdownUsd: 10,
      });
      capsules += 1;
      console.log(`    └ capsule ${cap.capsuleId.slice(0, 8)} staged at paper`);
    } catch (err) {
      console.error(`    ! capsule failed for #${childId}: ${(err as Error).message}`);
    }
  }

  return { seeded, capsules };
}

function main(): void {
  console.log(`[seed-consistent-winners] target=${TARGET_STAKE_USD} parents=${PARENT_IDS.join(",")} children/parent=${CHILDREN_PER_PARENT} tag='${INTRODUCED_BY_TAG}'`);
  const rng = Math.random;
  let totalSeeded = 0;
  let totalCapsules = 0;
  for (const pid of PARENT_IDS) {
    const r = seedFromParent(pid, rng);
    totalSeeded += r.seeded;
    totalCapsules += r.capsules;
  }
  console.log(`\n[seed-consistent-winners] DONE seeded=${totalSeeded} capsules=${totalCapsules}`);

  // Summary: list all consistent-winner cohort agents.
  const summary = db()
    .prepare(
      `SELECT id, name, parent_paper_agent_id, alive, is_elite,
              json_extract(genome_json, '$.params.entry_size_usd') AS entry,
              json_extract(genome_json, '$.params.max_yes_price_for_buy') AS max_yes
         FROM paper_agents
        WHERE introduced_by = ?
        ORDER BY id ASC`,
    )
    .all(INTRODUCED_BY_TAG) as Array<{
      id: number; name: string; parent_paper_agent_id: number | null;
      alive: 0 | 1; is_elite: 0 | 1; entry: number; max_yes: number;
    }>;
  console.log(`\nconsistent-winner cohort (${summary.length}):`);
  for (const s of summary) {
    console.log(`  #${s.id} ${s.name}  parent=#${s.parent_paper_agent_id}  entry=$${s.entry}  max_yes=${s.max_yes?.toFixed(3)}  alive=${s.alive}  elite=${s.is_elite}`);
  }
}

main();
