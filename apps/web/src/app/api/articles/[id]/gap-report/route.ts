import { NextResponse } from "next/server";
import { getArticle, saveGapReport, addTodo, listTodos } from "@/lib/articles/queries";
import { generateGapReport, gapReportLlmAvailable } from "@/lib/articles/gap-report-llm";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const article = getArticle(id);
  if (!article) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!gapReportLlmAvailable()) {
    return NextResponse.json(
      { error: "Anthropic auth unavailable. Run `claude` to log in or set ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  const result = await generateGapReport({ title: article.title, body_md: article.body_md });
  if (!result) {
    return NextResponse.json({ error: "LLM call failed (see server logs)" }, { status: 502 });
  }

  const reportId = saveGapReport({
    article_id: id,
    body_md: result.markdown,
    report_json: result.json as unknown as Record<string, unknown>,
    model: result.model,
    source: "llm",
  });

  // Seed todos from the suggested_next_steps — but only if there aren't already
  // todos on this article (so re-generating a report doesn't duplicate them).
  const existingTodos = listTodos(id);
  let seededTodos = 0;
  if (existingTodos.length === 0) {
    for (const step of result.json.suggested_next_steps) {
      addTodo({ article_id: id, label: step.label, related_path: step.related_path });
      seededTodos++;
    }
  }

  return NextResponse.json({ report_id: reportId, seeded_todos: seededTodos });
}
