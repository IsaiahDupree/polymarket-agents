/**
 * Seed the `markov-persistence` capsule + agent so worker:markov-exec
 * doesn't get CAPSULE_NOT_FOUND from the router.
 *
 *   npm run seed:markov-capsule
 *
 * Idempotent — re-runnable. Writes directly to the capsules table with a
 * fixed id (matches the worker's MARKOV_CAPSULE env default), bypassing
 * the random-UUID path in createCapsule(). This keeps the operator from
 * needing to look up + paste a generated UUID.
 *
 * Status is set to 'paper' so sim trades flow through immediately. Promote
 * to 'live' manually only after smoke-testing.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";

const CAPSULE_ID = "markov-persistence";
const AGENT_SLUG = "markov-persistence";

const handle = db();

// 1) Ensure the agent exists (charter + risk budget).
handle
  .prepare(
    `INSERT INTO agents (slug, name, charter, risk_budget_usd, status)
     VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       charter = excluded.charter,
       risk_budget_usd = excluded.risk_budget_usd,
       updated_at = datetime('now')`,
  )
  .run(
    AGENT_SLUG,
    "Markov Persistence",
    "Ricker article #2 (0xRicker, Hermes BTC trading agent guide): enter only when " +
      "p(j*,j*) ≥ 0.87 on the rolling transition matrix AND calibrated_p − market_p ≥ MIN_EDGE. " +
      "Uses LIMIT orders so the Becker maker-only router gate passes naturally. " +
      "Sim-default; MARKOV_LIVE=1 arms live trading.",
    100,
  );
const agentRow = handle.prepare("SELECT id FROM agents WHERE slug = ?").get(AGENT_SLUG) as { id: number } | undefined;
const agentId = agentRow?.id ?? null;
console.log(`[seed-markov-capsule] agent ${AGENT_SLUG} id=${agentId}`);

// 2) Ensure the capsule exists at the fixed id. Direct SQL because
//    createCapsule() forces randomUUID; we need a stable id that matches
//    the worker's MARKOV_CAPSULE env default.
const existing = handle.prepare("SELECT id, status FROM capsules WHERE id = ?").get(CAPSULE_ID) as { id: string; status: string } | undefined;

if (!existing) {
  handle
    .prepare(
      `INSERT INTO capsules (
         id, agent_id, strategy_id, name, status,
         capital_allocated_usd, capital_deployed_usd, capital_available_usd,
         max_daily_loss_usd, max_total_drawdown_usd, max_position_pct,
         max_open_positions, max_trades_per_day,
         allowed_venues_json, allowed_symbols_json, min_seconds_between_trades,
         activated_at
       ) VALUES (
         ?, ?, NULL, ?, 'paper',
         100, 0, 100,
         50, 50, 0.2,
         5, 100,
         ?, NULL, 0,
         datetime('now')
       )`,
    )
    .run(
      CAPSULE_ID,
      agentId,
      "Markov Persistence (sim)",
      JSON.stringify(["sim", "polymarket"]),
    );
  console.log(`[seed-markov-capsule] created capsule ${CAPSULE_ID} (status=paper, $100 sim)`);
} else {
  // Idempotent update of mutable fields. Leave capital + status alone if the
  // operator already tuned them — only ensure allowed_venues is present.
  handle
    .prepare(
      `UPDATE capsules
          SET allowed_venues_json = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(JSON.stringify(["sim", "polymarket"]), CAPSULE_ID);
  console.log(`[seed-markov-capsule] capsule ${CAPSULE_ID} already exists (status=${existing.status}); refreshed venues`);
}

// 3) Surface counts so the operator sees what's live.
const c = handle.prepare("SELECT name, status, capital_allocated_usd, capital_available_usd FROM capsules WHERE id = ?").get(CAPSULE_ID) as any;
console.log(`[seed-markov-capsule] capsule: ${c.name} · ${c.status} · allocated $${c.capital_allocated_usd} · available $${c.capital_available_usd}`);
console.log(`[seed-markov-capsule] ready. Run \`npm run worker:markov-exec\` to start the executor (sim by default).`);
