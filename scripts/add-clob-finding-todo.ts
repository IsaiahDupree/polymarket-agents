/**
 * One-shot: pin the CLOB-signature-access finding as a todo on
 * article #1 (0x_Discover). Idempotent.
 */
import "./_env.ts";
import { getArticleByTitle, addTodo, listTodos } from "../src/lib/articles/queries.ts";

const article = getArticleByTitle("The Exact Math That Pulled $40,000,000 from Polymarket (Full Roadmap)");
if (!article) {
  console.error("[add-clob-finding-todo] article not found");
  process.exit(1);
}
const existing = listTodos(article.id);
const dupe = existing.find((t) => t.related_path === "docs/research/clob-signature-access-finding.md");
if (dupe) {
  console.log(`[add-clob-finding-todo] todo already exists: id=${dupe.id} (${dupe.status})`);
  process.exit(0);
}
const id = addTodo({
  article_id: article.id,
  label: "READ: CLOB signature-access finding — Path A contract works for self-maker arbs only, NOT taker raids",
  related_path: "docs/research/clob-signature-access-finding.md",
});
console.log(`[add-clob-finding-todo] added todo id=${id} on article ${article.id}`);
