"use client";

/**
 * Campaign detail: poll status every 3s until done, render ranked candidates.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

type Campaign = {
  id: number;
  name: string;
  kind: string;
  asset_filter: string | null;
  from_iso: string;
  to_iso: string;
  variants: number;
  status: string;
  candidates_produced: number;
  best_candidate_id: number | null;
  best_pnl_usd: number | null;
  best_fitness: number | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};
type Candidate = {
  id: number;
  rank: number;
  genome_json: string;
  pnl_usd: number;
  pnl_pct: number;
  trades_count: number;
  wins_count: number;
  max_dd_pct: number;
  fitness: number;
  paper_agent_id: number | null;
  notes: string | null;
};

export function CampaignDetail({
  initialCampaign,
  initialCandidates,
}: { initialCampaign: Campaign; initialCandidates: Candidate[] }) {
  const [campaign, setCampaign] = useState<Campaign>(initialCampaign);
  const [candidates, setCandidates] = useState<Candidate[]>(initialCandidates);

  // Poll every 3s while not in a terminal state.
  useEffect(() => {
    if (campaign.status === "done" || campaign.status === "failed") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/arena/training-campaigns/${campaign.id}`, { cache: "no-store" });
        const json = await res.json();
        if (json.ok) {
          setCampaign(json.campaign);
          setCandidates(json.candidates);
        }
      } catch { /* swallow — keep polling */ }
    }, 3000);
    return () => clearInterval(t);
  }, [campaign.id, campaign.status]);

  const elapsed =
    campaign.started_at
      ? Math.round(((campaign.ended_at ? Date.parse(campaign.ended_at) : Date.now()) - Date.parse(campaign.started_at)) / 1000)
      : 0;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Stat label="status" value={campaign.status} accent={statusAccent(campaign.status)} />
        <Stat label="candidates" value={`${campaign.candidates_produced} / ${campaign.variants}`} />
        <Stat
          label="best PnL"
          value={campaign.best_pnl_usd != null ? `${(campaign.best_pnl_usd >= 0 ? "+$" : "−$") + Math.abs(campaign.best_pnl_usd).toFixed(2)}` : "—"}
          accent={(campaign.best_pnl_usd ?? 0) >= 0 ? "green" : "red"}
        />
        <Stat label="best fitness" value={campaign.best_fitness != null ? campaign.best_fitness.toFixed(3) : "—"} />
        <Stat label="elapsed" value={prettyDuration(elapsed)} />
      </section>

      {campaign.error && (
        <section className="rounded border border-accent-red/40 bg-accent-red/10 p-3 text-sm text-accent-red">
          worker failed: {campaign.error}
        </section>
      )}

      {(campaign.status === "queued" || campaign.status === "running") && (
        <section className="rounded border border-accent-amber/40 bg-accent-amber/10 p-3 text-xs text-accent-amber">
          worker is {campaign.status}. each backtest is ~3 min through the dev server; {campaign.variants} variants ≈
          {' '}{(campaign.variants * 3).toFixed(0)} min wall-clock. this page auto-refreshes every 3s.
        </section>
      )}

      <section>
        <h2 className="text-sm font-medium text-zinc-300 mb-2">ranked candidates ({candidates.length})</h2>
        {candidates.length === 0 ? (
          <div className="text-xs text-zinc-500 italic">no candidates yet — waiting for the worker to start producing results.</div>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900/60 text-zinc-500">
                <tr>
                  <th className="text-left px-2 py-1.5">rank</th>
                  <th className="text-right px-2 py-1.5">PnL</th>
                  <th className="text-right px-2 py-1.5">PnL %</th>
                  <th className="text-right px-2 py-1.5">trades</th>
                  <th className="text-right px-2 py-1.5">win %</th>
                  <th className="text-right px-2 py-1.5">max DD</th>
                  <th className="text-right px-2 py-1.5">fitness</th>
                  <th className="text-left px-2 py-1.5">seeded agent</th>
                  <th className="text-left px-2 py-1.5">genome (params)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {candidates.map((c) => {
                  const params = safeParseParams(c.genome_json);
                  return (
                    <tr key={c.id} className={c.rank === 1 ? "bg-accent-green/5" : "hover:bg-zinc-900/40"}>
                      <td className="px-2 py-1.5 tabular-nums text-zinc-500">#{c.rank}</td>
                      <td className={"px-2 py-1.5 text-right tabular-nums " + (c.pnl_usd >= 0 ? "text-accent-green" : "text-accent-red")}>
                        {(c.pnl_usd >= 0 ? "+$" : "−$") + Math.abs(c.pnl_usd).toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{(c.pnl_pct * 100).toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{c.trades_count}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                        {c.trades_count > 0 ? `${((c.wins_count / c.trades_count) * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{(c.max_dd_pct * 100).toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{c.fitness.toFixed(3)}</td>
                      <td className="px-2 py-1.5">
                        {c.paper_agent_id != null ? (
                          <Link href={`/arena/agents/${c.paper_agent_id}/train`} className="text-accent-blue hover:underline">
                            #{c.paper_agent_id}
                          </Link>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-[10px] text-zinc-500 font-mono max-w-md truncate" title={params}>
                        {params}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function safeParseParams(genomeJson: string): string {
  try {
    const g = JSON.parse(genomeJson);
    const params = g.params ?? {};
    const entries = Object.entries(params)
      .filter(([k]) => k !== "subs")
      .map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(3) : String(v)}`)
      .join(" ");
    return entries.slice(0, 200);
  } catch {
    return "(parse error)";
  }
}

function statusAccent(s: string): "green" | "red" | undefined {
  if (s === "done") return "green";
  if (s === "failed") return "red";
  return undefined;
}

function prettyDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

function Stat({
  label, value, accent,
}: { label: string; value: string; accent?: "green" | "red" }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={"text-base tabular-nums " + (accent === "green" ? "text-accent-green" : accent === "red" ? "text-accent-red" : "text-zinc-200")}>
        {value}
      </div>
    </div>
  );
}
