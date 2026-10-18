/**
 * POST /api/arena/stage-capsule
 *
 * Creates a new capsule in 'paused' status bound to the chosen agent.
 * Operator specifies bet size; capsule sits paused until they flip it to
 * 'paper' or 'live' from /settings (or the existing capsule routes).
 *
 * No router calls. No automatic activation. No ALLOW_TRADE check here —
 * staging always succeeds; ALLOW_TRADE only matters when the capsule is
 * later flipped to 'live' and an order is routed.
 *
 * Body schema:
 *   { agentId: number, opportunityId: number, betUsd: number,
 *     maxDailyLossUsd?: number, maxPositionPct?: number }
 *
 * Returns:
 *   { ok: true, capsule: { id, name, status } }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { createCapsule, setStatus } from "@risk/capsules/store";
import { getPaperAgent } from "@/lib/arena/db";
import { parseGenome, type Genome } from "@/lib/arena/genome";
import { insertEvolutionEvent } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const schema = z.object({
  agentId: z.number().int().positive(),
  opportunityId: z.number().int().positive(),
  betUsd: z.number().positive().max(10_000),
  side: z.string().optional(),  // operator may override the matched side
  maxDailyLossUsd: z.number().nonnegative().optional(),
  maxPositionPct: z.number().min(0).max(1).optional(),
});

/** Map a genome kind to a strategies.slug for binding the capsule. */
const KIND_TO_STRATEGY_SLUG: Record<string, string | null> = {
  poly_fade_spike: "fade-headline-spikes",
  poly_breakout: "breakout-rider",
  poly_short_binary_directional: "midwindow-trajectory",
  polymarket_market_maker: "orderbook-imbalance-watch",
  llm_probability_oracle: "near-resolution-scrape",
  category_specialist: "fade-headline-spikes",
  wallet_copy_filtered: "consensus-tail-follow",
  multi_strategy: null,
  // CB-only and baseline strategies do not bind to a Polymarket capsule.
  cb_breakout: null,
  cb_mean_reversion: null,
  cb_momentum_burst: null,
  cross_venue_arb: null,
  random_walk_baseline: null,
};

/** For an opportunity event_type, the canonical strategy slug it belongs to.
 *  Used when the agent is a multi_strategy composite — we pick the strategy
 *  that matches the OPPORTUNITY, not the agent itself. */
const EVENT_TYPE_TO_STRATEGY_SLUG: Record<string, string> = {
  "late-window-scalp-opportunity": "late-window-scalp",
  "near-resolution-opportunity": "near-resolution-scrape",
  "cross-timeframe-opportunity": "cross-timeframe-spread-trade",
  "orderbook-imbalance-signal": "orderbook-imbalance-watch",
  "consensus-signal": "consensus-tail-follow",
  // Operator-driven staging from /arena/high-pnl-agents LiveBinaryPanel.
  // Bind to the 5-min directional strategy; the agent's own genome still
  // decides side at execution time.
  "panel-binary-stage": "midwindow-trajectory",
};

function resolveStrategyId(genome: Genome, opportunityEventType: string): number | null {
  // For multi-strategy agents, the opportunity's event type tells us which
  // sub-strategy is being staged — bind the capsule to THAT strategy.
  const slug = EVENT_TYPE_TO_STRATEGY_SLUG[opportunityEventType]
    ?? KIND_TO_STRATEGY_SLUG[genome.kind]
    ?? null;
  if (!slug) return null;
  const row = db().prepare("SELECT id FROM strategies WHERE slug = ?").get(slug) as { id: number } | undefined;
  return row?.id ?? null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { agentId, opportunityId, betUsd, side, maxDailyLossUsd, maxPositionPct } = parsed.data;

  const agent = getPaperAgent(agentId);
  if (!agent) {
    return NextResponse.json({ ok: false, error: `agent ${agentId} not found` }, { status: 404 });
  }

  const oppRow = db().prepare(
    "SELECT id, event_type, payload_json, created_at FROM evolution_log WHERE id = ?",
  ).get(opportunityId) as { id: number; event_type: string; payload_json: string; created_at: string } | undefined;
  if (!oppRow) {
    return NextResponse.json({ ok: false, error: `opportunity ${opportunityId} not found` }, { status: 404 });
  }

  let genome: Genome;
  try { genome = parseGenome(agent.genome_json); }
  catch { return NextResponse.json({ ok: false, error: "agent genome unparseable" }, { status: 400 }); }

  const strategyId = resolveStrategyId(genome, oppRow.event_type);

  // Extract conditionId from the payload so the capsule has the market binding
  // for the executor to use later.
  let conditionId: string | null = null;
  let marketTitle: string | null = null;
  try {
    const p = JSON.parse(oppRow.payload_json) as Record<string, unknown>;
    conditionId = (p.conditionId as string | undefined) ?? (p.marketKey as string | undefined) ?? null;
    marketTitle = (p.marketTitle as string | undefined) ?? (p.title as string | undefined) ?? null;
  } catch { /* no-op */ }

  const titleSnippet = marketTitle ? marketTitle.slice(0, 40) : `evt-${oppRow.id}`;
  const capsuleName = `staged · agent #${agent.id} · ${titleSnippet}`;

  // Default risk budgets:
  //   - daily loss cap = bet size (one bad fill blows the daily budget)
  //   - position pct cap = 1.0 (this capsule can use all its capital on the trade)
  //
  // NOTE: createCapsule's `agentId` field maps to the capsules.agent_id column,
  // which FK-references the `agents` table (the human-authored strategies
  // catalogue), NOT `paper_agents`. We bind the paper agent via the dedicated
  // paper_agent_id column below.
  const capsule = createCapsule({
    name: capsuleName,
    strategyId: strategyId ?? undefined,
    capitalUsd: betUsd,
    allowedVenues: ["polymarket"],
    allowedSymbols: conditionId ? [conditionId] : undefined,
    maxDailyLossUsd: maxDailyLossUsd ?? betUsd,
    maxTotalDrawdownUsd: betUsd,
    maxPositionPct: maxPositionPct ?? 1.0,
    maxOpenPositions: 1,
    maxTradesPerDay: 4,
    minSecondsBetweenTrades: 30,
  });

  // Move from default 'draft' → 'paused' so the operator can see + flip it
  // explicitly. 'paused' is the agreed staging state.
  setStatus(capsule.id, "paused");

  // Also write the paper_agent_id directly — createCapsule uses agent_id, but
  // the rest of the codebase reads paper_agent_id. Set both for compatibility.
  db().prepare(
    "UPDATE capsules SET paper_agent_id = ? WHERE id = ?",
  ).run(agent.id, capsule.id);

  insertEvolutionEvent({
    event_type: "capsule-staged",
    summary: `Operator staged capsule for agent #${agent.id} on ${titleSnippet} ($${betUsd})`,
    payload_json: JSON.stringify({
      capsule_id: capsule.id,
      agent_id: agent.id,
      opportunity_id: opportunityId,
      opportunity_event_type: oppRow.event_type,
      condition_id: conditionId,
      bet_usd: betUsd,
      side_override: side ?? null,
      strategy_id: strategyId,
    }),
  });

  return NextResponse.json({
    ok: true,
    capsule: {
      id: capsule.id,
      name: capsule.name,
      status: "paused",
      capital_allocated_usd: betUsd,
      paper_agent_id: agent.id,
      strategy_id: strategyId,
    },
  }, { status: 201 });
}
