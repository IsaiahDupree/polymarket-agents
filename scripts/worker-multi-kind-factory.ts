/**
 * worker:multi-kind-factory — sibling to worker-btc-5m-factory.ts that
 * keeps an ever-fresh population of EVERY non-BTC-5m genome kind flowing
 * through the arena. The BTC-5m factory specialises on
 * `poly_short_binary_directional` with a tuned consistent-winner profile;
 * this factory covers the other 12 kinds so the user's "all strategies in
 * our backtests" requirement is satisfied.
 *
 * Each cycle, for every kind in TARGET_KINDS:
 *   1. FAST campaign: 8 variants on the last 30d, composite score, seed top 2.
 *   2. Once-per-day DEEP campaign: 15 variants on the last 180d, seed top 3.
 *   3. Once-per-day CHAMPION sweep: refine the top alive agent of that kind.
 *
 * Self-improvement comes from:
 *   - New random variants joining every cycle (exploration across all kinds)
 *   - Champion sweeps tightening parameters around each kind's best performer
 *   - graduateCandidate auto-stages seeded agents → paper PnL → graduate worker
 *
 * Usage:
 *   npm run factory:multi                        # forever, default 6h cadence
 *   npm run factory:multi -- --once              # one full pass then exit
 *   npm run factory:multi -- --dry-run           # log planned campaigns only
 *   FACTORY_MULTI_KINDS=cb_breakout,cb_mean_reversion npm run factory:multi
 *
 * Env:
 *   FACTORY_MULTI_KINDS    CSV of kinds to cover. Default = all GENOME_KINDS
 *                          except poly_short_binary_directional (handled by
 *                          worker-btc-5m-factory.ts).
 *   FACTORY_MULTI_FAST_VARIANTS    Per-kind fast variant count (default 8).
 *   FACTORY_MULTI_DEEP_VARIANTS    Per-kind deep variant count (default 15).
 *   FACTORY_MULTI_FAST_SEED        Per-kind fast top-K to seed (default 2).
 *   FACTORY_MULTI_DEEP_SEED        Per-kind deep top-K to seed (default 3).
 *   FACTORY_DRY_RUN=1              Plan-only, no DB writes.
 *
 *   CAMPAIGN_SCORE_FN=composite    Multi-objective ranking (default forced here).
 *   CAMPAIGN_W_PNL / CAMPAIGN_W_TRADES / CAMPAIGN_W_WIN_RATE / CAMPAIGN_W_DD
 */
import "./_env.ts";
import { createCampaign, runCampaign } from "../src/lib/arena/campaigns.ts";
import { type GenomeKind } from "../src/lib/arena/genome.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { readTargetKinds, assetForKind, kindSlug } from "../src/lib/factory/kinds.ts";

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v.replace(/\s*#.*$/, "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

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

const FAST_VARIANTS = envNum("FACTORY_MULTI_FAST_VARIANTS", 8);
const DEEP_VARIANTS = envNum("FACTORY_MULTI_DEEP_VARIANTS", 15);
const FAST_SEED = envNum("FACTORY_MULTI_FAST_SEED", 2);
const DEEP_SEED = envNum("FACTORY_MULTI_DEEP_SEED", 3);

const TARGET_KINDS = readTargetKinds();

// Force the composite score path for this worker too — same as BTC-5m.
if (!process.env.CAMPAIGN_SCORE_FN) process.env.CAMPAIGN_SCORE_FN = "composite";

// readTargetKinds / assetForKind / kindSlug are imported from
// src/lib/factory/kinds.ts (pure / unit-tested).

function ts(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function lastCycleAt(prefix: string): number {
  const row = db()
    .prepare(
      `SELECT created_at FROM training_campaigns
        WHERE name LIKE ? ORDER BY id DESC LIMIT 1`,
    )
    .get(`${prefix}%`) as { created_at: string } | undefined;
  if (!row) return 0;
  return Date.parse(row.created_at.replace(" ", "T") + "Z");
}

function runFastForKind(kind: GenomeKind): void {
  const slug = kindSlug(kind);
  const name = `mk-${slug}-fast-${ts().replace(/[: ]/g, "-")}`;
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const asset = assetForKind(kind);
  console.log(`[multi-factory] FAST kind=${kind} name=${name} variants=${FAST_VARIANTS} seed=${FAST_SEED} asset=${asset ?? "any"}`);
  if (dryRun) return;
  try {
    const id = createCampaign({
      name, kind,
      assetFilter: asset,
      fromIso: from, toIso: to,
      variants: FAST_VARIANTS,
      topKToSeed: FAST_SEED,
      charter: `multi-kind fast cycle on ${kind} (composite score, 30d)`,
    });
    runCampaign(id, FAST_SEED);
    const c = db()
      .prepare("SELECT candidates_produced, best_pnl_usd FROM training_campaigns WHERE id = ?")
      .get(id) as { candidates_produced: number; best_pnl_usd: number | null } | undefined;
    console.log(`[multi-factory] FAST kind=${kind} id=${id} produced=${c?.candidates_produced ?? 0} best=$${c?.best_pnl_usd?.toFixed(2) ?? "n/a"}`);
  } catch (err) {
    console.error(`[multi-factory] FAST kind=${kind} err:`, (err as Error).message);
  }
}

function runDeepForKind(kind: GenomeKind): void {
  const slug = kindSlug(kind);
  const name = `mk-${slug}-deep-${ts().replace(/[: ]/g, "-")}`;
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const asset = assetForKind(kind);
  console.log(`[multi-factory] DEEP kind=${kind} name=${name} variants=${DEEP_VARIANTS} seed=${DEEP_SEED} asset=${asset ?? "any"}`);
  if (dryRun) return;
  try {
    const id = createCampaign({
      name, kind,
      assetFilter: asset,
      fromIso: from, toIso: to,
      variants: DEEP_VARIANTS,
      topKToSeed: DEEP_SEED,
      charter: `multi-kind daily deep cycle on ${kind} (composite score, 180d)`,
    });
    runCampaign(id, DEEP_SEED);
    const c = db()
      .prepare("SELECT candidates_produced, best_pnl_usd FROM training_campaigns WHERE id = ?")
      .get(id) as { candidates_produced: number; best_pnl_usd: number | null } | undefined;
    console.log(`[multi-factory] DEEP kind=${kind} id=${id} produced=${c?.candidates_produced ?? 0} best=$${c?.best_pnl_usd?.toFixed(2) ?? "n/a"}`);
  } catch (err) {
    console.error(`[multi-factory] DEEP kind=${kind} err:`, (err as Error).message);
  }
}

function runChampionForKind(kind: GenomeKind): void {
  const champ = db()
    .prepare(
      `SELECT id, name, realized_pnl_usd FROM paper_agents
        WHERE alive = 1
          AND json_extract(genome_json, '$.kind') = ?
        ORDER BY realized_pnl_usd DESC LIMIT 1`,
    )
    .get(kind) as { id: number; name: string; realized_pnl_usd: number } | undefined;
  if (!champ) {
    console.log(`[multi-factory] CHAMP kind=${kind} no alive agent — skip`);
    return;
  }
  const slug = kindSlug(kind);
  const name = `mk-${slug}-champ-${champ.id}-${ts().replace(/[: ]/g, "-")}`;
  const to = new Date().toISOString();
  const from = new Date(Date.now() - 60 * 86_400_000).toISOString();
  console.log(`[multi-factory] CHAMP kind=${kind} sweep around #${champ.id} ${champ.name} (lifetime PnL $${champ.realized_pnl_usd.toFixed(2)})`);
  if (dryRun) return;
  try {
    const id = createCampaign({
      name, kind,
      assetFilter: assetForKind(kind),
      fromIso: from, toIso: to,
      variants: 12,
      baseAgentId: champ.id,
      perPct: 0.15,
      topKToSeed: 2,
      charter: `multi-kind champion sweep ±15% around #${champ.id} ${champ.name}`,
    });
    runCampaign(id, 2);
    const c = db()
      .prepare("SELECT candidates_produced, best_pnl_usd FROM training_campaigns WHERE id = ?")
      .get(id) as { candidates_produced: number; best_pnl_usd: number | null } | undefined;
    console.log(`[multi-factory] CHAMP kind=${kind} #${champ.id} id=${id} produced=${c?.candidates_produced ?? 0} best=$${c?.best_pnl_usd?.toFixed(2) ?? "n/a"}`);
  } catch (err) {
    console.error(`[multi-factory] CHAMP kind=${kind} err:`, (err as Error).message);
  }
}

function pass(): void {
  const t0 = Date.now();
  const now = Date.now();
  const HOUR_MS = 3_600_000;
  const DAY_MS = 24 * HOUR_MS;

  console.log(`[multi-factory] pass: kinds=${TARGET_KINDS.length} (${TARGET_KINDS.join(", ")}) dry=${dryRun}`);

  let fastRan = 0, deepRan = 0, champRan = 0;
  for (const kind of TARGET_KINDS) {
    const slug = kindSlug(kind);
    const fastPrefix = `mk-${slug}-fast-`;
    const deepPrefix = `mk-${slug}-deep-`;
    const champPrefix = `mk-${slug}-champ-`;
    const shouldFast = (now - lastCycleAt(fastPrefix)) >= intervalHours * HOUR_MS;
    const shouldDeep = (now - lastCycleAt(deepPrefix)) >= DAY_MS;
    const shouldChamp = (now - lastCycleAt(champPrefix)) >= DAY_MS;

    console.log(`[multi-factory] ${kind}: fast=${shouldFast ? "GO" : "skip"} deep=${shouldDeep ? "GO" : "skip"} champ=${shouldChamp ? "GO" : "skip"}`);
    if (shouldFast) { runFastForKind(kind); fastRan++; }
    if (shouldDeep) { runDeepForKind(kind); deepRan++; }
    if (shouldChamp) { runChampionForKind(kind); champRan++; }
  }

  if (!dryRun) {
    try {
      insertEvolutionEvent({
        event_type: "factory-cycle",
        summary: `multi-kind-factory pass: kinds=${TARGET_KINDS.length} fast=${fastRan} deep=${deepRan} champ=${champRan} elapsed=${Math.round((Date.now() - t0) / 1000)}s`,
        payload_json: JSON.stringify({
          factory: "multi-kind",
          kinds: TARGET_KINDS,
          ran_fast: fastRan,
          ran_deep: deepRan,
          ran_champ: champRan,
          elapsed_ms: Date.now() - t0,
        }),
      });
    } catch (err) {
      console.error("[multi-factory] failed to log cycle event:", (err as Error).message);
    }
  }

  console.log(`[multi-factory] pass complete in ${Math.round((Date.now() - t0) / 1000)}s — fast=${fastRan} deep=${deepRan} champ=${champRan}`);
}

console.log(`[multi-factory] starting (interval=${intervalHours}h, once=${runOnce}, dry-run=${dryRun}, kinds=${TARGET_KINDS.length})`);
pass();

if (!runOnce) {
  setInterval(pass, intervalHours * 3_600_000);
  process.on("SIGINT", () => { console.log("\n[multi-factory] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error("[multi-factory] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
}
