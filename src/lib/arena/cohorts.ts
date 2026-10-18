/**
 * Cohort helpers — group paper_agents by introduced_by tag.
 *
 * A "cohort" is every agent that shares an `introduced_by` value. Examples:
 *   - `archetype-prd-2026-05-29`  → RetroValix-pattern seeds
 *   - `hermes-archetype-2026-05-29` → Hermes-style multi-strategy seeds
 *   - `campaign-12`                → all candidates produced by training campaign #12
 *   - `meta-llm`                   → variants proposed by the LLM meta-evolution loop
 *
 * Used by /arena/cohorts to see how each batch of agents is performing
 * collectively — "did campaign-12's 5 seeded agents earn back their compute cost?"
 */
import { db } from "@/lib/db/client";

export type CohortRow = {
  cohort: string;                  // introduced_by value
  n_agents: number;
  n_alive: number;
  n_elite: number;
  total_pnl_usd: number;           // sum of lifetime PnL across the cohort
  mean_pnl_usd: number;
  top_pnl_usd: number;
  top_agent_id: number | null;
  top_agent_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type CohortAgentRow = {
  id: number;
  name: string;
  generation: number;
  alive: 0 | 1;
  is_elite: 0 | 1;
  cash_usd_current: number;
  cash_usd_start: number;
  unrealized_pnl_usd: number;
  realized_pnl_usd: number;
  lifetime_pnl_usd: number;
  trades_count: number;
  wins_count: number;
  created_at: string;
  genome_kind: string;
  capsule_id: string | null;
  capsule_status: string | null;
  capsule_capital: number | null;
  graduation_eligible: 0 | 1;          // 1 when a graduation-eligible event exists for capsule_id (last 7d)
};

/**
 * SQL fragment that computes lifetime PnL inline. Repeated across queries —
 * kept here so the formula matches /arena/high-pnl-agents exactly.
 */
const LIFETIME_PNL_EXPR = `
  (pa.cash_usd_current + pa.unrealized_pnl_usd
    + IFNULL((SELECT SUM(json_extract(value, '$.size_usd'))
                FROM json_each(pa.position_basket_json)), 0)
    - pa.cash_usd_start)
`.trim();

export function listCohorts(limit = 100): CohortRow[] {
  // Per-cohort aggregates. The window function (ROW_NUMBER) inside ranked finds
  // the single best agent per cohort so we can surface a "top performer" name.
  const sql = `
    WITH ranked AS (
      SELECT pa.id, pa.name, pa.introduced_by,
             ${LIFETIME_PNL_EXPR} AS lifetime_pnl,
             ROW_NUMBER() OVER (PARTITION BY pa.introduced_by ORDER BY ${LIFETIME_PNL_EXPR} DESC, pa.id ASC) AS rn
        FROM paper_agents pa
       WHERE pa.introduced_by IS NOT NULL AND pa.introduced_by != ''
    ),
    cohort_top AS (
      SELECT introduced_by, id AS top_id, name AS top_name, lifetime_pnl AS top_pnl
        FROM ranked
       WHERE rn = 1
    )
    SELECT
      pa.introduced_by AS cohort,
      COUNT(*) AS n_agents,
      SUM(CASE WHEN pa.alive = 1 THEN 1 ELSE 0 END) AS n_alive,
      SUM(CASE WHEN pa.is_elite = 1 THEN 1 ELSE 0 END) AS n_elite,
      SUM(${LIFETIME_PNL_EXPR}) AS total_pnl_usd,
      AVG(${LIFETIME_PNL_EXPR}) AS mean_pnl_usd,
      ct.top_pnl AS top_pnl_usd,
      ct.top_id  AS top_agent_id,
      ct.top_name AS top_agent_name,
      MIN(pa.created_at) AS first_seen_at,
      MAX(pa.created_at) AS last_seen_at
    FROM paper_agents pa
    LEFT JOIN cohort_top ct ON ct.introduced_by = pa.introduced_by
    WHERE pa.introduced_by IS NOT NULL AND pa.introduced_by != ''
    GROUP BY pa.introduced_by
    ORDER BY total_pnl_usd DESC
    LIMIT ?
  `;
  return db().prepare(sql).all(limit) as CohortRow[];
}

export function getCohort(cohort: string): CohortRow | null {
  const sql = `
    WITH ranked AS (
      SELECT pa.id, pa.name, pa.introduced_by,
             ${LIFETIME_PNL_EXPR} AS lifetime_pnl,
             ROW_NUMBER() OVER (PARTITION BY pa.introduced_by ORDER BY ${LIFETIME_PNL_EXPR} DESC, pa.id ASC) AS rn
        FROM paper_agents pa
       WHERE pa.introduced_by = ?
    ),
    cohort_top AS (
      SELECT introduced_by, id AS top_id, name AS top_name, lifetime_pnl AS top_pnl
        FROM ranked WHERE rn = 1
    )
    SELECT
      pa.introduced_by AS cohort,
      COUNT(*) AS n_agents,
      SUM(CASE WHEN pa.alive = 1 THEN 1 ELSE 0 END) AS n_alive,
      SUM(CASE WHEN pa.is_elite = 1 THEN 1 ELSE 0 END) AS n_elite,
      SUM(${LIFETIME_PNL_EXPR}) AS total_pnl_usd,
      AVG(${LIFETIME_PNL_EXPR}) AS mean_pnl_usd,
      ct.top_pnl AS top_pnl_usd,
      ct.top_id  AS top_agent_id,
      ct.top_name AS top_agent_name,
      MIN(pa.created_at) AS first_seen_at,
      MAX(pa.created_at) AS last_seen_at
    FROM paper_agents pa
    LEFT JOIN cohort_top ct ON ct.introduced_by = pa.introduced_by
    WHERE pa.introduced_by = ?
    GROUP BY pa.introduced_by
  `;
  return (db().prepare(sql).get(cohort, cohort) as CohortRow | undefined) ?? null;
}

export function listCohortAgents(cohort: string, limit = 200): CohortAgentRow[] {
  // ROW_NUMBER picks the latest capsule per paper_agent_id; LEFT JOIN to a
  // 7d window of graduation-eligible events tells us which capsules have
  // already been flagged.
  const sql = `
    WITH latest_caps AS (
      SELECT id, paper_agent_id, status, capital_allocated_usd,
             ROW_NUMBER() OVER (PARTITION BY paper_agent_id ORDER BY updated_at DESC, id DESC) AS rn
        FROM capsules WHERE paper_agent_id IS NOT NULL
    )
    SELECT pa.id, pa.name, pa.generation, pa.alive, pa.is_elite,
           pa.cash_usd_current, pa.cash_usd_start, pa.unrealized_pnl_usd, pa.realized_pnl_usd,
           ${LIFETIME_PNL_EXPR} AS lifetime_pnl_usd,
           pa.trades_count, pa.wins_count, pa.created_at,
           COALESCE(json_extract(pa.genome_json, '$.kind'), 'unknown') AS genome_kind,
           c.id    AS capsule_id,
           c.status AS capsule_status,
           c.capital_allocated_usd AS capsule_capital,
           (CASE WHEN EXISTS (
              SELECT 1 FROM evolution_log e
               WHERE e.event_type = 'graduation-eligible'
                 AND e.payload_json LIKE '%' || c.id || '%'
                 AND e.created_at >= datetime('now', '-7 days')
            ) THEN 1 ELSE 0 END) AS graduation_eligible
      FROM paper_agents pa
      LEFT JOIN latest_caps c ON c.paper_agent_id = pa.id AND c.rn = 1
     WHERE pa.introduced_by = ?
     ORDER BY lifetime_pnl_usd DESC
     LIMIT ?
  `;
  return db().prepare(sql).all(cohort, limit) as CohortAgentRow[];
}

/**
 * Aggregate graduation stats for a cohort (used by cohort header).
 * Counts staged capsules + graduation-eligible flags.
 */
export type CohortGraduationStats = {
  n_capsules_staged: number;
  n_eligible: number;
};

export function getCohortGraduationStats(cohort: string): CohortGraduationStats {
  const row = db()
    .prepare(
      `WITH latest_caps AS (
         SELECT id, paper_agent_id, status,
                ROW_NUMBER() OVER (PARTITION BY paper_agent_id ORDER BY updated_at DESC, id DESC) AS rn
           FROM capsules WHERE paper_agent_id IS NOT NULL
       )
       SELECT
         COUNT(c.id) AS n_capsules_staged,
         SUM(CASE WHEN EXISTS (
              SELECT 1 FROM evolution_log e
               WHERE e.event_type = 'graduation-eligible'
                 AND e.payload_json LIKE '%' || c.id || '%'
                 AND e.created_at >= datetime('now', '-7 days')
            ) THEN 1 ELSE 0 END) AS n_eligible
         FROM paper_agents pa
         LEFT JOIN latest_caps c ON c.paper_agent_id = pa.id AND c.rn = 1
        WHERE pa.introduced_by = ?
          AND c.status IN ('paper', 'live')`,
    )
    .get(cohort) as { n_capsules_staged: number | null; n_eligible: number | null };
  return {
    n_capsules_staged: row?.n_capsules_staged ?? 0,
    n_eligible: row?.n_eligible ?? 0,
  };
}
