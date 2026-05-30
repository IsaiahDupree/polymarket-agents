/**
 * Graduation — close the factory loop.
 *
 * graduateCandidate(agentId): create a sim-stage capsule bound to a paper_agent
 * with conservative risk defaults, immediately advance to 'paper' so live
 * arena ticks start flowing real signals through it. This is what makes a
 * campaign winner "actually visible" to the operator on the high-pnl page —
 * a capsule appears in the table.
 *
 * runGraduationPass(): periodically scan paper-staged capsules from campaign
 * cohorts, check forward PnL, emit 'graduation-eligible' events when an
 * agent has earned ≥ threshold. Operator still confirms before live.
 *
 * The thresholds are env-tunable so the operator can dial them up/down
 * without redeploying:
 *   - GRADUATION_MIN_PNL_USD      (default 10)  — lowered 2026-05-30 for staged-stake
 *   - GRADUATION_MIN_TRADES        (default 15)  — see docs/prds/staged-stake-consistent-winner-2026-05-30.md
 *   - GRADUATION_AUTO_STAGE_CAPITAL (default 50)
 *   - GRADUATION_AUTO_STAGE_MAX_DAILY_LOSS (default 25)
 *   - GRADUATION_AUTO_STAGE_MAX_TOTAL_DRAWDOWN (default 10)
 */
import { db } from "@/lib/db/client";
import { createCapsule, setStatus } from "@risk/capsules/store";
import { insertEvolutionEvent } from "@/lib/db/queries";

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export type GraduateOpts = {
  /** Name to use for the new capsule. Defaults to the agent's name + a suffix. */
  capsuleName?: string;
  /** Capital allocated to the capsule. Defaults env or $50. */
  capitalUsd?: number;
  /** Max daily-loss cap. Defaults env or $25 (= 50% of capital — conservative). */
  maxDailyLossUsd?: number;
  /** Max total drawdown cap. Defaults env or $10. */
  maxTotalDrawdownUsd?: number;
  /** Allowed venues. Inferred from genome.kind if omitted (poly_* → polymarket, cb_* → coinbase). */
  allowedVenues?: string[];
};

export type GraduateResult = {
  capsuleId: string;
  agentId: number;
  stagedAt: string;
};

/**
 * Create a paper-stage capsule for a paper_agent. Used by runCampaign on
 * top-K winners. Returns the capsule id; the caller persists it onto the
 * candidate row.
 */
export function graduateCandidate(agentId: number, opts: GraduateOpts = {}): GraduateResult {
  const handle = db();
  const agent = handle
    .prepare(`SELECT name, genome_json FROM paper_agents WHERE id = ?`)
    .get(agentId) as { name: string; genome_json: string } | undefined;
  if (!agent) throw new Error(`paper_agent ${agentId} not found`);

  // Infer allowed venues from the genome kind if not explicit.
  let allowedVenues = opts.allowedVenues;
  if (!allowedVenues) {
    let kind: string | undefined;
    try { kind = JSON.parse(agent.genome_json)?.kind; } catch { /* swallow */ }
    if (typeof kind === "string") {
      if (kind.startsWith("poly_") || kind === "polymarket_market_maker") allowedVenues = ["polymarket"];
      else if (kind.startsWith("cb_")) allowedVenues = ["coinbase"];
      else if (kind === "cross_venue_arb") allowedVenues = ["polymarket", "coinbase"];
      else allowedVenues = ["polymarket", "coinbase"];
    } else {
      allowedVenues = ["polymarket", "coinbase"];
    }
  }

  const capitalUsd = opts.capitalUsd ?? envNum("GRADUATION_AUTO_STAGE_CAPITAL", 50);
  const maxDailyLossUsd = opts.maxDailyLossUsd ?? envNum("GRADUATION_AUTO_STAGE_MAX_DAILY_LOSS", 25);
  const maxTotalDrawdownUsd = opts.maxTotalDrawdownUsd ?? envNum("GRADUATION_AUTO_STAGE_MAX_TOTAL_DRAWDOWN", 10);
  const capsuleName = opts.capsuleName ?? `graduation-${agent.name.slice(0, 32)}`;

  const capsule = createCapsule({
    name: capsuleName,
    capitalUsd,
    allowedVenues,
    maxDailyLossUsd,
    maxTotalDrawdownUsd,
    maxOpenPositions: 5,
    maxTradesPerDay: 50,
    minSecondsBetweenTrades: 60,
  });

  // createCapsule doesn't accept paper_agent_id directly (capsules.agent_id
  // references `agents` table, not `paper_agents`). Persist the binding via
  // a direct UPDATE on the column.
  handle
    .prepare(`UPDATE capsules SET paper_agent_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(agentId, capsule.id);

  // Advance to 'paper' immediately so the live router's stage gate lets
  // signals through in dry-run mode and forward PnL starts accumulating.
  setStatus(capsule.id, "paper");

  const stagedAt = new Date().toISOString();

  insertEvolutionEvent({
    event_type: "graduation-staged",
    summary: `capsule ${capsule.id.slice(0, 8)} staged at paper for agent #${agentId} ${agent.name.slice(0, 32)} (cap=$${capitalUsd})`,
    payload_json: JSON.stringify({
      capsule_id: capsule.id,
      paper_agent_id: agentId,
      agent_name: agent.name,
      capital_usd: capitalUsd,
      max_daily_loss_usd: maxDailyLossUsd,
      max_total_drawdown_usd: maxTotalDrawdownUsd,
      allowed_venues: allowedVenues,
      staged_at: stagedAt,
    }),
  });

  return { capsuleId: capsule.id, agentId, stagedAt };
}

// ---------------------------------------------------------------------------
// Periodic graduation-pass

export type GraduationCandidate = {
  capsule_id: string;
  paper_agent_id: number;
  agent_name: string;
  introduced_by: string | null;
  capsule_capital: number;
  realized_pnl_usd: number;
  trades_count: number;
  wins_count: number;
  activated_at: string | null;
  hours_since_activated: number;
  eligible: boolean;
  reason: string;
};

export type GraduationPassResult = {
  scanned: number;
  eligible: number;
  newly_emitted: number;
  candidates: GraduationCandidate[];
  thresholds: { min_pnl_usd: number; min_trades: number };
  ran_at: string;
};

/**
 * Scan paper-staged capsules attached to campaign-origin paper_agents and
 * compute graduation eligibility per (capsule, agent). Emits a
 * `graduation-eligible` evolution event for each newly-eligible agent
 * (deduped against prior emissions in the last 24h).
 *
 * Also emits a single `factory-summary` event with the run-level stats.
 */
export function runGraduationPass(): GraduationPassResult {
  const minPnlUsd = envNum("GRADUATION_MIN_PNL_USD", 10);
  const minTrades = envNum("GRADUATION_MIN_TRADES", 15);
  const handle = db();

  const rows = handle
    .prepare(
      `SELECT c.id AS capsule_id, c.paper_agent_id, pa.name AS agent_name,
              pa.introduced_by, c.capital_allocated_usd AS capsule_capital,
              pa.realized_pnl_usd, pa.trades_count, pa.wins_count, c.activated_at
         FROM capsules c
         JOIN paper_agents pa ON pa.id = c.paper_agent_id
        WHERE c.status = 'paper'
          AND pa.alive = 1
          AND (pa.introduced_by LIKE 'campaign-%'
            OR pa.introduced_by LIKE 'consistent-winner%')
        ORDER BY pa.realized_pnl_usd DESC`,
    )
    .all() as Array<{
      capsule_id: string;
      paper_agent_id: number;
      agent_name: string;
      introduced_by: string;
      capsule_capital: number;
      realized_pnl_usd: number;
      trades_count: number;
      wins_count: number;
      activated_at: string | null;
    }>;

  const now = Date.now();
  const candidates: GraduationCandidate[] = [];
  let eligibleCount = 0;
  let newlyEmitted = 0;

  for (const r of rows) {
    const activatedMs = r.activated_at ? Date.parse(r.activated_at) : 0;
    const hoursSince = activatedMs > 0 ? (now - activatedMs) / 3_600_000 : 0;
    const eligible = r.realized_pnl_usd >= minPnlUsd && r.trades_count >= minTrades;
    const reason = eligible
      ? `cleared: pnl=$${r.realized_pnl_usd.toFixed(2)} ≥ $${minPnlUsd} AND trades=${r.trades_count} ≥ ${minTrades}`
      : r.realized_pnl_usd < minPnlUsd
      ? `pnl=$${r.realized_pnl_usd.toFixed(2)} < $${minPnlUsd}`
      : `trades=${r.trades_count} < ${minTrades}`;

    candidates.push({
      capsule_id: r.capsule_id,
      paper_agent_id: r.paper_agent_id,
      agent_name: r.agent_name,
      introduced_by: r.introduced_by,
      capsule_capital: r.capsule_capital,
      realized_pnl_usd: r.realized_pnl_usd,
      trades_count: r.trades_count,
      wins_count: r.wins_count,
      activated_at: r.activated_at,
      hours_since_activated: Math.round(hoursSince * 10) / 10,
      eligible,
      reason,
    });

    if (!eligible) continue;
    eligibleCount += 1;

    // Dedup: skip if we already emitted a graduation-eligible event for this
    // capsule within the last 24h. Operator confirms graduation manually so
    // duplicate notifications add noise.
    const recent = handle
      .prepare(
        `SELECT id FROM evolution_log
          WHERE event_type = 'graduation-eligible'
            AND payload_json LIKE '%' || ? || '%'
            AND created_at >= datetime('now', '-24 hours')
          LIMIT 1`,
      )
      .get(r.capsule_id) as { id: number } | undefined;
    if (recent) continue;

    insertEvolutionEvent({
      event_type: "graduation-eligible",
      summary: `agent #${r.paper_agent_id} ${r.agent_name.slice(0, 30)} cleared graduation gate (pnl=$${r.realized_pnl_usd.toFixed(2)}, trades=${r.trades_count})`,
      payload_json: JSON.stringify({
        capsule_id: r.capsule_id,
        paper_agent_id: r.paper_agent_id,
        agent_name: r.agent_name,
        introduced_by: r.introduced_by,
        realized_pnl_usd: r.realized_pnl_usd,
        trades_count: r.trades_count,
        wins_count: r.wins_count,
        win_rate: r.trades_count > 0 ? r.wins_count / r.trades_count : 0,
        hours_since_activated: hoursSince,
        thresholds: { min_pnl_usd: minPnlUsd, min_trades: minTrades },
      }),
    });
    newlyEmitted += 1;
  }

  // Per-pass summary so the operator can see factory output in evolution_log
  // even when no individual agents tipped over the line this run.
  insertEvolutionEvent({
    event_type: "factory-summary",
    summary: `graduation pass: scanned=${rows.length} eligible=${eligibleCount} newly_emitted=${newlyEmitted}`,
    payload_json: JSON.stringify({
      scanned: rows.length,
      eligible: eligibleCount,
      newly_emitted: newlyEmitted,
      thresholds: { min_pnl_usd: minPnlUsd, min_trades: minTrades },
    }),
  });

  return {
    scanned: rows.length,
    eligible: eligibleCount,
    newly_emitted: newlyEmitted,
    candidates,
    thresholds: { min_pnl_usd: minPnlUsd, min_trades: minTrades },
    ran_at: new Date().toISOString(),
  };
}
