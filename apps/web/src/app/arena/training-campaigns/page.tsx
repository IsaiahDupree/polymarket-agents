/**
 * /arena/training-campaigns — list of all training campaigns + create form.
 *
 * Server-rendered list of campaigns by id DESC. The create form is a client
 * component (CampaignCreateForm) that POSTs to /api/arena/training-campaigns
 * and redirects to the detail page on success.
 */
import Link from "next/link";
import { listCampaigns } from "@/lib/arena/campaigns";
import { CampaignCreateForm } from "@/components/CampaignCreateForm";

export const dynamic = "force-dynamic";

export default async function TrainingCampaignsPage() {
  const campaigns = listCampaigns(50);
  return (
    <main className="p-6 max-w-6xl mx-auto text-zinc-200 space-y-6">
      <div>
        <div className="flex items-baseline gap-3">
          <Link href="/arena/high-pnl-agents" className="text-zinc-500 hover:text-zinc-300 text-xs">← arena</Link>
          <h1 className="text-2xl font-semibold">Training Campaigns</h1>
        </div>
        <p className="text-zinc-500 text-sm mt-1">
          Produce many agent candidates at once. A campaign generates N variants of one strategy kind,
          backtests each over a historical window, and ranks results by PnL. Top-K winners optionally
          get seeded as paper_agents so they show up in the arena.
        </p>
      </div>

      <CampaignCreateForm />

      <section>
        <h2 className="text-sm font-medium text-zinc-300 mb-2">recent campaigns ({campaigns.length})</h2>
        {campaigns.length === 0 ? (
          <div className="text-xs text-zinc-500 italic">no campaigns yet — fill in the form above to start one.</div>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900/60 text-zinc-500">
                <tr>
                  <th className="text-left px-2 py-1.5">id</th>
                  <th className="text-left px-2 py-1.5">name</th>
                  <th className="text-left px-2 py-1.5">kind</th>
                  <th className="text-right px-2 py-1.5">variants</th>
                  <th className="text-left px-2 py-1.5">range</th>
                  <th className="text-right px-2 py-1.5">candidates</th>
                  <th className="text-right px-2 py-1.5">best PnL</th>
                  <th className="text-left px-2 py-1.5">status</th>
                  <th className="text-left px-2 py-1.5">created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-zinc-900/40">
                    <td className="px-2 py-1.5 tabular-nums text-zinc-500">
                      <Link href={`/arena/training-campaigns/${c.id}`} className="hover:text-accent-blue">#{c.id}</Link>
                    </td>
                    <td className="px-2 py-1.5">
                      <Link href={`/arena/training-campaigns/${c.id}`} className="hover:text-accent-blue">{c.name}</Link>
                    </td>
                    <td className="px-2 py-1.5 text-zinc-400">{c.kind}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{c.variants}</td>
                    <td className="px-2 py-1.5 text-zinc-500 tabular-nums">
                      {c.from_iso.slice(0, 10)} → {c.to_iso.slice(0, 10)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{c.candidates_produced}</td>
                    <td
                      className={
                        "px-2 py-1.5 text-right tabular-nums " +
                        ((c.best_pnl_usd ?? 0) >= 0 ? "text-accent-green" : "text-accent-red")
                      }
                    >
                      {c.best_pnl_usd != null ? `${(c.best_pnl_usd >= 0 ? "+$" : "−$") + Math.abs(c.best_pnl_usd).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          "px-1.5 py-0.5 rounded text-[10px] " +
                          (c.status === "done"
                            ? "bg-accent-green/15 text-accent-green border border-accent-green/40"
                            : c.status === "running" || c.status === "queued"
                            ? "bg-accent-amber/15 text-accent-amber border border-accent-amber/40"
                            : c.status === "failed"
                            ? "bg-accent-red/15 text-accent-red border border-accent-red/40"
                            : "bg-zinc-700 text-zinc-300")
                        }
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{prettyAgo(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function prettyAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
