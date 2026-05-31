import { db } from "../db/client";

export type ArticleStatus = "new" | "triaging" | "developing" | "shipped" | "parked";
export type TodoStatus = "open" | "in_progress" | "done" | "wont_do";

export type IncomingArticle = {
  id: number;
  source: string;
  url: string | null;
  title: string;
  body_md: string;
  frontmatter_json: string;
  status: ArticleStatus;
  is_current_focus: 0 | 1;
  created_at: string;
  updated_at: string;
};

export type ArticleGapReport = {
  id: number;
  article_id: number;
  body_md: string;
  report_json: string;
  model: string;
  source: "llm" | "human" | "seed";
  generated_at: string;
};

export type ArticleTodo = {
  id: number;
  article_id: number;
  label: string;
  related_path: string | null;
  status: TodoStatus;
  created_at: string;
  completed_at: string | null;
};

export type ArticleListRow = IncomingArticle & {
  todo_open: number;
  todo_done: number;
  has_gap_report: 0 | 1;
};

export function listArticles(): ArticleListRow[] {
  return db()
    .prepare(
      `SELECT a.*,
              COALESCE(SUM(CASE WHEN t.status IN ('open','in_progress') THEN 1 ELSE 0 END), 0) AS todo_open,
              COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS todo_done,
              CASE WHEN EXISTS (SELECT 1 FROM article_gap_reports g WHERE g.article_id = a.id) THEN 1 ELSE 0 END AS has_gap_report
         FROM incoming_articles a
         LEFT JOIN article_todos t ON t.article_id = a.id
         GROUP BY a.id
         ORDER BY a.is_current_focus DESC, a.updated_at DESC`,
    )
    .all() as ArticleListRow[];
}

export function getArticle(id: number): IncomingArticle | undefined {
  return db().prepare("SELECT * FROM incoming_articles WHERE id = ?").get(id) as IncomingArticle | undefined;
}

export function getArticleByTitle(title: string): IncomingArticle | undefined {
  return db().prepare("SELECT * FROM incoming_articles WHERE title = ?").get(title) as IncomingArticle | undefined;
}

export function getCurrentFocus(): IncomingArticle | undefined {
  return db()
    .prepare("SELECT * FROM incoming_articles WHERE is_current_focus = 1 LIMIT 1")
    .get() as IncomingArticle | undefined;
}

export function createArticle(input: {
  source: string;
  url?: string;
  title: string;
  body_md: string;
  frontmatter?: Record<string, unknown>;
}): number {
  const result = db()
    .prepare(
      `INSERT INTO incoming_articles (source, url, title, body_md, frontmatter_json)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.source,
      input.url ?? null,
      input.title,
      input.body_md,
      JSON.stringify(input.frontmatter ?? {}),
    );
  return Number(result.lastInsertRowid);
}

export function upsertArticleByTitle(input: {
  source: string;
  url?: string;
  title: string;
  body_md: string;
  frontmatter?: Record<string, unknown>;
}): number {
  const existing = db().prepare("SELECT id FROM incoming_articles WHERE title = ?").get(input.title) as { id: number } | undefined;
  if (existing) {
    db()
      .prepare(
        `UPDATE incoming_articles
           SET source = ?, url = ?, body_md = ?, frontmatter_json = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(input.source, input.url ?? null, input.body_md, JSON.stringify(input.frontmatter ?? {}), existing.id);
    return existing.id;
  }
  return createArticle(input);
}

export function setArticleStatus(id: number, status: ArticleStatus): void {
  db()
    .prepare(`UPDATE incoming_articles SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, id);
}

export function setCurrentFocus(id: number | null): void {
  const handle = db();
  const tx = handle.transaction((newId: number | null) => {
    handle.prepare(`UPDATE incoming_articles SET is_current_focus = 0 WHERE is_current_focus = 1`).run();
    if (newId !== null) {
      handle
        .prepare(`UPDATE incoming_articles SET is_current_focus = 1, updated_at = datetime('now') WHERE id = ?`)
        .run(newId);
    }
  });
  tx(id);
}

export function getLatestGapReport(articleId: number): ArticleGapReport | undefined {
  return db()
    .prepare(
      `SELECT * FROM article_gap_reports WHERE article_id = ? ORDER BY generated_at DESC, id DESC LIMIT 1`,
    )
    .get(articleId) as ArticleGapReport | undefined;
}

export function saveGapReport(input: {
  article_id: number;
  body_md: string;
  report_json: Record<string, unknown>;
  model: string;
  source: "llm" | "human" | "seed";
}): number {
  const result = db()
    .prepare(
      `INSERT INTO article_gap_reports (article_id, body_md, report_json, model, source)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.article_id, input.body_md, JSON.stringify(input.report_json), input.model, input.source);
  return Number(result.lastInsertRowid);
}

export function listTodos(articleId: number): ArticleTodo[] {
  return db()
    .prepare(
      `SELECT * FROM article_todos
        WHERE article_id = ?
        ORDER BY CASE status
                   WHEN 'in_progress' THEN 0
                   WHEN 'open'        THEN 1
                   WHEN 'done'        THEN 2
                   WHEN 'wont_do'     THEN 3
                 END, id ASC`,
    )
    .all(articleId) as ArticleTodo[];
}

export function addTodo(input: { article_id: number; label: string; related_path?: string | null }): number {
  const result = db()
    .prepare(
      `INSERT INTO article_todos (article_id, label, related_path) VALUES (?, ?, ?)`,
    )
    .run(input.article_id, input.label, input.related_path ?? null);
  return Number(result.lastInsertRowid);
}

export function setTodoStatus(id: number, status: TodoStatus): void {
  const completedAt = status === "done" ? new Date().toISOString() : null;
  db()
    .prepare(`UPDATE article_todos SET status = ?, completed_at = ? WHERE id = ?`)
    .run(status, completedAt, id);
}

export function deleteTodo(id: number): void {
  db().prepare(`DELETE FROM article_todos WHERE id = ?`).run(id);
}

// ───────────────────────────── strategy ↔ article links ─────────────────────────────

export type StrategyArticleRole = "primary" | "supporting" | "calibration" | "execution";

export type StrategyArticleLink = {
  strategy_id: number | null;
  module_path: string | null;
  article_id: number;
  role: StrategyArticleRole;
  notes: string | null;
  created_at: string;
};

export type ArticleScaffoldedStrategy = {
  strategy_id: number | null;
  module_path: string | null;
  role: StrategyArticleRole;
  notes: string | null;
  strategy_slug: string | null;
  strategy_name: string | null;
  agent_slug: string | null;
  agent_name: string | null;
};

export function linkStrategyToArticle(input: {
  strategy_id?: number | null;
  module_path?: string | null;
  article_id: number;
  role?: StrategyArticleRole;
  notes?: string;
}): void {
  if (input.strategy_id == null && !input.module_path) {
    throw new Error("linkStrategyToArticle: at least one of strategy_id or module_path is required");
  }
  db()
    .prepare(
      `INSERT OR IGNORE INTO strategy_article_sources
         (strategy_id, module_path, article_id, role, notes)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.strategy_id ?? null,
      input.module_path ?? null,
      input.article_id,
      input.role ?? "primary",
      input.notes ?? null,
    );
}

export function listScaffoldedFromArticle(articleId: number): ArticleScaffoldedStrategy[] {
  return db()
    .prepare(
      `SELECT sas.strategy_id, sas.module_path, sas.role, sas.notes,
              s.slug   AS strategy_slug, s.name   AS strategy_name,
              a.slug   AS agent_slug,    a.name   AS agent_name
         FROM strategy_article_sources sas
         LEFT JOIN strategies s ON s.id = sas.strategy_id
         LEFT JOIN agents     a ON a.id = s.agent_id
        WHERE sas.article_id = ?
        ORDER BY CASE sas.role
                   WHEN 'primary' THEN 0
                   WHEN 'supporting' THEN 1
                   WHEN 'calibration' THEN 2
                   WHEN 'execution' THEN 3
                 END, sas.created_at ASC`,
    )
    .all(articleId) as ArticleScaffoldedStrategy[];
}

export function listArticlesForStrategy(strategyId: number): Array<StrategyArticleLink & { article_title: string }> {
  return db()
    .prepare(
      `SELECT sas.*, ia.title AS article_title
         FROM strategy_article_sources sas
         JOIN incoming_articles ia ON ia.id = sas.article_id
        WHERE sas.strategy_id = ?
        ORDER BY sas.created_at ASC`,
    )
    .all(strategyId) as Array<StrategyArticleLink & { article_title: string }>;
}

export function listArticlesForModule(modulePath: string): Array<StrategyArticleLink & { article_title: string }> {
  return db()
    .prepare(
      `SELECT sas.*, ia.title AS article_title
         FROM strategy_article_sources sas
         JOIN incoming_articles ia ON ia.id = sas.article_id
        WHERE sas.module_path = ?
        ORDER BY sas.created_at ASC`,
    )
    .all(modulePath) as Array<StrategyArticleLink & { article_title: string }>;
}
