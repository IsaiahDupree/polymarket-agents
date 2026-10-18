/**
 * Resurrect + protect the PRD-archetype agents.
 *
 * The arena's generation cull retired the 17 archetype + 3 Hermes + 3 Daniro
 * agents after their birth gen sealed. That's expected behavior for non-elite
 * agents — but it means our PRD seeds don't compound across gens.
 *
 * This script:
 *   1. Sets alive=1 + clears retire_reason for any DEAD agent tagged from the
 *      three PRDs
 *   2. Marks them is_elite=1 so they're protected from future culls (per
 *      ARENA_ELITE_COUNT / ARENA_ELITE_MAX_DD_PCT rules)
 *
 * Idempotent. Safe to re-run.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";

const TAGS = [
  "archetype-prd-2026-05-29",
  "hermes-archetype-2026-05-29",
  "daniro-archetype-2026-05-29",
];

const placeholders = TAGS.map(() => "?").join(",");
const h = db();

const beforeAlive = h.prepare(
  `SELECT COUNT(*) AS n FROM paper_agents WHERE introduced_by IN (${placeholders}) AND alive = 1`,
).get(...TAGS) as { n: number };
const totalSeeded = h.prepare(
  `SELECT COUNT(*) AS n FROM paper_agents WHERE introduced_by IN (${placeholders})`,
).get(...TAGS) as { n: number };
console.log(`Before: ${beforeAlive.n}/${totalSeeded.n} archetype agents are alive`);

const resurrect = h.prepare(
  `UPDATE paper_agents
      SET alive = 1, is_elite = 1, retire_reason = NULL, retired_at = NULL,
          updated_at = datetime('now')
    WHERE introduced_by IN (${placeholders})`,
);
const result = resurrect.run(...TAGS);
console.log(`Updated ${result.changes} agents (alive=1, is_elite=1)`);

const afterAlive = h.prepare(
  `SELECT COUNT(*) AS n FROM paper_agents WHERE introduced_by IN (${placeholders}) AND alive = 1`,
).get(...TAGS) as { n: number };
const afterElite = h.prepare(
  `SELECT COUNT(*) AS n FROM paper_agents WHERE introduced_by IN (${placeholders}) AND is_elite = 1`,
).get(...TAGS) as { n: number };
console.log(`After: ${afterAlive.n}/${totalSeeded.n} alive, ${afterElite.n} elite`);
