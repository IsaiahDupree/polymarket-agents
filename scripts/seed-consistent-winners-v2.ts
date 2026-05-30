/**
 * seed:consistent-winners-v2 — TIGHTER variant of consistent-winners.
 *
 * The first cohort (consistent-winner-2026-05-30, agents #3091-#3102) used a
 * permissive price band [0.85, 0.92] + parent-derived velocity thresholds.
 * Early data: 8 trades, 6 wins (75% win rate). 75% is BELOW the 85%
 * break-even point for $2/$0.87 entries — that strategy loses money.
 *
 * This script seeds cw-v2 with TIGHT params targeting 94%+ win rate:
 *   - entry_size_usd      = 2          (same as v1)
 *   - max_yes_price_for_buy ∈ [0.92, 0.96]   (only enter near-cert)
 *   - vel_entry_pct       ∈ [0.004, 0.008]   (strong velocity confirmation)
 *   - pre_cutoff_min      ∈ [0, 2]    (allow last-second entries)
 *   - max_window_min      ∈ [2, 4]    (only 5-min binaries near expiry)
 *   - max_positions_per_asset ∈ [1, 2] (avoid overconcentration)
 *
 * Tag: introduced_by='consistent-winner-v2-2026-05-30'
 * Each child gets a paper capsule with $30 capital, $10 daily-loss cap.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertPaperAgent, markElite } from "../src/lib/arena/db.ts";
import { graduateCandidate } from "../src/lib/arena/graduation.ts";
import { parseGenome, type Genome } from "../src/lib/arena/genome.ts";

const INTRODUCED_BY_TAG = "consistent-winner-v2-2026-05-30";
const TARGET_STAKE_USD = 2;
const CHILDREN_PER_PARENT = 4;
const PARENT_IDS = [2153, 2929, 2928];

function pickFloat(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}
function pickInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(lo + rng() * (hi - lo + 1));
}

function shapeTightChild(parentGenome: Genome): Genome {
  if ((parentGenome as { kind: string }).kind !== "poly_short_binary_directional") {
    throw new Error(`v2 only handles poly_short_binary_directional`);
  }
  const p = (parentGenome as { params: Record<string, unknown> }).params;
  const rng = Math.random;
  return {
    kind: "poly_short_binary_directional",
    params: {
      entry_size_usd: TARGET_STAKE_USD,
      // TIGHT near-cert price gate
      max_yes_price_for_buy: pickFloat(rng, 0.92, 0.96),
      min_yes_price_for_sell: pickFloat(rng, 0.04, 0.08),
      // STRONG velocity required
      vel_window_min: pickInt(rng, 2, 3),
      vel_entry_pct: pickFloat(rng, 0.004, 0.008),
      // LATE-WINDOW entries only
      pre_cutoff_min: pickInt(rng, 0, 2),
      max_window_min: pickInt(rng, 2, 4),
      max_positions_per_asset: pickInt(rng, 1, 2),
      // Inherit asset universe from parent (BTC focus is fine but allow ETH/SOL too)
      assets: String(p.assets ?? "BTC,ETH,SOL,XRP,DOGE,BNB,HYPE"),
    },
  } as unknown as Genome;
}

function alreadyExists(parentId: number): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM paper_agents WHERE introduced_by=? AND name LIKE ?`)
    .get(INTRODUCED_BY_TAG, `%v2-p${parentId}-%`) as { n: number };
  return row.n;
}

function loadParent(id: number) {
  const row = db().prepare(`SELECT id, name, genome_json FROM paper_agents WHERE id=?`).get(id) as
    | { id: number; name: string; genome_json: string }
    | undefined;
  if (!row) return null;
  return { ...row, genome: parseGenome(row.genome_json) };
}

function getGen(): number {
  const gen = db()
    .prepare(`SELECT gen_number FROM paper_generations WHERE sealed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get() as { gen_number: number } | undefined;
  return gen?.gen_number ?? 0;
}

function seedFrom(parentId: number): { seeded: number; capsules: number } {
  const parent = loadParent(parentId);
  if (!parent) { console.log(`  #${parentId} not found`); return { seeded: 0, capsules: 0 }; }
  if ((parent.genome as { kind: string }).kind !== "poly_short_binary_directional") {
    console.log(`  #${parentId} ${parent.name} kind not poly_short_binary_directional — skip`); return { seeded: 0, capsules: 0 };
  }
  const exists = alreadyExists(parentId);
  if (exists >= CHILDREN_PER_PARENT) {
    console.log(`  #${parentId} already has ${exists} v2 children — skip`); return { seeded: 0, capsules: 0 };
  }
  const gen = getGen();
  let seeded = 0; let capsules = 0;
  for (let i = exists + 1; i <= CHILDREN_PER_PARENT; i++) {
    const childGenome = shapeTightChild(parent.genome);
    const name = `cw-v2-p${parentId}-c${i}-${parent.name.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 12)}`;
    const id = insertPaperAgent({
      name, generation: gen, parent_paper_agent_id: parentId, genome: childGenome,
      introduced_by: INTRODUCED_BY_TAG, cash_usd_start: 1000,
    });
    markElite(id);
    seeded += 1;
    console.log(`  ✓ #${id} ${name}`);
    try {
      const cap = graduateCandidate(id, {
        capsuleName: `cw-v2-${id}`,
        capitalUsd: 30,
        maxDailyLossUsd: 10,
        maxTotalDrawdownUsd: 10,
      });
      capsules += 1;
      console.log(`    capsule ${cap.capsuleId.slice(0, 8)}`);
    } catch (err) {
      console.error(`    capsule failed: ${(err as Error).message.slice(0, 100)}`);
    }
  }
  return { seeded, capsules };
}

console.log(`[seed-cw-v2] tighter params — target win rate ≥ 94% before stake promotion`);
let total = 0, totalCap = 0;
for (const pid of PARENT_IDS) {
  const r = seedFrom(pid);
  total += r.seeded; totalCap += r.capsules;
}
console.log(`\n[seed-cw-v2] DONE seeded=${total} capsules=${totalCap}`);

const summary = db()
  .prepare(
    `SELECT id, name, json_extract(genome_json, '$.params.max_yes_price_for_buy') AS max_yes,
            json_extract(genome_json, '$.params.vel_entry_pct') AS vel,
            json_extract(genome_json, '$.params.entry_size_usd') AS entry
       FROM paper_agents WHERE introduced_by=? ORDER BY id`,
  )
  .all(INTRODUCED_BY_TAG) as Array<{ id: number; name: string; max_yes: number; vel: number; entry: number }>;
console.log(`\ncw-v2 cohort (${summary.length}):`);
for (const s of summary) {
  console.log(`  #${s.id} ${s.name.padEnd(34)} entry=$${s.entry} max_yes=${s.max_yes.toFixed(3)} vel_entry=${(s.vel * 100).toFixed(3)}%`);
}
