/**
 * /arena/cohorts — group agents by introduced_by tag.
 *
 * Each row is a cohort: a batch of agents introduced under the same source
 * (an archetype seed, a training campaign, evolved survivors, etc.). Shows
 * how the cohort is performing collectively + links to drill-in.
 */
import Link from "next/link";
import { listCohorts } from "@/lib/arena/cohorts";

export const dynamic = "force-dynamic";

export default async function CohortsPage() {
  const cohorts = listCohorts(100);
  return (
    <main className="p-6 max-w-6xl mx-auto text-zinc-200 space-y-6">
      <div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <Link href="/arena/high-pnl-agents" className="text-zinc-500 hover:text-zinc-300 text-xs">← arena</Link>
          <h1 className="text-2xl font-semibold">Cohorts</h1>
        </div>
        <p className="text-zinc-500 text-sm mt-1">
          Agents grouped by `introduced_by` tag. A cohort is a batch that shares an origin —
          an archetype seed, a training campaign output, an evolved generation. See which
          cohorts are producing the high-PnL agents the factory is supposed to ship.
        </p>
      </div>

      <section>
        <h2 className="text-sm font-medium text-zinc-300 mb-2">
          {cohorts.length} cohort{cohorts.length === 1 ? "" : "s"}
        </h2>
        <div className="overflow-x-auto rounded border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900/60 text-zinc-500">
              <tr>
                <th className="text-left px-2 py-1.5">cohort</th>
                <th className="text-right px-2 py-1.5">agents</th>
                <th className="text-right px-2 py-1.5">alive</th>
                <th className="text-right px-2 py-1.5">elite</th>
                <th className="text-right px-2 py-1.5">total PnL</th>
                <th className="text-right px-2 py-1.5">mean PnL</th>
                <th className="text-right px-2 py-1.5">best PnL</th>
                <th className="text-left px-2 py-1.5">top performer</th>
                <th className="text-left px-2 py-1.5">first seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {cohorts.map((c) => (
                <tr key={c.cohort} className="hover:bg-zinc-900/40">
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/arena/cohorts/${encodeURIComponent(c.cohort)}`}
                      className="text-zinc-200 hover:text-accent-blue"
                    >
                      {c.cohort}
                    </Link>
                    {c.cohort.startsWith("campaign-") && (
                      <Link
                        href={`/arena/training-campaigns/${c.cohort.slice("campaign-".length)}`}
                        className="ml-2 text-[10px] text-accent-amber/80 hover:text-accent-amber"
                      >
                        → campaign
                      </Link>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{c.n_agents}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{c.n_alive}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {c.n_elite > 0 ? <span className="text-accent-amber">{c.n_elite}</span> : <span className="text-zinc-600">0</span>}
                  </td>
                  <td
                    className={
                      "px-2 py-1.5 text-right tabular-nums " +
                      ((c.total_pnl_usd ?? 0) >= 0 ? "text-accent-green" : "text-accent-red")
                    }
                  >
                    {fmtUsd(c.total_pnl_usd ?? 0)}
                  </td>
                  <td
                    className={
                      "px-2 py-1.5 text-right tabular-nums " +
                      ((c.mean_pnl_usd ?? 0) >= 0 ? "text-accent-green/80" : "text-accent-red/80")
                    }
                  >
                    {fmtUsd(c.mean_pnl_usd ?? 0)}
                  </td>
                  <td
                    className={
                      "px-2 py-1.5 text-right tabular-nums " +
                      ((c.top_pnl_usd ?? 0) >= 0 ? "text-accent-green" : "text-accent-red")
                    }
                  >
                    {fmtUsd(c.top_pnl_usd ?? 0)}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-400">
                    {c.top_agent_id != null ? (
                      <Link href={`/arena/agents/${c.top_agent_id}/train`} className="hover:text-accent-blue">
                        {c.top_agent_name} <span className="text-zinc-600">#{c.top_agent_id}</span>
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{c.first_seen_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <nav className="text-xs text-zinc-500 flex gap-4">
        <Link href="/arena/high-pnl-agents" className="hover:text-zinc-300">→ High-PnL agents</Link>
        <Link href="/arena/training-campaigns" className="hover:text-zinc-300">→ Training campaigns</Link>
      </nav>
    </main>
  );
}

function fmtUsd(n: number): string {
  return `${n < 0 ? "−$" : "$"}${Math.abs(n).toFixed(2)}`;
}
