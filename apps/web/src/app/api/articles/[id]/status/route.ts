import { NextResponse } from "next/server";
import { z } from "zod";
import { setArticleStatus, setCurrentFocus, getArticle } from "@/lib/articles/queries";

const schema = z.object({
  status: z.enum(["new", "triaging", "developing", "shipped", "parked"]).optional(),
  is_current_focus: z.boolean().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!getArticle(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { status, is_current_focus } = parsed.data;

  if (status) setArticleStatus(id, status);
  if (is_current_focus === true) setCurrentFocus(id);
  if (is_current_focus === false) setCurrentFocus(null);

  return NextResponse.json({ ok: true });
}
