/**
 * GET /api/arena/training-campaigns/[id]
 *   → returns the campaign row + top 100 candidates ranked by PnL.
 *
 * Used by the campaign-detail UI to poll progress while the worker runs.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCampaign, listCandidatesForCampaign } from "@/lib/arena/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteCtx): Promise<NextResponse> {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid campaign id" }, { status: 400 });
  }
  const campaign = getCampaign(campaignId);
  if (!campaign) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const candidates = listCandidatesForCampaign(campaignId, 100);
  return NextResponse.json({ ok: true, campaign, candidates });
}
