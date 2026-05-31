/**
 * Walk every article in incoming_articles without a gap report (or all
 * articles if --force) and call the LLM gap-report generator. Auto-seeds
 * todos from each report's suggested_next_steps when the article has no
 * todos yet.
 *
 *   npm run gen:article-gaps             # only articles missing reports
 *   npm run gen:article-gaps -- --force  # regenerate everything (replaces old)
 *   npm run gen:article-gaps -- --id 3   # one specific article
 *   npm run gen:article-gaps -- --dry-run
 *
 * Uses Claude OAuth (~/.claude/.credentials.json). Falls back to
 * ANTHROPIC_API_KEY env var. Exits non-zero if no auth available.
 */
import "./_env.ts";
import {
  listArticles,
  getArticle,
  getLatestGapReport,
  saveGapReport,
  addTodo,
  listTodos,
} from "../src/lib/articles/queries.ts";
import {
  generateGapReport,
  gapReportLlmAvailable,
} from "../src/lib/articles/gap-report-llm.ts";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const dryRun = argv.includes("--dry-run");
const idArg = (() => {
  const i = argv.indexOf("--id");
  if (i === -1) return null;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : null;
})();

if (!gapReportLlmAvailable()) {
  console.error("[gen-article-gaps] Anthropic auth unavailable.");
  console.error("  Run `claude` to log in, or set ANTHROPIC_API_KEY.");
  process.exit(2);
}

const all = listArticles();
const targets = idArg != null
  ? all.filter((a) => a.id === idArg)
  : all.filter((a) => force || !a.has_gap_report);

if (targets.length === 0) {
  console.log("[gen-article-gaps] nothing to do — all articles already have gap reports.");
  console.log("                  pass --force to regenerate everything.");
  process.exit(0);
}

console.log(`[gen-article-gaps] processing ${targets.length} article(s)${dryRun ? " (DRY RUN)" : ""}`);

let generated = 0;
let todoSeed = 0;
let failed = 0;
const startedAt = Date.now();

for (const row of targets) {
  const article = getArticle(row.id);
  if (!article) continue;
  process.stdout.write(`  [${article.id}] ${article.title.slice(0, 60)}… `);

  if (dryRun) {
    console.log("DRY");
    continue;
  }

  try {
    const result = await generateGapReport({ title: article.title, body_md: article.body_md });
    if (!result) {
      console.log("FAIL (LLM returned null)");
      failed++;
      continue;
    }
    saveGapReport({
      article_id: article.id,
      body_md: result.markdown,
      report_json: result.json as unknown as Record<string, unknown>,
      model: result.model,
      source: "llm",
    });
    generated++;
    const existing = listTodos(article.id);
    if (existing.length === 0) {
      for (const step of result.json.suggested_next_steps) {
        addTodo({ article_id: article.id, label: step.label, related_path: step.related_path });
        todoSeed++;
      }
    }
    console.log(`OK (${result.json.suggested_next_steps.length} steps, ${existing.length === 0 ? "todos seeded" : "todos kept"})`);
  } catch (err) {
    console.log(`FAIL (${(err as Error).message})`);
    failed++;
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n[gen-article-gaps] done in ${elapsed}s — generated: ${generated}, todos seeded: ${todoSeed}, failed: ${failed}`);
if (failed > 0) process.exit(1);
