import { NextResponse } from "next/server";
import { z } from "zod";
import { addTodo, getArticle, listTodos, setTodoStatus, deleteTodo } from "@/lib/articles/queries";

const addSchema = z.object({
  label: z.string().min(1),
  related_path: z.string().optional().nullable(),
});

const updateSchema = z.object({
  todo_id: z.number().int(),
  status: z.enum(["open", "in_progress", "done", "wont_do"]).optional(),
  delete: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  return NextResponse.json(listTodos(id));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!getArticle(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = addSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const todoId = addTodo({ article_id: id, label: parsed.data.label, related_path: parsed.data.related_path ?? null });
  return NextResponse.json({ id: todoId });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.delete) {
    deleteTodo(parsed.data.todo_id);
  } else if (parsed.data.status) {
    setTodoStatus(parsed.data.todo_id, parsed.data.status);
  }
  return NextResponse.json({ ok: true });
}
