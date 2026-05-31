/**
 * /articles/[id] — single article workbench.
 *
 *   Body  +  gap report (LLM-on-demand)  +  todos  +  status/focus controls
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getArticle,
  getLatestGapReport,
  listTodos,
  listScaffoldedFromArticle,
} from "@/lib/articles/queries";
import { gapReportLlmAvailable } from "@/lib/articles/gap-report-llm";
import { ArticleActions } from "./_actions";
import { TodoList } from "./_todo-list";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isInternalPath(p: string | null): p is string {
  return !!p && (p.startsWith("/") || p.startsWith("src/") || p.startsWith("apps/") || p.startsWith("scripts/") || p.startsWith("packages/"));
}

function asLink(p: string | null): { kind: "internal"; href: string } | { kind: "code"; path: string } | null {
  if (!p) return null;
  if (p.startsWith("/")) return { kind: "internal", href: p };
  if (isInternalPath(p)) return { kind: "code", path: p };
  return null;
}

export default async function ArticleDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) notFound();

  const article = getArticle(id);
  if (!article) notFound();

  const gap = getLatestGapReport(id);
  const todos = listTodos(id);
  const scaffolded = listScaffoldedFromArticle(id);
  const llmAvailable = gapReportLlmAvailable();
  const fm: Record<string, unknown> = (() => {
    try {
      return JSON.parse(article.frontmatter_json);
    } catch {
      return {};
    }
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/articles" className="text-xs text-zinc-500 hover:text-zinc-300">
            ← all articles
          </Link>
          <h1 className="text-2xl font-semibold mt-1 truncate">{article.title}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {article.source}
            {article.url && (
              <>
                {" · "}
                <a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent-blue">
                  source
                </a>
              </>
            )}
            {" · "}saved {article.created_at?.slice(0, 16)}
          </p>
        </div>
        <ArticleActions
          articleId={article.id}
          status={article.status}
          isCurrentFocus={article.is_current_focus === 1}
          hasGapReport={!!gap}
          llmAvailable={llmAvailable}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-400">Article body</h2>
          <div className="card max-h-[70vh] overflow-y-auto">
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">{article.body_md}</pre>
          </div>
          {Object.keys(fm).length > 0 && (
            <details className="card text-xs">
              <summary className="text-zinc-400 cursor-pointer">Frontmatter</summary>
              <pre className="mt-2 text-zinc-500 whitespace-pre-wrap">{JSON.stringify(fm, null, 2)}</pre>
            </details>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-400">Gap report</h2>
          {gap ? (
            <div className="card">
              <div className="text-[10px] text-zinc-500 mb-2">
                {gap.source} • {gap.model} • {gap.generated_at.slice(0, 16)}
              </div>
              <div className="prose prose-invert text-sm max-w-none">
                <GapReportRenderer markdown={gap.body_md} />
              </div>
            </div>
          ) : llmAvailable ? (
            <div className="card text-sm text-zinc-400">
              No gap report yet. Click <span className="text-zinc-200">Generate gap report</span> above to call the LLM.
            </div>
          ) : (
            <div className="card text-sm text-amber-300">
              Anthropic auth unavailable. Run <code className="text-zinc-200">claude</code> in this repo to log in, then refresh.
            </div>
          )}

          <h2 className="text-sm font-medium text-zinc-400 mt-6">Todos</h2>
          <div className="card">
            <TodoList articleId={article.id} initial={todos} />
          </div>

          <h2 className="text-sm font-medium text-zinc-400 mt-6">Scaffolded from this article</h2>
          <div className="card">
            {scaffolded.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Nothing built from this article yet. When a strategy or quant module is wired up, it shows here with a link.
                Use <code className="text-emerald-300">linkStrategyToArticle()</code> in the seed script, or call
                <code className="text-emerald-300"> POST /api/articles/{article.id}/link</code>.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {scaffolded.map((s, i) => {
                  const href =
                    s.strategy_slug && s.agent_slug
                      ? `/strategies/${s.agent_slug}/${s.strategy_slug}`
                      : null;
                  const label =
                    s.strategy_name && s.agent_name
                      ? `${s.agent_name} · ${s.strategy_name}`
                      : s.module_path ?? "(unlinked)";
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded shrink-0 ${
                        s.role === "primary"
                          ? "bg-accent-blue/30 text-accent-blue"
                          : s.role === "calibration"
                            ? "bg-emerald-700/40 text-emerald-200"
                            : s.role === "execution"
                              ? "bg-amber-700/40 text-amber-200"
                              : "bg-zinc-700 text-zinc-200"
                      }`}>
                        {s.role}
                      </span>
                      <div className="min-w-0 flex-1">
                        {href ? (
                          <Link href={href} className="text-zinc-200 hover:text-accent-blue">{label}</Link>
                        ) : (
                          <span className="text-zinc-200">{label}</span>
                        )}
                        {s.module_path && s.strategy_slug && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            <code className="text-emerald-300/80">{s.module_path}</code>
                          </div>
                        )}
                        {!s.strategy_slug && s.module_path && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">
                            <code className="text-emerald-300/80">{s.module_path}</code>
                          </div>
                        )}
                        {s.notes && <div className="text-[11px] text-zinc-400 mt-0.5">{s.notes}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Minimal markdown renderer — the gap report is generated by us so we know
 * the shape: H2 headers + bulleted lists + numbered list. Anything fancier
 * would be the wrong dependency for a single page; if more articles show
 * up with richer reports, swap to react-markdown.
 */
function GapReportRenderer({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = (i: number) => {
    if (listBuf.length === 0) return;
    out.push(
      <ul key={`ul-${i}`} className="list-disc pl-5 my-2 space-y-1">
        {listBuf.map((b, j) => (
          <li key={j} dangerouslySetInnerHTML={{ __html: inlineFormat(b.replace(/^[-*]\s*/, "")) }} />
        ))}
      </ul>,
    );
    listBuf = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flushList(i);
      out.push(
        <h3 key={`h-${i}`} className="text-zinc-100 font-medium mt-3 mb-1">
          {line.slice(3)}
        </h3>,
      );
    } else if (/^[-*]\s/.test(line)) {
      listBuf.push(line);
    } else if (/^\d+\.\s/.test(line)) {
      flushList(i);
      out.push(
        <div
          key={`n-${i}`}
          className="my-1"
          dangerouslySetInnerHTML={{ __html: inlineFormat(line) }}
        />,
      );
    } else if (line.startsWith("   ")) {
      // Continuation of a numbered item
      out.push(
        <div
          key={`c-${i}`}
          className="text-zinc-400 text-xs pl-5 mb-2"
          dangerouslySetInnerHTML={{ __html: inlineFormat(line.trim()) }}
        />,
      );
    } else if (line.length === 0) {
      flushList(i);
    } else {
      flushList(i);
      out.push(
        <p key={`p-${i}`} className="my-1" dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />,
      );
    }
  });
  flushList(lines.length);
  return <>{out}</>;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function inlineFormat(s: string): string {
  // Order matters: escape first, then re-introduce safe markup.
  let out = escapeHtml(s);
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-zinc-100">$1</strong>');
  // `code` — and if the contents look like an internal path, hyperlink it.
  out = out.replace(/`([^`]+)`/g, (_, code: string) => {
    const trimmed = code.trim();
    if (trimmed.startsWith("/")) {
      return `<a href="${trimmed}" class="text-accent-blue hover:underline">${trimmed}</a>`;
    }
    return `<code class="text-emerald-300 bg-ink-800/60 px-1 rounded text-[11px]">${code}</code>`;
  });
  return out;
}
