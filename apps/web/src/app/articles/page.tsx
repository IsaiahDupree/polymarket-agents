/**
 * /articles — twitter/X article triage workbench.
 *
 * One row per pasted-in article. Click into a row to read it, generate a
 * gap report against the codebase, and tick off the suggested next steps.
 * Only one article is "current focus" at a time — that surfaces on the
 * homepage and /settings so the operator never loses the thread.
 */
import Link from "next/link";
import { listArticles } from "@/lib/articles/queries";
import { ArticlePasteForm } from "./_paste-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS_COLORS: Record<string, string> = {
  new: "bg-zinc-700 text-zinc-200",
  triaging: "bg-amber-700/40 text-amber-200",
  developing: "bg-blue-700/40 text-blue-200",
  shipped: "bg-emerald-700/40 text-emerald-200",
  parked: "bg-zinc-800 text-zinc-500",
};

export default function ArticlesPage() {
  const rows = listArticles();
  const focus = rows.find((r) => r.is_current_focus === 1);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Article triage</h1>
        <p className="text-xs text-zinc-500">
          Paste a twitter/X thread → get a gap report against the codebase → develop one at a time.
        </p>
      </div>

      {focus && (
        <div className="card border-accent-blue/50">
          <div className="text-[10px] uppercase tracking-wide text-accent-blue mb-1">Current focus</div>
          <Link href={`/articles/${focus.id}`} className="text-lg font-medium hover:text-accent-blue">
            {focus.title}
          </Link>
          <div className="text-xs text-zinc-500 mt-1">
            {focus.source} • {focus.status} • {focus.todo_done}/{focus.todo_open + focus.todo_done} todos done
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="text-sm font-medium mb-3">Paste a new article</h2>
        <ArticlePasteForm />
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <p className="text-zinc-400 text-sm">No articles yet. Paste one above to get started.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => {
            const statusClass = STATUS_COLORS[a.status] ?? STATUS_COLORS.new;
            return (
              <li key={a.id} className="card hover:border-zinc-600 transition-colors">
                <Link href={`/articles/${a.id}`} className="block">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {a.is_current_focus === 1 && (
                          <span className="text-[10px] text-accent-blue">★ focus</span>
                        )}
                        <span className="font-medium truncate">{a.title}</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-1 truncate">{a.source}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                      {a.has_gap_report === 1 && <span className="text-zinc-500">gap report ✓</span>}
                      {a.todo_open + a.todo_done > 0 && (
                        <span className="text-zinc-400">
                          {a.todo_done}/{a.todo_open + a.todo_done} todos
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded ${statusClass}`}>{a.status}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
