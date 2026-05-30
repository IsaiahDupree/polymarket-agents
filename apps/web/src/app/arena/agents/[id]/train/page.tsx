/**
 * /arena/agents/[id]/train — per-agent training console.
 *
 * Server component: loads the agent + last 20 training_runs from DB.
 * Client component handles the form (date-range presets + mode select)
 * + result rendering with a spinner during the synchronous POST.
 *
 * Phase 1 of the High-PnL Agent Factory PRD.
 */
import Link from "next/link";
import { db } from "@/lib/db/client";
import { parseGenome, genomeNickname } from "@/lib/arena/genome";
import { listTrainingRunsForAgent } from "@/lib/arena/training";
import { TrainPanel } from "@/components/TrainPanel";

export const dynamic = "force-dynamic";

type AgentRow = {
  id: number;
  name: string;
  generation: number;
  is_elite: 0 | 1;
  alive: 0 | 1;
  genome_json: string;
  cash_usd_current: number;
  cash_usd_start: number;
  realized_pnl_usd: number;
  unrealized_pnl_usd: number;
  trades_count: number;
  wins_count: number;
  introduced_by: string;
};

export default async function AgentTrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);

  const agent = db()
    .prepare(
      `SELECT id, name, generation, is_elite, alive, genome_json,
              cash_usd_current, cash_usd_start, realized_pnl_usd, unrealized_pnl_usd,
              trades_count, wins_count, introduced_by
         FROM paper_agents WHERE id = ?`,
    )
    .get(agentId) as AgentRow | undefined;

  if (!agent) {
    return (
      <main className="p-6 max-w-5xl mx-auto text-zinc-200">
        <h1 className="text-xl">Agent #{agentId} not found</h1>
        <Link href="/arena/high-pnl-agents" className="text-accent-blue text-sm">← back to arena</Link>
      </main>
    );
  }

  const genome = parseGenome(agent.genome_json);
  const nickname = genomeNickname(genome);
  const lifetimePnl = agent.cash_usd_current + agent.unrealized_pnl_usd - agent.cash_usd_start;
  const runs = listTrainingRunsForAgent(agentId, 20);

  return (
    <main className="p-6 max-w-6xl mx-auto text-zinc-200 space-y-6">
      <div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <Link href="/arena/high-pnl-agents" className="text-zinc-500 hover:text-zinc-300 text-xs">
            ← arena
          </Link>
          <h1 className="text-2xl font-semibold">
            #{agent.id} <span className="text-accent-amber">{agent.name}</span>
          </h1>
          {agent.is_elite === 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/15 text-accent-amber border border-accent-amber/40">
              ELITE
            </span>
          )}
          {agent.alive === 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
              DEAD
            </span>
          )}
        </div>
        <div className="text-zinc-500 text-sm mt-1">
          gen {agent.generation} · {nickname} · {agent.introduced_by ?? "evolved"}
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Stat label="lifetime PnL" value={fmtUsd(lifetimePnl)} accent={lifetimePnl >= 0 ? "green" : "red"} />
        <Stat label="cash" value={fmtUsd(agent.cash_usd_current)} />
        <Stat label="trades" value={String(agent.trades_count)} />
        <Stat
          label="win rate"
          value={agent.trades_count > 0 ? `${((agent.wins_count / agent.trades_count) * 100).toFixed(0)}%` : "—"}
        />
        <Stat label="strategy" value={String(genome.kind).replace(/_/g, " ")} />
      </div>

      {/* Training panel (client component — handles POST + spinner + results) */}
      <TrainPanel
        agentId={agent.id}
        initialRuns={runs.map((r) => ({
          id: r.id,
          mode: r.mode,
          from_iso: r.from_iso,
          to_iso: r.to_iso,
          status: r.status,
          pnl_usd: r.pnl_usd,
          trades_count: r.trades_count,
          wins_count: r.wins_count,
          max_dd_pct: r.max_dd_pct,
          fitness: r.fitness,
          error: r.error,
          started_at: r.started_at,
          ended_at: r.ended_at,
        }))}
      />
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: "green" | "red" }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={
          "text-base tabular-nums " +
          (accent === "green" ? "text-accent-green" : accent === "red" ? "text-accent-red" : "text-zinc-200")
        }
      >
        {value}
      </div>
    </div>
  );
}

function fmtUsd(n: number): string {
  return `${n < 0 ? "−$" : "$"}${Math.abs(n).toFixed(2)}`;
}
