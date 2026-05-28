/**
 * DB-side loader: pulls decision_journal rows + joins to trade outcomes.
 *
 * Outcome bridges (v1):
 *   - LIVE trades:  decision_journal.order_id → trades.order_id, won = pnl_usd > 0
 *   - PAPER trades: match by (agent_id → paper_agent_id, symbol → market_id,
 *                  intent='exit', tick_at ≥ decision.ts), won = realized_pnl_usd > 0
 *   - Decisions with no matching exit trade (WATCHLIST / REJECTED / not-yet-
 *     closed entries): excluded — no outcome to evaluate.
 *
 * Win definition: realized PnL on the EXIT row (round-trip) is positive.
 *
 * v2 work item: replay the counterfactual paper trade the strategy would
 * have placed if the pipeline had approved (lets us calibrate REJECTED
 * decisions too). Requires sim engine to record shadow-paper trades.
 */
import { db } from "@/lib/db/client";
import type { LabeledDecision } from "./calibration";

export type CalibrationLoaderQuery = {
  /** ISO timestamp lower bound. Default: 30 days ago. */
  sinceTs?: string;
  /** Filter by strategy_kind. */
  strategyKind?: string;
  /** Filter by capsule_id. */
  capsuleId?: string;
  /** Hard cap. Default 1000. */
  limit?: number;
};

/**
 * Pulls journal rows with matching trade outcomes. Returns labeled rows
 * that can be fed directly to `buildCalibrationReport()`.
 *
 * Bridges:
 *   - LIVE: LEFT JOIN trades ON trades.order_id = decision_journal.order_id
 *           (LIVE order goes through the venue router; trades table carries
 *            pnl_usd on the exit row matched by intent='exit')
 *   - PAPER: LEFT JOIN paper_trades ON paper_trades.paper_agent_id =
 *           decision_journal.agent_id AND market_id = symbol AND
 *           intent='exit' AND tick_at >= decision.ts
 *
 * A decision's win-flag = (any positive realized PnL across either bridge).
 */
export function loadLabeledDecisions(q: CalibrationLoaderQuery = {}): LabeledDecision[] {
  const since = q.sinceTs ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const limit = Math.min(Math.max(10, q.limit ?? 1000), 10_000);

  const params: Record<string, unknown> = { since, limit };
  const filters: string[] = ["d.ts >= @since"];
  if (q.strategyKind) {
    filters.push("d.strategy_kind = @strategy_kind");
    params.strategy_kind = q.strategyKind;
  }
  if (q.capsuleId) {
    filters.push("d.capsule_id = @capsule_id");
    params.capsule_id = q.capsuleId;
  }

  // Sum realized PnL across BOTH bridges. A row is labeled if EITHER
  // produced an exit row.
  const rows = db()
    .prepare(
      `SELECT
         d.id, d.approval_score, d.decision, d.strategy_kind, d.capsule_id,
         COALESCE(SUM(CASE WHEN t.intent = 'exit' THEN t.pnl_usd ELSE 0 END), 0) AS live_pnl,
         COALESCE(SUM(CASE WHEN pt.intent = 'exit' THEN pt.realized_pnl_usd ELSE 0 END), 0) AS paper_pnl,
         SUM(CASE WHEN t.intent = 'exit' THEN 1 ELSE 0 END) AS live_exits,
         SUM(CASE WHEN pt.intent = 'exit' THEN 1 ELSE 0 END) AS paper_exits
       FROM decision_journal d
       LEFT JOIN trades t
         ON d.order_id IS NOT NULL
        AND t.order_id = d.order_id
        AND t.intent = 'exit'
       LEFT JOIN paper_trades pt
         ON d.agent_id IS NOT NULL
        AND pt.paper_agent_id = d.agent_id
        AND pt.market_id = d.symbol
        AND pt.intent = 'exit'
        AND pt.tick_at >= d.ts
       WHERE ${filters.join(" AND ")}
       GROUP BY d.id
       HAVING live_exits > 0 OR paper_exits > 0
       ORDER BY d.ts DESC
       LIMIT @limit`,
    )
    .all(params) as Array<{
      id: number;
      approval_score: number;
      decision: string;
      strategy_kind: string;
      capsule_id: string | null;
      live_pnl: number;
      paper_pnl: number;
      live_exits: number;
      paper_exits: number;
    }>;

  return rows.map((r) => ({
    id: r.id,
    approval_score: r.approval_score,
    decision: r.decision,
    strategy_kind: r.strategy_kind,
    capsule_id: r.capsule_id ?? undefined,
    won: (r.live_pnl + r.paper_pnl) > 0,
  }));
}
