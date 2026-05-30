/**
 * /arena/training-campaigns/[id] — campaign detail.
 *
 * Server-renders the initial snapshot; client component polls every 3s until
 * status='done' to update progress + ranked candidates table live.
 */
import Link from "next/link";
import { getCampaign, listCandidatesForCampaign } from "@/lib/arena/campaigns";
import { CampaignDetail } from "@/components/CampaignDetail";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaignId = Number(id);
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    return (
      <main className="p-6 max-w-5xl mx-auto text-zinc-200">
        <h1 className="text-xl">Campaign #{campaignId} not found</h1>
        <Link href="/arena/training-campaigns" className="text-accent-blue text-sm">← campaigns</Link>
      </main>
    );
  }
  const candidates = listCandidatesForCampaign(campaignId, 100);
  return (
    <main className="p-6 max-w-6xl mx-auto text-zinc-200 space-y-6">
      <div>
        <div className="flex items-baseline gap-3">
          <Link href="/arena/training-campaigns" className="text-zinc-500 hover:text-zinc-300 text-xs">← campaigns</Link>
          <h1 className="text-2xl font-semibold">
            #{campaign.id} <span className="text-accent-amber">{campaign.name}</span>
          </h1>
        </div>
        <div className="text-zinc-500 text-sm mt-1">
          {campaign.kind} · {campaign.asset_filter ?? "any asset"} · {campaign.from_iso.slice(0, 10)} → {campaign.to_iso.slice(0, 10)} · {campaign.variants} variants
        </div>
      </div>
      <CampaignDetail
        initialCampaign={campaign}
        initialCandidates={candidates}
      />
    </main>
  );
}
