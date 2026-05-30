/**
 * worker:btc-5m-factory — continuous self-improving loop for BTC 5-min
 * binary directional agents.
 *
 * The factory's purpose: keep an ever-fresh population of `poly_short_binary_
 * directional` variants flowing through the arena. Each cycle:
 *   1. Run a "fast" campaign: 20 variants on BTC, last 30d window, composite
 *      score (PnL + trades + win-rate − DD penalty), auto-seed top 3.
 *   2. Once per day (at first cycle after midnight UTC) run a "deep" campaign:
 *      50 variants, last 180d, same scoring, auto-seed top 5.
 *   3. Once per day also run a "champion sweep": pick the top 3 alive
 *      `poly_short_binary_directional` agents, do baseAgentId sweeps on each
 *      to refine their parameters.
 *
 * Self-improvement comes from:
 *   - New random variants joining the population every cycle (exploration)
 *   - Champion sweeps tightening parameters around proven performers (exploitation)
 *   - graduateCandidate auto-stages every seeded agent → forward PnL in
 *     paper capsules → worker:graduate flags eligible ones for live
 *
 * Usage:
 *   npm run factory:btc-5m                       # forever, default 6h cadence
 *   npm run factory:btc-5m -- --once             # one fast cycle then exit
 *   npm run factory:btc-5m -- --interval-hours 3 # custom cadence
 *
 * Env:
 *   CAMPAIGN_SCORE_FN=composite                  # multi-objective ranking
 *   CAMPAIGN_W_PNL, CAMPAIGN_W_TRADES, CAMPAIGN_W_WIN_RATE, CAMPAIGN_W_DD
 *   FACTORY_DRY_RUN=1                            # log plans, don't execute
 */
import "./_env.ts";
import { createCampaign, runCampaign } from "../src/lib/arena/campaigns.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";

const TARGET_KIND = "poly_short_binary_directional";
const TARGET_ASSET = "BTC";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const intervalHours = Number(arg("interval-hours", "6"));
const runOnce = flag("once");
const dryRun = !!process.env.FACTORY_DRY_RUN || flag("dry-run");
// Force the composite score path inside runCampaign for this worker.
if (!process.env.CAMPAIGN_SCORE_FN) process.env.CAMPAIGN_SCORE_FN = "composite";

// Burn the consistent-winner profile into every variant this factory generates.
// $2 stake per entry, price band [0.85, 0.92] for buys / [0.08, 0.15] for sells.
// See docs/prds/consistent-winner-generation-2026-05-30.md. Override-able via
// env (set CAMPAIGN_FORCE_ENTRY_SIZE_USD=0 to opt out).
if (!process.env.CAMPAIGN_FORCE_ENTRY_SIZE_USD) process.env.CAMPAIGN_FORCE_ENTRY_SIZE_USD = "2";
if (!process.env.CAMPAIGN_FORCE_PRICE_BAND) process.env.CAMPAIGN_FORCE_PRICE_BAND = "1";

function ts(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function lastFastCycleAt(): number {
  const row = db()
    .prepare(
      `SELECT created_at FROM training_campaigns
        WHERE name LIKE 'btc-5m-fast-%' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { created_at: string } | undefined;
  if (!row) return 0;
  // SQLite returns 'YYYY-MM-DD HH:MM:SS' (UTC); make it parseable by JS
  return Date.parse(row.created_at.replace(" ", "T") + "Z");
}

function lastDeepCycleAt(): number {
  const row = db()
    .prepare(
      `SELECT created_at FROM training_campaigns
        WHERE name LIKE 'btc-5m-deep-%' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { created_at: string } | undefined;
  if (!row) return 0;
  return Date.parse(row.created_at.replace(" ", "T") + "Z");
}

function lastChampionSweepAt(): number {
  const row = db()
    .prepare(
      `SELECT created_at FROM training_campaigns
        WHERE name LIKE 'btc-5m-champ-%' ORDER BY id DESC LIMIT 1`,
    )
    .get() as { created_at: string } | undefined;
  if (!row) return 0;
  return Date.parse(row.created_at.replace(" ", "T") + "Z");
}

/** Run a fast 30-day, 20-variant campaign. */
function runFastCycle(): void {
  const name = `btc-5m-fast-${ts().replace(/[: ]/g, "-")}`;
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  console.log(`[factory] FAST: name=${name} window=30d variants=20 autoSeed=3`);
  if (dryRun) return;
  const id = createCampaign({
    name,
    kind: TARGET_KIND,
    assetFilter: TARGET_ASSET,
    fromIso: from,
    toIso: to,
    variants: 20,
    topKToSeed: 3,
    charter: "self-improving fast cycle on BTC 5-min binary directional (composite score)",
  });
  runCampaign(id, 3);
  const c = db().prepare("SELECT candidates_produced, best_pnl_usd FROM training_campaigns WHERE id = ?").get(id) as { candidates_produced: number; best_pnl_usd: number | null } | undefined;
  console.log(`[factory] FAST id=${id} produced=${c?.candidates_produced} best=$${c?.best_pnl_usd?.toFixed(2)}`);
}

/** Once-per-day deep campaign: 50 variants, 180d window. */
function runDeepCycle(): void {
  const name = `btc-5m-deep-${ts().replace(/[: ]/g, "-")}`;
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 180 * 86_400_000).toISOString();
  console.log(`[factory] DEEP: name=${name} window=180d variants=50 autoSeed=5`);
  if (dryRun) return;
  const id = createCampaign({
    name,
    kind: TARGET_KIND,
    assetFilter: TARGET_ASSET,
    fromIso: from,
    toIso: to,
    variants: 50,
    topKToSeed: 5,
    charter: "self-improving daily deep cycle on BTC 5-min binary directional (composite score, 180d)",
  });
  runCampaign(id, 5);
  const c = db().prepare("SELECT candidates_produced, best_pnl_usd FROM training_campaigns WHERE id = ?").get(id) as { candidates_produced: number; best_pnl_usd: number | null } | undefined;
  console.log(`[factory] DEEP id=${id} produced=${c?.candidates_produced} best=$${c?.best_pnl_usd?.toFixed(2)}`);
}

/** Sweep around top-3 alive BTC 5m agents. */
function runChampionSweeps(): void {
  // Top-3 alive agents whose genome kind is poly_short_binary_directional.
  // Sorting by realized_pnl_usd because lifetime PnL is the operator's
  // ground truth — these are the genomes that have actually earned.
  const champs = db()
    .prepare(
      `SELECT id, name, realized_pnl_usd FROM paper_agents
        WHERE alive = 1
          AND json_extract(genome_json, '$.kind') = ?
        ORDER BY realized_pnl_usd DESC LIMIT 3`,
    )
    .all(TARGET_KIND) as Array<{ id: number; name: string; realized_pnl_usd: number }>;

  if (champs.length === 0) {
    console.log("[factory] CHAMP: no alive BTC 5m agents to sweep — skip");
    return;
  }

  for (const champ of champs) {
    const name = `btc-5m-champ-${champ.id}-${ts().replace(/[: ]/g, "-")}`;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 60 * 86_400_000).toISOString();
    console.log(`[factory] CHAMP: sweep around #${champ.id} ${champ.name} (lifetime PnL $${champ.realized_pnl_usd.toFixed(2)})`);
    if (dryRun) continue;
    const id = createCampaign({
      name,
      kind: TARGET_KIND,
      assetFilter: TARGET_ASSET,
      fromIso: from,
      toIso: to,
      variants: 20,
      baseAgentId: champ.id,
      perPct: 0.15,
      topKToSeed: 2,
      charter: `champion sweep ±15% around #${champ.id} ${champ.name}`,
    });
    runCampaign(id, 2);
    const c = db().prepare("SELECT candidates_produced, best_pnl_usd FROM training_campaigns WHERE id = ?").get(id) as { candidates_produced: number; best_pnl_usd: number | null } | undefined;
    console.log(`[factory] CHAMP-${champ.id} id=${id} produced=${c?.candidates_produced} best=$${c?.best_pnl_usd?.toFixed(2)}`);
  }
}

function pass(): void {
  const t0 = Date.now();
  const fastLast = lastFastCycleAt();
  const deepLast = lastDeepCycleAt();
  const champLast = lastChampionSweepAt();
  const now = Date.now();
  const HOUR_MS = 3_600_000;
  const DAY_MS = 24 * HOUR_MS;

  // Always run a fast cycle if it's been > intervalHours since the last.
  const shouldFast = (now - fastLast) >= intervalHours * HOUR_MS;
  const shouldDeep = (now - deepLast) >= DAY_MS;
  const shouldChamp = (now - champLast) >= DAY_MS;

  console.log(
    `[factory] cycle: fast=${shouldFast ? "GO" : `wait ${Math.round((intervalHours - (now - fastLast) / HOUR_MS) * 10) / 10}h`}` +
    ` deep=${shouldDeep ? "GO" : `wait ${Math.round(((DAY_MS - (now - deepLast)) / HOUR_MS) * 10) / 10}h`}` +
    ` champ=${shouldChamp ? "GO" : `wait ${Math.round(((DAY_MS - (now - champLast)) / HOUR_MS) * 10) / 10}h`}`,
  );

  try {
    if (shouldFast) runFastCycle();
    if (shouldDeep) runDeepCycle();
    if (shouldChamp) runChampionSweeps();
  } catch (err) {
    console.error("[factory] cycle err:", (err as Error).message);
  }

  // Emit a factory-cycle event so operators can see activity in evolution_log.
  if (!dryRun) {
    try {
      insertEvolutionEvent({
        event_type: "factory-cycle",
        summary: `btc-5m-factory pass: fast=${shouldFast} deep=${shouldDeep} champ=${shouldChamp} elapsed=${Math.round((Date.now() - t0) / 1000)}s`,
        payload_json: JSON.stringify({
          ran_fast: shouldFast,
          ran_deep: shouldDeep,
          ran_champ: shouldChamp,
          elapsed_ms: Date.now() - t0,
          target_kind: TARGET_KIND,
          target_asset: TARGET_ASSET,
        }),
      });
    } catch (err) {
      console.error("[factory] failed to log cycle event:", (err as Error).message);
    }
  }
}

console.log(`[factory] starting (interval=${intervalHours}h, once=${runOnce}, dry-run=${dryRun}, score=${process.env.CAMPAIGN_SCORE_FN})`);
pass();

if (!runOnce) {
  setInterval(pass, intervalHours * 3_600_000);
  process.on("SIGINT", () => { console.log("\n[factory] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error("[factory] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
}
