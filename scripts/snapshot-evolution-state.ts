/**
 * Periodic snapshot of current evolution state.
 *
 * Records the CURRENT state of self-evolution mechanisms (A + B) to
 * evolution_log as `evolution-state-snapshot` events, regardless of
 * whether the arena loop is actively sealing generations. This gives
 * the comparison script (npm run compare:evolution) a continuous time
 * series instead of only event-triggered data points.
 *
 * What it captures (per snapshot):
 *   - Active mechanism flags (DYNAMIC_KIND_BLACKLIST, CLUSTER_AWARE_BREEDING)
 *   - Currently eligible genome kinds (post-A filtering)
 *   - Current breeding weights per family (post-B computation)
 *   - Recent cluster trips in window
 *   - Current generation status (open gen, ticks elapsed, alive agents)
 *
 * Recommended cron: every 5–15 minutes. Idempotent — each run writes a
 * new snapshot row; older rows are kept for trend analysis.
 *
 *   npx tsx scripts/snapshot-evolution-state.ts
 *   npx tsx scripts/snapshot-evolution-state.ts --dry-run
 */
import "./_env.ts";
import { db as openDb } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { recordHeartbeat } from "../src/lib/heartbeat.ts";
import {
  decideKindEligibility,
  eligibleKinds,
  isDynamicBlacklistEnabled,
  readThresholdsFromEnv as readEligibilityThresholds,
  type KindPerformance,
} from "../src/lib/arena/dynamic-eligibility.ts";
import {
  computeBreedingWeights,
  isClusterAwareBreedingEnabled,
  readBreedingThresholdsFromEnv,
  type ClusterTripEvent,
} from "../src/lib/arena/cluster-aware-breeding.ts";

const dryRun = process.argv.includes("--dry-run");

function main() {
  const db = openDb();

  // ── A — Dynamic eligibility state ─────────────────────────────────
  const aEnabled = isDynamicBlacklistEnabled();
  const aThresholds = readEligibilityThresholds();
  const windowDays = Number(process.env.ARENA_DYNAMIC_KIND_WINDOW_DAYS ?? "30");
  const cutoffIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // Compute per-kind perf from paper_trades in the window
  const tradeRows = db
    .prepare(
      `SELECT pa.genome_json, pt.realized_pnl_usd
         FROM paper_trades pt
         JOIN paper_agents pa ON pa.id = pt.paper_agent_id
        WHERE pt.tick_at >= ?`,
    )
    .all(cutoffIso) as Array<{ genome_json: string; realized_pnl_usd: number }>;
  const byKind = new Map<string, { trades: number; pnl: number }>();
  for (const r of tradeRows) {
    let kind: string | null = null;
    try { kind = JSON.parse(r.genome_json).kind ?? null; } catch { /* skip */ }
    if (!kind) continue;
    const entry = byKind.get(kind) ?? { trades: 0, pnl: 0 };
    entry.trades++;
    entry.pnl += Number.isFinite(r.realized_pnl_usd) ? r.realized_pnl_usd : 0;
    byKind.set(kind, entry);
  }
  const perfs: KindPerformance[] = [];
  for (const kind of aThresholds.safetyCeiling) {
    const e = byKind.get(kind) ?? { trades: 0, pnl: 0 };
    perfs.push({ kind, trades_in_window: e.trades, realized_pnl_in_window: e.pnl });
  }
  const aDecisions = decideKindEligibility(perfs, aThresholds);
  const aEligibleNow = eligibleKinds(aDecisions);

  // ── B — Cluster-aware breeding state ──────────────────────────────
  const bEnabled = isClusterAwareBreedingEnabled();
  const bThresholds = readBreedingThresholdsFromEnv();
  const bCutoffIso = new Date(Date.now() - bThresholds.windowDays * 86_400_000).toISOString();
  const tripRows = db
    .prepare(
      `SELECT created_at, summary, payload_json
         FROM evolution_log
        WHERE event_type = 'cluster-killswitch-trip' AND created_at >= ?`,
    )
    .all(bCutoffIso) as Array<{ created_at: string; summary: string; payload_json: string }>;
  const trips: ClusterTripEvent[] = [];
  for (const row of tripRows) {
    let strategyFamily: string | null = null;
    let reason = "strategy_family_cluster";
    try {
      const payload = JSON.parse(row.payload_json) as { reason?: string; summary?: string };
      if (typeof payload.reason === "string") reason = payload.reason;
      const text = payload.summary ?? row.summary;
      const m = /family '([^']+)' tripped/.exec(text);
      if (m) strategyFamily = m[1] ?? null;
    } catch {
      const m = /family '([^']+)' tripped/.exec(row.summary);
      if (m) strategyFamily = m[1] ?? null;
    }
    trips.push({ ts: row.created_at, reason, strategy_family: strategyFamily });
  }
  const breedingWeights = computeBreedingWeights(trips, bThresholds);

  // ── Arena gen status ──────────────────────────────────────────────
  const gen = db
    .prepare("SELECT gen_number, sealed_at, tick_count, started_at FROM paper_generations ORDER BY gen_number DESC LIMIT 1")
    .get() as { gen_number: number; sealed_at: string | null; tick_count: number; started_at: string } | undefined;
  const aliveCount = (db.prepare("SELECT COUNT(*) AS n FROM paper_agents WHERE alive = 1").get() as { n: number }).n;
  const eliteCount = (db.prepare("SELECT COUNT(*) AS n FROM paper_agents WHERE alive = 1 AND is_elite = 1").get() as { n: number }).n;
  const evolveEvery = Number(process.env.ARENA_EVOLVE_EVERY ?? "6");

  // ── Snapshot payload ──────────────────────────────────────────────
  const snapshot = {
    snapshot_ts: new Date().toISOString(),
    a_dynamic_blacklist: {
      enabled: aEnabled,
      window_days: windowDays,
      eligible_now: [...aEligibleNow],
      blacklisted_now: aDecisions.filter((d) => !d.eligible && d.reason === "negative_pnl")
        .map((d) => ({ kind: d.kind, pnl: d.realized_pnl_in_window, trades: d.trades_in_window })),
      grace_period: aDecisions.filter((d) => d.reason === "grace_period").map((d) => d.kind),
    },
    b_cluster_aware_breeding: {
      enabled: bEnabled,
      window_days: bThresholds.windowDays,
      trips_in_window: trips.length,
      family_weights: Object.fromEntries(breedingWeights.entries()),
    },
    arena_status: {
      latest_gen: gen?.gen_number ?? null,
      latest_gen_sealed: gen?.sealed_at ?? null,
      latest_gen_open: gen?.sealed_at === null,
      ticks_elapsed: gen?.tick_count ?? 0,
      ticks_to_seal: gen?.sealed_at === null ? Math.max(0, evolveEvery - (gen?.tick_count ?? 0)) : null,
      alive_agents: aliveCount,
      elite_agents: eliteCount,
    },
  };

  console.log("[snapshot-evolution-state]");
  console.log(`  A (dynamic kind blacklist): ${aEnabled ? "ENABLED" : "DISABLED"}`);
  console.log(`    eligible: ${snapshot.a_dynamic_blacklist.eligible_now.join(", ") || "(none)"}`);
  console.log(`    blacklisted: ${snapshot.a_dynamic_blacklist.blacklisted_now.map((b) => b.kind).join(", ") || "(none)"}`);
  console.log(`    grace-period: ${snapshot.a_dynamic_blacklist.grace_period.join(", ") || "(none)"}`);
  console.log(`  B (cluster-aware breeding): ${bEnabled ? "ENABLED" : "DISABLED"}`);
  console.log(`    trips in ${bThresholds.windowDays}d: ${trips.length}`);
  console.log(`    family weights: ${Object.entries(snapshot.b_cluster_aware_breeding.family_weights).map(([f, w]) => `${f}=${w.toFixed(2)}`).join(", ") || "(none — no recent trips)"}`);
  console.log(`  arena: gen ${gen?.gen_number ?? "?"} ${gen?.sealed_at === null ? `(OPEN ticks ${gen?.tick_count}/${evolveEvery})` : `(sealed ${gen?.sealed_at?.slice(0, 16)})`} · ${aliveCount} alive, ${eliteCount} elite`);

  if (dryRun) {
    console.log("\n(dry-run — no DB write)");
    return;
  }

  insertEvolutionEvent({
    event_type: "evolution-state-snapshot",
    summary: `Snapshot: A=${aEnabled ? "on" : "off"} (${snapshot.a_dynamic_blacklist.eligible_now.length} eligible) · B=${bEnabled ? "on" : "off"} (${trips.length} trips, ${breedingWeights.size} weighted families) · gen ${gen?.gen_number ?? "?"} ${gen?.sealed_at === null ? "OPEN" : "sealed"}`,
    payload_json: JSON.stringify(snapshot),
  });
  recordHeartbeat("snapshot-evolution", {
    a_enabled: aEnabled,
    b_enabled: bEnabled,
    eligible_count: snapshot.a_dynamic_blacklist.eligible_now.length,
    blacklisted_count: snapshot.a_dynamic_blacklist.blacklisted_now.length,
    breeding_weights_count: breedingWeights.size,
  });
  console.log("\n  → wrote evolution-state-snapshot row.");
}

main();
