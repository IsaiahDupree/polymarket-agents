/**
 * Compare the two self-evolving mechanisms — Dynamic Kind Blacklist (A) vs
 * Cluster-Aware Breeding (B) — against actual outcome data.
 *
 * Both mechanisms are usually on simultaneously, so this script doesn't
 * compute "A vs B" in isolation. Instead it surfaces the *evidence trail*
 * each mechanism leaves and lets the operator judge which is contributing
 * more value:
 *
 *   For A:
 *     - Which kinds got dynamically blacklisted? (event_type='kind-dynamic-blacklisted')
 *     - When they were blacklisted, how was their post-blacklist trajectory?
 *     - Did the freed capacity go to better-performing kinds?
 *
 *   For B:
 *     - Which families got under-weighted in breeding? (event_type='cluster-aware-breeding-applied')
 *     - What fitness did their lineage's children achieve compared to the
 *       counterfactual (children that WOULDN'T have been under-weighted)?
 *
 *   npx tsx scripts/compare-evolution-mechanisms.ts
 *   npx tsx scripts/compare-evolution-mechanisms.ts --days 30
 */
import "./_env.ts";
import { db as openDb } from "../src/lib/db/client.ts";

type Args = { lookbackDays: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { lookbackDays: 14 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--days") args.lookbackDays = Number(argv[++i]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const db = openDb();
  const since = new Date(Date.now() - args.lookbackDays * 86_400_000).toISOString();

  console.log(`Evolution-mechanism comparison · last ${args.lookbackDays}d`);
  console.log("─".repeat(60));

  // ── Mechanism A: Dynamic Kind Blacklist ──────────────────────────────
  console.log("\nA. Dynamic Kind Blacklist");
  console.log("─".repeat(60));
  const aEvents = db
    .prepare(
      `SELECT created_at, summary, payload_json
         FROM evolution_log
        WHERE event_type = 'kind-dynamic-blacklisted'
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 20`,
    )
    .all(since) as Array<{ created_at: string; summary: string; payload_json: string }>;
  if (aEvents.length === 0) {
    console.log("  No dynamic-blacklist events. Either no kinds have failed, the");
    console.log("  feature is disabled (DYNAMIC_KIND_BLACKLIST=0), or auto-promote");
    console.log("  hasn't run since the feature shipped.");
  } else {
    // Aggregate which kinds were blacklisted, how often, with cumulative PnL.
    const kindBlacklists = new Map<string, { count: number; total_pnl: number; total_trades: number }>();
    for (const ev of aEvents) {
      try {
        const payload = JSON.parse(ev.payload_json) as {
          blacklisted: Array<{ kind: string; pnl: number; trades: number }>;
        };
        for (const b of payload.blacklisted) {
          const entry = kindBlacklists.get(b.kind) ?? { count: 0, total_pnl: 0, total_trades: 0 };
          entry.count++;
          entry.total_pnl += b.pnl;
          entry.total_trades += b.trades;
          kindBlacklists.set(b.kind, entry);
        }
      } catch { /* skip malformed */ }
    }
    console.log(`  ${aEvents.length} blacklist-decision events in window.`);
    console.log(`  Kinds excluded by A:`);
    const sorted = [...kindBlacklists.entries()].sort((a, b) => a[1].total_pnl - b[1].total_pnl);
    for (const [kind, stats] of sorted) {
      console.log(
        `    ${kind.padEnd(35)} → blacklisted ${stats.count}× · avg PnL/window $${(stats.total_pnl / Math.max(1, stats.count)).toFixed(2)} · trades ${stats.total_trades}`,
      );
    }
  }

  // ── Mechanism B: Cluster-Aware Breeding ──────────────────────────────
  console.log("\nB. Cluster-Aware Breeding Pressure");
  console.log("─".repeat(60));
  const bEvents = db
    .prepare(
      `SELECT created_at, summary, payload_json
         FROM evolution_log
        WHERE event_type = 'cluster-aware-breeding-applied'
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 50`,
    )
    .all(since) as Array<{ created_at: string; summary: string; payload_json: string }>;
  if (bEvents.length === 0) {
    console.log("  No cluster-aware-breeding events. Either no cluster trips in window,");
    console.log("  feature disabled (CLUSTER_AWARE_BREEDING=0), or evolve hasn't run since shipping.");
  } else {
    // Aggregate family weights applied across events.
    const familyWeights = new Map<string, { events: number; total_weight: number; min_weight: number }>();
    for (const ev of bEvents) {
      try {
        const payload = JSON.parse(ev.payload_json) as {
          family_weights: Record<string, number>;
        };
        for (const [family, w] of Object.entries(payload.family_weights ?? {})) {
          const entry = familyWeights.get(family) ?? { events: 0, total_weight: 0, min_weight: 1.0 };
          entry.events++;
          entry.total_weight += w;
          entry.min_weight = Math.min(entry.min_weight, w);
          familyWeights.set(family, entry);
        }
      } catch { /* skip */ }
    }
    console.log(`  ${bEvents.length} breeding-pressure events in window.`);
    console.log(`  Families under-weighted by B:`);
    const sorted = [...familyWeights.entries()].sort((a, b) => a[1].min_weight - b[1].min_weight);
    for (const [family, stats] of sorted) {
      const avg = stats.total_weight / Math.max(1, stats.events);
      console.log(
        `    ${family.padEnd(25)} → ${stats.events} gen seal(s) · avg weight ${avg.toFixed(2)} · min ${stats.min_weight.toFixed(2)}`,
      );
    }
  }

  // ── Lineage outcomes: did the system actually shift toward diversity? ──
  console.log("\nLineage diversity over time");
  console.log("─".repeat(60));
  // Count paper_agents created per (gen, inferred_family) over the window.
  const lineageRows = db
    .prepare(
      `SELECT generation, genome_json, COUNT(*) AS n
         FROM paper_agents
        WHERE created_at >= ?
        GROUP BY generation, genome_json`,
    )
    .all(since) as Array<{ generation: number; genome_json: string; n: number }>;
  // Map each genome_json to its kind, then aggregate per gen.
  const byGen = new Map<number, Map<string, number>>();
  for (const r of lineageRows) {
    let kind = "unknown";
    try { kind = JSON.parse(r.genome_json).kind ?? "unknown"; } catch { /* skip */ }
    const m = byGen.get(r.generation) ?? new Map<string, number>();
    m.set(kind, (m.get(kind) ?? 0) + r.n);
    byGen.set(r.generation, m);
  }
  const gens = [...byGen.keys()].sort((a, b) => a - b);
  if (gens.length === 0) {
    console.log("  No agents created in window.");
  } else {
    console.log(`  Generations spawned in window: ${gens.join(", ")}`);
    console.log(`  Distinct kinds per gen (more = more diverse breeding):`);
    for (const g of gens) {
      const kinds = byGen.get(g)!;
      const total = [...kinds.values()].reduce((s, x) => s + x, 0);
      console.log(`    gen ${g}: ${kinds.size} distinct kinds across ${total} agents`);
    }
  }

  // ── Recent cluster trips (input to B) ────────────────────────────────
  console.log("\nRecent cluster-killswitch trips (input signal for B)");
  console.log("─".repeat(60));
  const trips = db
    .prepare(
      `SELECT created_at, summary
         FROM evolution_log
        WHERE event_type = 'cluster-killswitch-trip' AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 10`,
    )
    .all(since) as Array<{ created_at: string; summary: string }>;
  if (trips.length === 0) {
    console.log("  No cluster trips in window — nothing for B to react to.");
  } else {
    console.log(`  ${trips.length} cluster trips in window:`);
    for (const t of trips) {
      console.log(`    ${t.created_at.slice(0, 16)} · ${t.summary.slice(0, 90)}`);
    }
  }

  console.log("\n─".repeat(60));
  console.log(`Toggle either mechanism off via env:`);
  console.log(`  DYNAMIC_KIND_BLACKLIST=0  → disable A (revert to static list)`);
  console.log(`  CLUSTER_AWARE_BREEDING=0  → disable B (revert to fitness-only selection)`);
}

main();
