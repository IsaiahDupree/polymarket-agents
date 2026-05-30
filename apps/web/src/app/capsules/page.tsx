import Link from "next/link";
import { listCapsules } from "@risk/capsules/store";
import { listEligibleChampionships } from "@/lib/arena/championship";
import { getPaperAgent } from "@/lib/arena/db";
import { ActivateForm } from "./ActivateForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { db } from "@/lib/db/client";
import { lossOverlapScore } from "@/lib/portfolio/loss-overlap";
import type { DailyPnlPoint } from "@/lib/portfolio/correlation";

export const dynamic = "force-dynamic";

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default async function CapsulesPage() {
  const capsules = listCapsules();
  const eligible = listEligibleChampionships();

  // ── Pull governance extras for the existing capsule list ─────────────
  // (diversity profile columns + recent cluster-killswitch events + per-
  // capsule loss-overlap against the rest of the portfolio.)
  const dbHandle = db();
  const diversityRows = dbHandle
    .prepare(
      `SELECT id, strategy_family, asset_class, regime_dependency, time_horizon
         FROM capsules`,
    )
    .all() as Array<{ id: string; strategy_family: string | null; asset_class: string | null; regime_dependency: string | null; time_horizon: string | null }>;
  const diversityById = new Map(diversityRows.map((r) => [r.id, r]));

  // Recent cluster-killswitch / governor events per capsule (last 7d).
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();
  const recentClusterEvents = dbHandle
    .prepare(
      `SELECT created_at, summary
         FROM evolution_log
        WHERE event_type IN ('cluster-killswitch-trip', 'capsule-auto-paused')
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 100`,
    )
    .all(since7d) as Array<{ created_at: string; summary: string }>;
  // Match capsule IDs by first 8 chars in the summary (consistent with
  // how the killswitch + auto-pause modules write evolution_log rows).
  const recentClusterTripByCapsule = new Map<string, { ts: string; reason: string }>();
  for (const ev of recentClusterEvents) {
    for (const cap of capsules) {
      if (recentClusterTripByCapsule.has(cap.id)) continue;
      if (ev.summary.includes(cap.id.slice(0, 8))) {
        recentClusterTripByCapsule.set(cap.id, { ts: ev.created_at, reason: ev.summary.slice(0, 120) });
      }
    }
  }

  // Loss-overlap per active capsule from capsule_pnl_daily.
  const pnlRows = dbHandle
    .prepare(
      `SELECT capsule_id, pnl_date, daily_pnl_usd
         FROM capsule_pnl_daily
        WHERE pnl_date >= date('now', '-30 days')
        ORDER BY pnl_date ASC`,
    )
    .all() as Array<{ capsule_id: string; pnl_date: string; daily_pnl_usd: number }>;
  const seriesByCapsule = new Map<string, DailyPnlPoint[]>();
  for (const r of pnlRows) {
    const list = seriesByCapsule.get(r.capsule_id) ?? [];
    list.push({ date: r.pnl_date, pnl: r.daily_pnl_usd });
    seriesByCapsule.set(r.capsule_id, list);
  }
  const activeIds = capsules
    .filter((c) => c.status === "live" || c.status === "paper")
    .map((c) => c.id);
  const lossOverlapByCapsule = new Map<string, number | null>();
  for (const cap of capsules) {
    const target = seriesByCapsule.get(cap.id) ?? [];
    if (target.length === 0) {
      lossOverlapByCapsule.set(cap.id, null);
      continue;
    }
    const others = activeIds
      .filter((id) => id !== cap.id)
      .map((id) => ({ capsuleId: id, series: seriesByCapsule.get(id) ?? [] }));
    const r = lossOverlapScore({ targetSeries: target, others, windowDays: 30 });
    lossOverlapByCapsule.set(cap.id, r.targetLossDays > 0 ? r.score : null);
  }

  return (
    <div className="space-y-6">
      <AutoRefresh label="capsules" />
      <div>
        <h1 className="text-2xl font-semibold">Capsules</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Bounded real-money envelopes per agent. Stage ladder: draft → paper → live ⇄ paused → stopped|closed.
        </p>
      </div>

      {eligible.length > 0 && (
        <section className="card border-accent-amber/40 bg-accent-amber/5">
          <h2 className="card-title text-accent-amber">🏆 Eligible championships ({eligible.length})</h2>
          <p className="text-xs text-zinc-400 mt-1">
            These paper-agent lineages won top-1 in {process.env.ARENA_CHAMPION_GENS ?? "3"} consecutive sealed generations.
            Propose a paper capsule (you can edit caps before activating to live).
          </p>
          <table className="list mt-3">
            <thead><tr><th>#</th><th>Paper agent</th><th className="text-right">Gen wins</th><th>Rationale</th><th>Capsule</th><th></th></tr></thead>
            <tbody>
              {eligible.map((c) => {
                const agent = getPaperAgent(c.paper_agent_id);
                return (
                  <tr key={c.id}>
                    <td className="text-zinc-500 text-xs">{c.id}</td>
                    <td>
                      <Link className="text-zinc-100 hover:text-accent-blue" href={`/arena/${c.paper_agent_id}`}>
                        {agent?.name ?? `#${c.paper_agent_id}`}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{c.consecutive_gen_wins}</td>
                    <td className="text-xs text-zinc-400">{c.rationale ?? "—"}</td>
                    <td>{c.capsule_id ? <code className="text-xs">{c.capsule_id.slice(0, 8)}…</code> : <span className="text-zinc-500 text-xs">not proposed</span>}</td>
                    <td>
                      {!c.capsule_id ? (
                        <ProposeForm championshipId={c.id} />
                      ) : (
                        <span className="pill-amber">proposed</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Capsules ({capsules.length})</h2>
        {capsules.length === 0 ? (
          <p className="text-xs text-zinc-500">No capsules yet. Run arena ticks + evolve until a lineage qualifies, then propose above.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Capsule</th>
                <th>Status</th>
                <th title="Diversity profile inferred from bound strategy (Phase 6 of capsule-portfolio-governance PRD)">Profile</th>
                <th className="text-right" title="Mean P(other capsule lost | this capsule lost) over the last 30 days. Higher = more redundant.">Loss-overlap</th>
                <th title="Recent cluster kill-switch or auto-pause event for this capsule (last 7d)">Cluster state</th>
                <th className="text-right">Allocated</th>
                <th className="text-right">PnL</th>
                <th className="text-right">Daily PnL</th>
                <th>Venues</th>
                <th>Activated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {capsules.map((c) => {
                const div = diversityById.get(c.id);
                const lossOverlap = lossOverlapByCapsule.get(c.id) ?? null;
                const trip = recentClusterTripByCapsule.get(c.id) ?? null;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link className="text-zinc-100 hover:text-accent-blue" href={`/capsules/${c.id}`}>{c.name}</Link>
                      <div className="text-[10px] text-zinc-500">{c.id.slice(0, 8)}…</div>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td>
                      {div?.strategy_family ? (
                        <div className="flex flex-wrap gap-1">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono">
                            {div.strategy_family}
                          </span>
                          {div.asset_class && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-mono">
                              {div.asset_class}
                            </span>
                          )}
                          {div.regime_dependency && div.regime_dependency !== "any" && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-mono">
                              {div.regime_dependency}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-zinc-600 italic">not inferred</span>
                      )}
                    </td>
                    <td
                      className={`text-right tabular-nums text-xs ${
                        lossOverlap === null
                          ? "text-zinc-600"
                          : lossOverlap > 0.70
                            ? "text-accent-red"
                            : lossOverlap > 0.40
                              ? "text-accent-amber"
                              : "text-accent-green"
                      }`}
                      title={
                        lossOverlap === null
                          ? "No loss days in 30d window — can't measure"
                          : `Mean overlap with other active capsules' loss days`
                      }
                    >
                      {lossOverlap === null ? "—" : `${(lossOverlap * 100).toFixed(0)}%`}
                    </td>
                    <td>
                      {trip ? (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red border border-accent-red/40 font-mono"
                          title={`${trip.ts.slice(0, 16).replace("T", " ")} · ${trip.reason}`}
                        >
                          ⚠ cluster trip ({trip.ts.slice(5, 10)})
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-600">clean</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{fmtUsd(c.capital_allocated_usd)}</td>
                    <td className={`text-right tabular-nums ${c.current_pnl_usd >= 0 ? "text-accent-green" : "text-accent-red"}`}>{fmtUsd(c.current_pnl_usd)}</td>
                    <td className={`text-right tabular-nums ${c.daily_pnl_usd >= 0 ? "text-accent-green" : "text-accent-red"}`}>
                      {fmtUsd(c.daily_pnl_usd)}
                      <div className="text-[10px] text-zinc-500">cap {fmtUsd(c.max_daily_loss_usd)}</div>
                    </td>
                    <td className="text-xs text-zinc-400">{c.allowed_venues.join(", ")}</td>
                    <td className="text-xs text-zinc-500">{c.activated_at ? new Date(c.activated_at).toLocaleString() : "—"}</td>
                    <td>
                      {c.status === "paper" && <ActivateForm capsuleId={c.id} />}
                      {c.status === "live" && <PauseForm capsuleId={c.id} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "live" ? "pill-green" : status === "paper" ? "pill-blue" : status === "paused" ? "pill-amber" : "pill-red";
  return <span className={cls}>{status}</span>;
}

function ProposeForm({ championshipId }: { championshipId: number }) {
  return (
    <form action={`/api/arena/championships/${championshipId}/propose`} method="POST" className="inline">
      <button
        type="submit"
        className="text-xs px-2 py-1 rounded bg-accent-amber/15 text-accent-amber hover:bg-accent-amber/25"
      >
        Propose ($25 capsule)
      </button>
    </form>
  );
}
function PauseForm({ capsuleId }: { capsuleId: string }) {
  return (
    <form action={`/api/capsules/${capsuleId}/pause`} method="POST" className="inline">
      <input type="hidden" name="reason" value="UI kill-switch" />
      <button
        type="submit"
        className="text-xs px-2 py-1 rounded bg-accent-amber/15 text-accent-amber hover:bg-accent-amber/25"
      >
        Kill switch (pause)
      </button>
    </form>
  );
}
