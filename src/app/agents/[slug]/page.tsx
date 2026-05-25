import Link from "next/link";
import { notFound } from "next/navigation";
import { currentVersion, getAgentBySlug, listStrategiesForAgent, listVersions } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function AgentDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = getAgentBySlug(slug);
  if (!agent) notFound();
  const strategies = listStrategiesForAgent(agent.id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/agents" className="text-xs text-zinc-500 hover:text-zinc-300">← all agents</Link>
        <h1 className="text-2xl font-semibold mt-1">{agent.name}</h1>
        <p className="text-zinc-400 text-sm mt-1 max-w-3xl">{agent.charter}</p>
        <div className="flex gap-4 text-xs text-zinc-500 mt-2">
          <span>slug: <span className="text-zinc-300">{agent.slug}</span></span>
          <span>risk budget: <span className="text-zinc-300">${agent.risk_budget_usd.toLocaleString()}</span></span>
          <span>status: <span className={agent.status === "active" ? "text-accent-green" : "text-accent-amber"}>{agent.status}</span></span>
        </div>
      </div>

      <section>
        <h2 className="card-title">Strategies</h2>
        <div className="space-y-4">
          {strategies.map((s) => {
            const cur = currentVersion(s.id);
            const allVersions = listVersions(s.id);
            const filter = JSON.parse(s.market_filter);
            const spec = cur ? JSON.parse(cur.spec_json) : null;
            return (
              <div key={s.id} className="card">
                <div className="flex items-baseline justify-between mb-1">
                  <Link href={`/strategies/${agent.slug}/${s.slug}`} className="text-lg font-medium hover:text-accent-blue">{s.name}</Link>
                  <span className="text-xs text-zinc-500">v{cur?.version ?? "?"} of {allVersions.length}</span>
                </div>
                <p className="text-sm text-zinc-300">{s.thesis}</p>
                <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="card-title mb-1">Market filter</div>
                    <pre className="bg-ink-950 rounded p-2 overflow-x-auto text-zinc-300">{JSON.stringify(filter, null, 2)}</pre>
                  </div>
                  <div>
                    <div className="card-title mb-1">Current spec</div>
                    <pre className="bg-ink-950 rounded p-2 overflow-x-auto text-zinc-300">{spec ? JSON.stringify(spec, null, 2) : "(no version)"}</pre>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
