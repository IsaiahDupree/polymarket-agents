/**
 * POST /api/arena/training-campaigns
 *   body: { name, kind, asset, from, to, variants, perPct?, baseAgentId?, charter?, topKToSeed? }
 *   → returns { id } immediately. Fires runCampaign() in a non-awaited promise.
 *
 * GET /api/arena/training-campaigns
 *   → returns the 50 most-recent campaigns + their status.
 *
 * Campaign worker runs inside the dev server process. For long campaigns
 * (>10 variants × multi-day windows) the request returns quickly but the
 * worker keeps running; the operator polls via the campaign detail endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { createCampaign, listCampaigns, runCampaign } from "@/lib/arena/campaigns";
import { GENOME_KINDS, type GenomeKind } from "@/lib/arena/genome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const campaigns = listCampaigns(50);
  return NextResponse.json({ ok: true, campaigns });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    kind?: string;
    asset?: string;
    from?: string;
    to?: string;
    variants?: number;
    perPct?: number;
    baseAgentId?: number;
    charter?: string;
    topKToSeed?: number;
    autoSeed?: boolean;
  };

  // Validation
  const errors: string[] = [];
  if (!body.name || body.name.length < 3) errors.push("name required (min 3 chars)");
  if (!body.kind || !GENOME_KINDS.includes(body.kind as GenomeKind)) {
    errors.push(`kind must be one of: ${GENOME_KINDS.join(", ")}`);
  }
  if (!body.from || !Number.isFinite(Date.parse(body.from))) errors.push("from must be ISO timestamp");
  if (!body.to || !Number.isFinite(Date.parse(body.to))) errors.push("to must be ISO timestamp");
  if (body.from && body.to && Date.parse(body.to) <= Date.parse(body.from)) errors.push("to must be > from");
  const variants = Number(body.variants ?? 50);
  if (!Number.isFinite(variants) || variants < 1 || variants > 1000) errors.push("variants must be 1..1000");
  if (errors.length) {
    return NextResponse.json({ ok: false, errors }, { status: 400 });
  }

  const topKToSeed = body.autoSeed ? 5 : Number(body.topKToSeed ?? 0);

  let id: number;
  try {
    id = createCampaign({
      name: body.name!,
      kind: body.kind! as GenomeKind,
      assetFilter: body.asset,
      fromIso: body.from!,
      toIso: body.to!,
      variants,
      perPct: body.perPct,
      baseAgentId: body.baseAgentId,
      charter: body.charter,
      topKToSeed,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }

  // Fire-and-forget the worker. The HTTP response returns immediately.
  // Errors inside runCampaign get persisted to the campaign row's status='failed'
  // + error column, so polling clients see them.
  setImmediate(() => {
    try {
      runCampaign(id, topKToSeed);
    } catch (err) {
      console.error(`[campaign ${id}] worker crashed: ${(err as Error).message}`);
    }
  });

  return NextResponse.json({ ok: true, id, status: "queued" });
}
