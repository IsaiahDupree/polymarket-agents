/**
 * One-shot: pin the atomic-multicall plan as a todo on article #1.
 * Idempotent. Remove after first run.
 */
import "./_env.ts";
import { getArticleByTitle, addTodo, listTodos } from "../src/lib/articles/queries.ts";

const article = getArticleByTitle("The Exact Math That Pulled $40,000,000 from Polymarket (Full Roadmap)");
if (!article) {
  console.error("[add-atomic-plan-todo] article not found");
  process.exit(1);
}
const existing = listTodos(article.id);
const dupe = existing.find((t) => t.related_path === "docs/research/atomic-multicall-plan.md");
if (dupe) {
  console.log(`[add-atomic-plan-todo] todo already exists: id=${dupe.id} (${dupe.status})`);
  process.exit(0);
}
const id = addTodo({
  article_id: article.id,
  label: "REVIEW: atomic multicall path plan (Path A recommended; wait 2wk for rollback-frequency data first)",
  related_path: "docs/research/atomic-multicall-plan.md",
});
console.log(`[add-atomic-plan-todo] added todo id=${id} on article ${article.id}`);
