import Link from "next/link";
import { getCurrentFocus, listTodos } from "@/lib/articles/queries";

/**
 * Compact card showing the article currently flagged as "focus" + its open
 * todo count. Hides itself if nothing is in focus. Drop into the homepage
 * and /settings so the operator never loses the thread between sessions.
 */
export function ArticleFocusCard() {
  const focus = getCurrentFocus();
  if (!focus) return null;
  const todos = listTodos(focus.id);
  const open = todos.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const done = todos.filter((t) => t.status === "done").length;
  const nextTodo = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "open");

  return (
    <div className="card border-accent-blue/40">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide text-accent-blue mb-1">
            Article focus
          </div>
          <Link
            href={`/articles/${focus.id}`}
            className="text-base font-medium text-zinc-100 hover:text-accent-blue truncate block"
          >
            {focus.title}
          </Link>
          {nextTodo && (
            <div className="text-xs text-zinc-400 mt-1 truncate">
              Next: <span className="text-zinc-200">{nextTodo.label}</span>
            </div>
          )}
        </div>
        <div className="text-right shrink-0 text-xs text-zinc-500">
          <div>{focus.status}</div>
          <div className="text-zinc-400">
            {done}/{done + open} todos
          </div>
        </div>
      </div>
    </div>
  );
}
