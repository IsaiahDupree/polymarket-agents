"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ArticleTodo, TodoStatus } from "@/lib/articles/queries";

const NEXT_STATUS: Record<TodoStatus, TodoStatus> = {
  open: "in_progress",
  in_progress: "done",
  done: "open",
  wont_do: "open",
};

const STATUS_PILL: Record<TodoStatus, string> = {
  open: "bg-zinc-700 text-zinc-200",
  in_progress: "bg-amber-700/40 text-amber-200",
  done: "bg-emerald-700/40 text-emerald-200",
  wont_do: "bg-zinc-800 text-zinc-500 line-through",
};

export function TodoList({ articleId, initial }: { articleId: number; initial: ArticleTodo[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [, startTransition] = useTransition();

  const refresh = async () => {
    const res = await fetch(`/api/articles/${articleId}/todos`);
    if (res.ok) setItems((await res.json()) as ArticleTodo[]);
    startTransition(() => router.refresh());
  };

  const add = async () => {
    if (!label.trim()) return;
    await fetch(`/api/articles/${articleId}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: label.trim(), related_path: path.trim() || null }),
    });
    setLabel("");
    setPath("");
    await refresh();
  };

  const cycleStatus = async (todo: ArticleTodo) => {
    const next = NEXT_STATUS[todo.status];
    await fetch(`/api/articles/${articleId}/todos`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ todo_id: todo.id, status: next }),
    });
    await refresh();
  };

  const setWontDo = async (todo: ArticleTodo) => {
    await fetch(`/api/articles/${articleId}/todos`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ todo_id: todo.id, status: "wont_do" }),
    });
    await refresh();
  };

  const remove = async (todo: ArticleTodo) => {
    await fetch(`/api/articles/${articleId}/todos`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ todo_id: todo.id, delete: true }),
    });
    await refresh();
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-xs text-zinc-500">No todos yet. Generate the gap report to seed some, or add one below.</p>
      )}
      <ul className="space-y-1">
        {items.map((t) => {
          const isInternal = t.related_path?.startsWith("/");
          return (
            <li key={t.id} className="flex items-start gap-2 text-sm">
              <button
                type="button"
                onClick={() => cycleStatus(t)}
                className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${STATUS_PILL[t.status]}`}
                title="Click to cycle status"
              >
                {t.status}
              </button>
              <div className="flex-1 min-w-0">
                <div className={t.status === "done" || t.status === "wont_do" ? "text-zinc-500" : "text-zinc-200"}>
                  {t.label}
                </div>
                {t.related_path && (
                  <div className="text-[11px] text-zinc-500 mt-0.5">
                    {isInternal ? (
                      <a href={t.related_path} className="hover:text-accent-blue">
                        {t.related_path}
                      </a>
                    ) : (
                      <code className="text-emerald-300/80">{t.related_path}</code>
                    )}
                  </div>
                )}
              </div>
              {t.status !== "wont_do" && (
                <button
                  type="button"
                  onClick={() => setWontDo(t)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 shrink-0"
                  title="Won't do"
                >
                  skip
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(t)}
                className="text-[10px] text-zinc-600 hover:text-rose-400 shrink-0"
                title="Delete"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-ink-700 pt-2 mt-2 grid grid-cols-[1fr_auto] gap-2">
        <input
          className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-xs"
          placeholder="New todo label…"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          type="button"
          onClick={add}
          className="px-2 py-1 text-xs bg-accent-blue/20 hover:bg-accent-blue/30 border border-accent-blue/40 rounded"
        >
          add
        </button>
        <input
          className="col-span-2 bg-ink-900 border border-ink-700 rounded px-2 py-1 text-xs"
          placeholder="Related path (optional, e.g. /arb or src/lib/strategies/foo.ts)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>
    </div>
  );
}
