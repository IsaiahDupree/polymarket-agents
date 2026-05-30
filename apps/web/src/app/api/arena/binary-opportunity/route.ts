/**
 * GET /api/arena/binary-opportunity?conditionId=...&suggestedSide=UP&question=...&upTokenId=...&downTokenId=...
 *
 * The LiveBinaryPanel stages capsules against a specific binary window.
 * stage-capsule expects an opportunity event id (from evolution_log) so it
 * can extract conditionId + event_type + side. This helper mints (or reuses,
 * if recent) a 'panel-binary-stage' opportunity row for the given binary,
 * returns its id. Read-only-ish: it inserts only when no recent row exists.
 *
 * Idempotency window: 5 minutes — repeated clicks within that span reuse the
 * existing row. This is GET so the panel can call it from `useEffect`
 * without auth headers (mutating routes need ARENA_API_TOKEN; this one
 * doesn't mutate trading state).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { insertEvolutionEvent } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const conditionId = url.searchParams.get("conditionId");
  const suggestedSide = url.searchParams.get("suggestedSide") ?? "";
  const question = url.searchParams.get("question") ?? "";
  const upTokenId = url.searchParams.get("upTokenId") ?? "";
  const downTokenId = url.searchParams.get("downTokenId") ?? null;
  if (!conditionId) {
    return NextResponse.json({ ok: false, error: "conditionId required" }, { status: 400 });
  }

  // Look for an existing row in the last 5 minutes for this binary.
  const existing = db().prepare(
    `SELECT id, payload_json FROM evolution_log
      WHERE event_type = 'panel-binary-stage'
        AND payload_json LIKE '%' || ? || '%'
        AND created_at >= datetime('now', '-5 minutes')
      ORDER BY id DESC
      LIMIT 1`,
  ).get(conditionId) as { id: number; payload_json: string } | undefined;

  if (existing) {
    return NextResponse.json({ ok: true, opportunity_id: existing.id, reused: true });
  }

  // Mint a new one.
  insertEvolutionEvent({
    event_type: "panel-binary-stage",
    summary: `Operator panel stage context for ${conditionId.slice(0, 10)}…`,
    payload_json: JSON.stringify({
      conditionId,
      marketKey: conditionId,
      marketTitle: question,
      side: suggestedSide || null,
      entryPrice: null,
      upTokenId,
      downTokenId,
      source: "live-binary-panel",
    }),
  });
  const inserted = db().prepare(
    `SELECT id FROM evolution_log WHERE event_type = 'panel-binary-stage' ORDER BY id DESC LIMIT 1`,
  ).get() as { id: number };
  return NextResponse.json({ ok: true, opportunity_id: inserted.id, reused: false });
}
