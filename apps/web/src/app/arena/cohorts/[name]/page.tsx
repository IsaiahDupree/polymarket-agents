/**
 * /arena/cohorts/[name] — drill-in: every agent in a cohort sorted by lifetime PnL.
 */
import Link from "next/link";
import { getCohort, getCohortGraduationStats, listCohortAgents } from "@/lib/arena/cohorts";

export const dynamic = "force-dynamic";

export default async function CohortDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: encodedName } = await params;
  const cohortName = decodeURIComponent(encodedName);
  const cohort = getCohort(cohortName);

  if (!cohort) {
    return (
      <main className="p-6 max-w-5xl mx-auto text-zinc-200">
        <Link href="/arena/cohorts" className="text-zinc-500 hover:text-zinc-300 text-xs">← cohorts</Link>
        <h1 className="text-xl mt-2">Cohort &quot;{cohortName}&quot; has no agents</h1>
      </main>
    );
  }

  const agents = listCohortAgents(cohortName, 200);
  const gradStats = getCohortGraduationStats(cohortName);

  return (
    <main className="p-6 max-w-6xl mx-auto text-zinc-200 space-y-6">
      <div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <Link href="/arena/cohorts" className="text-zinc-500 hover:text-zinc-300 text-xs">← cohorts</Link>
          <h1 className="text-2xl font-semibold">
            <span className="text-accent-amber">{cohort.cohort}</span>
          </h1>
          {cohort.cohort.startsWith("campaign-") && (
            <Link
              href={`/arena/training-campaigns/${cohort.cohort.slice("campaign-".length)}`}
              className="text-[11px] px-1.5 py-0.5 rounded border border-accent-amber/40 text-accent-amber hover:bg-accent-amber/10"
            >
              → campaign source
            </Link>
          )}
        </div>
        <div className="text-zinc-500 text-sm mt-1">
          first seen {cohort.first_seen_at?.slice(0, 16)?.replace("T", " ")} · last seen {cohort.last_seen_at?.slice(0, 16)?.replace("T", " ")}
        </div>
      </div>

      <section className="grid grid-cols-2 md:grid-cols-7 gap-3 text-sm">
        <Stat label="agents" value={String(cohort.n_agents)} />
        <Stat label="alive" value={String(cohort.n_alive)} />
        <Stat label="elite" value={String(cohort.n_elite)} accent={cohort.n_elite > 0 ? "amber" : undefined} />
        <Stat
          label="total PnL"
          value={fmtUsd(cohort.total_pnl_usd ?? 0)}
          accent={(cohort.total_pnl_usd ?? 0) >= 0 ? "green" : "red"}
        />
        <Stat
          label="best agent"
          value={fmtUsd(cohort.top_pnl_usd ?? 0)}
          sub={cohort.top_agent_name ?? undefined}
          accent={(cohort.top_pnl_usd ?? 0) >= 0 ? "green" : "red"}
        />
        <Stat
          label="staged"
          value={String(gradStats.n_capsules_staged)}
          sub="paper capsules"
          accent={gradStats.n_capsules_staged > 0 ? "amber" : undefined}
        />
        <Stat
          label="graduation eligible"
          value={String(gradStats.n_eligible)}
          sub="last 7d"
          accent={gradStats.n_eligible > 0 ? "green" : undefined}
        />
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-300 mb-2">
          agents in cohort ({agents.length})
        </h2>
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/60 text-zinc-500">
              <tr>
                <th className="text-left px-2 py-1.5">rank</th>
                <th className="text-left px-2 py-1.5">agent</th>
                <th className="text-left px-2 py-1.5">strategy</th>
                <th className="text-right px-2 py-1.5">gen</th>
                <th className="text-right px-2 py-1.5">lifetime PnL</th>
                <th className="text-right px-2 py-1.5">trades</th>
                <th className="text-right px-2 py-1.5">win %</th>
                <th className="text-left px-2 py-1.5">status</th>
                <th className="text-left px-2 py-1.5">capsule</th>
                <th className="text-left px-2 py-1.5">created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {agents.map((a, i) => (
                <tr key={a.id} className="hover:bg-zinc-900/40">
                  <td className="px-2 py-1.5 tabular-nums text-zinc-500">#{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <Link href={`/arena/agents/${a.id}/train`} className="text-zinc-200 hover:text-accent-blue">
                      {a.name}
                    </Link>
                    {a.is_elite === 1 && (
                      <span className="ml-1.5 text-[10px] px-1 rounded bg-accent-amber/20 text-accent-amber border border-accent-amber/40">
                        ELITE
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-400">{a.genome_kind}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">g{a.generation}</td>
                  <td
                    className={
                      "px-2 py-1.5 text-right tabular-nums " +
                      (a.lifetime_pnl_usd >= 0 ? "text-accent-green" : "text-accent-red")
                    }
                  >
                    {fmtUsd(a.lifetime_pnl_usd)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{a.trades_count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                    {a.trades_count > 0 ? `${((a.wins_count / a.trades_count) * 100).toFixed(0)}%` : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    {a.alive === 1 ? (
                      <span className="text-[10px] px-1 rounded bg-accent-green/15 text-accent-green border border-accent-green/40">alive</span>
                    ) : (
                      <span className="text-[10px] px-1 rounded bg-zinc-700 text-zinc-400">retired</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {a.capsule_id ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={
                            "text-[10px] px-1 rounded " +
                            (a.capsule_status === "live"
                              ? "bg-accent-red/15 text-accent-red border border-accent-red/40"
                              : a.capsule_status === "paper"
                              ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/40"
                              : "bg-zinc-700/40 text-zinc-400 border border-zinc-700/40")
                          }
                          title={`capsule ${a.capsule_id.slice(0, 8)} · capital $${(a.capsule_capital ?? 0).toFixed(2)}`}
                        >
                          {a.capsule_status} · ${(a.capsule_capital ?? 0).toFixed(0)}
                        </span>
                        {a.graduation_eligible === 1 && (
                          <span
                            className="text-[10px] px-1 rounded bg-accent-green/15 text-accent-green border border-accent-green/40"
                            title="cleared graduation gate within the last 7 days — eligible for live promotion (operator confirms)"
                          >
                            ✓ eligible
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[10px] text-zinc-600">no capsule</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{a.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" | "red" | "amber" }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={
          "text-base tabular-nums " +
          (accent === "green" ? "text-accent-green" : accent === "red" ? "text-accent-red" : accent === "amber" ? "text-accent-amber" : "text-zinc-200")
        }
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function fmtUsd(n: number): string {
  return `${n < 0 ? "−$" : "$"}${Math.abs(n).toFixed(2)}`;
}
