/**
 * /training — live view of what agents are training, and what the
 * self-evolution mechanisms are doing right now.
 *
 * Pulls from:
 *   - paper_agents + paper_generations: who's alive, what gen
 *   - evolution_log: recent self-evolution events + snapshot rows
 *   - Re-runs the A + B compute live so the page reflects current state
 *     (not just the last snapshot)
 */
import Link from "next/link";
import { db } from "@/lib/db/client";
import { AutoRefresh } from "@/components/AutoRefresh";
import {
  decideKindEligibility,
  eligibleKinds,
  isDynamicBlacklistEnabled,
  readThresholdsFromEnv as readEligibilityThresholds,
  type KindPerformance,
} from "@/lib/arena/dynamic-eligibility";
import {
  computeBreedingWeights,
  isClusterAwareBreedingEnabled,
  readBreedingThresholdsFromEnv,
  type ClusterTripEvent,
} from "@/lib/arena/cluster-aware-breeding";
import { inferDiversityProfile } from "@/lib/capsules/diversity-inference";
import { readHeartbeatStatus } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";

export default async function TrainingPage() {
  const dbHandle = db();
  const evolveEvery = Number(process.env.ARENA_EVOLVE_EVERY ?? "6");

  // ── Current generation state ───────────────────────────────────────
  const latestGen = dbHandle
    .prepare("SELECT gen_number, sealed_at, tick_count, started_at FROM paper_generations ORDER BY gen_number DESC LIMIT 1")
    .get() as { gen_number: number; sealed_at: string | null; tick_count: number; started_at: string } | undefined;

  // ── Alive agents organized by gen ──────────────────────────────────
  const aliveByGen = dbHandle
    .prepare(
      `SELECT generation, is_elite, COUNT(*) AS n
         FROM paper_agents
        WHERE alive = 1
        GROUP BY generation, is_elite
        ORDER BY generation DESC`,
    )
    .all() as Array<{ generation: number; is_elite: number; n: number }>;
  const genSummary = new Map<number, { alive: number; elites: number }>();
  for (const row of aliveByGen) {
    const entry = genSummary.get(row.generation) ?? { alive: 0, elites: 0 };
    entry.alive += row.n;
    if (row.is_elite) entry.elites += row.n;
    genSummary.set(row.generation, entry);
  }
  const totalAlive = [...genSummary.values()].reduce((s, x) => s + x.alive, 0);
  const totalElites = [...genSummary.values()].reduce((s, x) => s + x.elites, 0);

  // ── A (dynamic kind blacklist) live state ─────────────────────────
  const aEnabled = isDynamicBlacklistEnabled();
  const aThresholds = readEligibilityThresholds();
  const windowDays = Number(process.env.ARENA_DYNAMIC_KIND_WINDOW_DAYS ?? "30");
  const cutoffIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const tradeRows = dbHandle
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

  // ── B (cluster-aware breeding) live state ─────────────────────────
  const bEnabled = isClusterAwareBreedingEnabled();
  const bThresholds = readBreedingThresholdsFromEnv();
  const bCutoffIso = new Date(Date.now() - bThresholds.windowDays * 86_400_000).toISOString();
  const tripRows = dbHandle
    .prepare(
      `SELECT created_at, summary, payload_json
         FROM evolution_log
        WHERE event_type = 'cluster-killswitch-trip' AND created_at >= ?`,
    )
    .all(bCutoffIso) as Array<{ created_at: string; summary: string; payload_json: string }>;
  const trips: ClusterTripEvent[] = [];
  for (const row of tripRows) {
    let strategyFamily: string | null = null;
    try {
      const payload = JSON.parse(row.payload_json) as { summary?: string };
      const text = payload.summary ?? row.summary;
      const m = /family '([^']+)' tripped/.exec(text);
      if (m) strategyFamily = m[1] ?? null;
    } catch { /* skip */ }
    trips.push({ ts: row.created_at, reason: "strategy_family_cluster", strategy_family: strategyFamily });
  }
  const breedingWeights = computeBreedingWeights(trips, bThresholds);

  // ── Recent self-evolution events ───────────────────────────────────
  const recentEvents = dbHandle
    .prepare(
      `SELECT created_at, event_type, summary
         FROM evolution_log
        WHERE event_type IN (
          'kind-dynamic-blacklisted',
          'cluster-aware-breeding-applied',
          'cluster-killswitch-trip',
          'capsule-auto-promote-vetoed',
          'capsule-auto-paused',
          'capsule-auto-promoted',
          'capsule-auto-rebalanced',
          'meta-evolve',
          'evolution-state-snapshot'
        )
        ORDER BY created_at DESC
        LIMIT 30`,
    )
    .all() as Array<{ created_at: string; event_type: string; summary: string }>;

  // ── Snapshot count for testing visibility ──────────────────────────
  const snapshotCount = (dbHandle.prepare("SELECT COUNT(*) AS n FROM evolution_log WHERE event_type = 'evolution-state-snapshot'").get() as { n: number }).n;

  const lastSeal = latestGen?.sealed_at;
  const isStale = lastSeal && Date.now() - Date.parse(lastSeal) > 60 * 60_000; // ≥1h since last seal

  return (
    <main className="space-y-6">
      <AutoRefresh label="training" intervalMs={20_000} />

      <section className="card border-accent-blue/30">
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-xl font-medium text-zinc-100">Training</h1>
          <span className="text-[10px] text-zinc-500">
            self-evolution mechanisms · refreshes 20s
          </span>
        </div>
        <p className="text-xs text-zinc-400">
          What agents are training right now, and what the self-evolution mechanisms are doing about it.
        </p>
      </section>

      {/* Heartbeat health — supervisor + each subsystem's last seen ts */}
      {(() => {
        const heartbeats = readHeartbeatStatus(["arena-tick", "arena-evolve", "snapshot-evolution", "portfolio-snapshot", "reconcile", "supervisor"]);
        const anyStale = heartbeats.some((h) => h.is_stale);
        return (
          <section className={`card ${anyStale ? "border-accent-red/40 bg-accent-red/5" : "border-accent-green/30"}`}>
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="card-title m-0">
                Subsystem heartbeats
                <span className={`text-[10px] ml-2 ${anyStale ? "text-accent-red" : "text-accent-green"}`}>
                  {anyStale ? `⚠ ${heartbeats.filter((h) => h.is_stale).length} stale` : "✓ all fresh"}
                </span>
              </h2>
              <span className="text-[10px] text-zinc-500">
                supervisor auto-recovers stale subsystems every 5min
              </span>
            </div>
            <table className="list w-full">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="text-left">Subsystem</th>
                  <th className="text-right">Last heartbeat</th>
                  <th className="text-right">Stale after</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {heartbeats.map((h) => (
                  <tr key={h.subsystem} className="text-xs">
                    <td className="font-mono text-zinc-300">{h.subsystem}</td>
                    <td className="text-right tabular-nums text-zinc-400">
                      {h.age_minutes === null ? "never" : `${h.age_minutes < 60 ? `${h.age_minutes.toFixed(1)}m` : `${(h.age_minutes / 60).toFixed(1)}h`} ago`}
                    </td>
                    <td className="text-right tabular-nums text-zinc-500">{h.stale_after_minutes}m</td>
                    <td className={`text-xs ${h.is_stale ? "text-accent-red" : "text-accent-green"}`}>
                      {h.is_stale ? "⚠ stale" : "✓ fresh"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-zinc-500 mt-3">
              Install the supervisor:{" "}
              <code className="text-zinc-300">
                powershell scripts/scheduler/install-supervisor.ps1
              </code>
              {" · "}
              Manual run: <code className="text-zinc-300">npm run supervisor</code>
            </p>
          </section>
        );
      })()}

      {/* ── Gen status ─────────────────────────────────────────────── */}
      <section className={`card ${latestGen?.sealed_at === null ? "border-accent-green/30" : isStale ? "border-accent-red/40 bg-accent-red/5" : "border-zinc-700"}`}>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="card-title m-0">Generation status</h2>
          <span className="text-[10px] text-zinc-500">latest = {latestGen?.gen_number ?? "—"}</span>
        </div>
        {!latestGen ? (
          <p className="text-xs text-zinc-500 italic">No generations recorded. Run npm run arena:init.</p>
        ) : (
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-[10px] uppercase text-zinc-500">Current gen</div>
              <div className="text-xl text-zinc-100 tabular-nums">
                {latestGen.gen_number}
                {latestGen.sealed_at === null && (
                  <span className="text-xs text-accent-green ml-2">OPEN</span>
                )}
              </div>
              <div className="text-[10px] text-zinc-500">
                {latestGen.sealed_at === null
                  ? `started ${latestGen.started_at?.slice(11, 16) ?? "?"}Z`
                  : `sealed ${latestGen.sealed_at.slice(0, 16).replace("T", " ")}Z`}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-zinc-500">Tick progress</div>
              <div className="text-xl text-zinc-100 tabular-nums">
                {latestGen.tick_count} / {evolveEvery}
              </div>
              <div className="text-[10px] text-zinc-500">
                {latestGen.sealed_at === null
                  ? `${Math.max(0, evolveEvery - latestGen.tick_count)} ticks to seal`
                  : "sealed"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-zinc-500">Alive agents</div>
              <div className="text-xl text-zinc-100 tabular-nums">{totalAlive}</div>
              <div className="text-[10px] text-zinc-500">
                across {genSummary.size} generations
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-zinc-500">Elites</div>
              <div className="text-xl text-accent-amber tabular-nums">{totalElites}</div>
              <div className="text-[10px] text-zinc-500">protected from cull</div>
            </div>
          </div>
        )}
        {isStale && (
          <div className="text-[11px] text-accent-red mt-3">
            ⚠ Last seal was {Math.round((Date.now() - Date.parse(lastSeal!)) / 60_000)} minutes ago. Arena tick
            scheduler may be stopped. Run <code className="text-zinc-300">npx tsx scripts/arena-tick.ts</code> manually
            or check the Windows Task Scheduler.
          </div>
        )}
      </section>

      {/* ── Mechanism A — dynamic kind blacklist ────────────────────── */}
      <section className={`card ${aEnabled ? "border-zinc-700" : "border-zinc-800 opacity-60"}`}>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="card-title m-0">
            A · Dynamic Kind Blacklist
            <span className={`text-[10px] ml-2 ${aEnabled ? "text-accent-green" : "text-zinc-500"}`}>
              {aEnabled ? "ENABLED" : "DISABLED"}
            </span>
          </h2>
          <span className="text-[10px] text-zinc-500">
            window {windowDays}d · grace {aThresholds.gracePeriodTrades} trades · floor ${aThresholds.pnlFloor}
          </span>
        </div>
        <p className="text-xs text-zinc-400 mb-3">
          A kind drops out automatically when its rolling-{windowDays}d realized PnL ≤ ${aThresholds.pnlFloor}. Auto-reinstates when perf recovers. The static <code>ARENA_AUTO_PROMOTE_LIVE_KINDS</code> env list is the safety ceiling.
        </p>
        <table className="list w-full">
          <thead>
            <tr className="text-xs text-zinc-500">
              <th className="text-left">Kind</th>
              <th className="text-right">Trades in window</th>
              <th className="text-right">Realized PnL</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {aDecisions.map((d) => {
              const color =
                d.eligible && d.reason === "positive_pnl"
                  ? "text-accent-green"
                  : d.eligible
                    ? "text-accent-amber"
                    : "text-accent-red";
              const label =
                d.reason === "positive_pnl"
                  ? "✓ eligible"
                  : d.reason === "grace_period"
                    ? "○ grace period"
                    : d.reason === "negative_pnl"
                      ? "✗ blacklisted"
                      : "—";
              return (
                <tr key={d.kind} className="text-xs">
                  <td className="font-mono text-zinc-300">{d.kind}</td>
                  <td className="text-right tabular-nums text-zinc-400">{d.trades_in_window}</td>
                  <td className={`text-right tabular-nums ${d.realized_pnl_in_window > 0 ? "text-accent-green" : d.realized_pnl_in_window < 0 ? "text-accent-red" : "text-zinc-500"}`}>
                    ${d.realized_pnl_in_window.toFixed(2)}
                  </td>
                  <td className={`text-xs ${color}`}>{label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-[11px] text-zinc-500 mt-2">
          {aEligibleNow.size} of {aDecisions.length} kinds eligible for live promotion right now.
        </div>
      </section>

      {/* ── Mechanism B — cluster-aware breeding ─────────────────────── */}
      <section className={`card ${bEnabled ? "border-zinc-700" : "border-zinc-800 opacity-60"}`}>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="card-title m-0">
            B · Cluster-Aware Breeding
            <span className={`text-[10px] ml-2 ${bEnabled ? "text-accent-green" : "text-zinc-500"}`}>
              {bEnabled ? "ENABLED" : "DISABLED"}
            </span>
          </h2>
          <span className="text-[10px] text-zinc-500">
            window {bThresholds.windowDays}d · decay {bThresholds.decayDays}d · severity {bThresholds.severity}
          </span>
        </div>
        <p className="text-xs text-zinc-400 mb-3">
          When a strategy_family cluster gets killswitched, parents from that family get under-weighted in the
          next gen seal&apos;s parent-selection. Penalty decays exponentially over ~{bThresholds.decayDays}d.
        </p>
        {trips.length === 0 ? (
          <div className="text-xs text-zinc-500 italic">
            No cluster killswitch trips in last {bThresholds.windowDays}d → nothing for B to react to.
            Breeding selection is currently pure-fitness ordered.
          </div>
        ) : (
          <>
            <div className="text-xs text-zinc-400 mb-2">
              {trips.length} cluster trip{trips.length === 1 ? "" : "s"} in window. Resulting family weights:
            </div>
            <table className="list w-full">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="text-left">Strategy family</th>
                  <th className="text-right">Current weight</th>
                  <th>Effect on breeding</th>
                </tr>
              </thead>
              <tbody>
                {[...breedingWeights.entries()]
                  .sort((a, b) => a[1] - b[1])
                  .map(([family, weight]) => (
                    <tr key={family} className="text-xs">
                      <td className="font-mono text-zinc-300">{family}</td>
                      <td className={`text-right tabular-nums ${weight < 0.5 ? "text-accent-red" : weight < 0.8 ? "text-accent-amber" : "text-accent-green"}`}>
                        ×{weight.toFixed(2)}
                      </td>
                      <td className="text-xs text-zinc-400">
                        {weight < 0.3
                          ? "heavily under-bred"
                          : weight < 0.7
                            ? "moderately under-bred"
                            : "near-normal"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ── Alive agents by generation ──────────────────────────────── */}
      <section className="card">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="card-title m-0">Agents in training</h2>
          <span className="text-[10px] text-zinc-500">alive across all generations</span>
        </div>
        {genSummary.size === 0 ? (
          <p className="text-xs text-zinc-500 italic">No alive agents.</p>
        ) : (
          <table className="list w-full">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="text-left">Generation</th>
                <th className="text-right">Alive</th>
                <th className="text-right">Elites</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...genSummary.entries()]
                .sort((a, b) => b[0] - a[0])
                .map(([gen, stats]) => (
                  <tr key={gen} className="text-xs">
                    <td className="font-mono text-zinc-300">
                      <Link href={`/arena/generations/${gen}`} className="hover:text-accent-blue">
                        gen {gen}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums text-zinc-300">{stats.alive}</td>
                    <td className="text-right tabular-nums text-accent-amber">{stats.elites}</td>
                    <td className="text-[10px] text-zinc-500">
                      {gen === latestGen?.gen_number ? "← current" : gen === (latestGen?.gen_number ?? 0) - 1 ? "← prev" : ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Recent self-evolution events ────────────────────────────── */}
      <section className="card">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="card-title m-0">Recent self-evolution events</h2>
          <span className="text-[10px] text-zinc-500">
            {snapshotCount} snapshots captured · <code>npm run snapshot:evolution</code>
          </span>
        </div>
        {recentEvents.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">
            No events yet. Run <code>npm run snapshot:evolution</code> to start capturing state, or trigger a
            gen seal via <code>npx tsx scripts/arena-evolve.ts</code>.
          </p>
        ) : (
          <table className="list w-full">
            <thead>
              <tr className="text-xs text-zinc-500">
                <th className="text-left">Time</th>
                <th className="text-left">Event</th>
                <th className="text-left">Summary</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((ev, i) => (
                <tr key={i} className="text-xs">
                  <td className="font-mono text-zinc-500">{ev.created_at.slice(5, 16).replace("T", " ")}</td>
                  <td className="font-mono text-[10px] text-zinc-400">{ev.event_type}</td>
                  <td className="text-zinc-300">{ev.summary.slice(0, 100)}{ev.summary.length > 100 ? "…" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── A/B test plan footer ────────────────────────────────────── */}
      <section className="card border-zinc-700/50">
        <h3 className="text-sm text-zinc-300 mb-2">A/B comparison</h3>
        <ul className="text-xs text-zinc-400 space-y-1">
          <li>
            <code className="text-zinc-300">npm run compare:evolution</code> — read evidence trail of each mechanism
          </li>
          <li>
            <code className="text-zinc-300">npm run snapshot:evolution</code> — capture current state to journal
          </li>
          <li>
            Toggle A: set <code className="text-zinc-300">DYNAMIC_KIND_BLACKLIST=0</code> in .env.local
          </li>
          <li>
            Toggle B: set <code className="text-zinc-300">CLUSTER_AWARE_BREEDING=0</code> in .env.local
          </li>
        </ul>
      </section>
    </main>
  );
}
