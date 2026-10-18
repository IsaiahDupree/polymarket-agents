/**
 * One-shot: pin the 15-bot reconciliation report as a todo on article #1.
 * Idempotent.
 */
import "./_env.ts";
import { getArticleByTitle, addTodo, listTodos } from "../src/lib/articles/queries.ts";

const article = getArticleByTitle("The Exact Math That Pulled $40,000,000 from Polymarket (Full Roadmap)");
if (!article) {
  console.error("[add-reconciliation-todo] article not found");
  process.exit(1);
}
const existing = listTodos(article.id);
const dupe = existing.find((t) => t.related_path === "docs/research/0x-discover-reconciliation.md");
if (dupe) {
  console.log(`[add-reconciliation-todo] todo already exists: id=${dupe.id} (${dupe.status})`);
  process.exit(0);
}
const id = addTodo({
  article_id: article.id,
  label: "READ: 15-bot reconciliation report — 5 supported, 7 understated (grew since article), 2 inflated incl. blindStaking now at −$2.77M",
  related_path: "docs/research/0x-discover-reconciliation.md",
});
console.log(`[add-reconciliation-todo] added todo id=${id} on article ${article.id}`);
