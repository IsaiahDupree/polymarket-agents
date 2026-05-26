/**
 * Live-capsule bridge for the arena.
 *
 * When a paper agent is bound to a capsule in stage='live', its signals route
 * through ExecutionRouter (real orders) instead of the pure-sim apply path.
 * The router's 5 gates (idempotency, halt, capsule, risk engine, adapter)
 * + per-venue ALLOW_TRADE safety still apply on top — there's no way for a
 * live signal to fire without all of those passing.
 *
 * v1 → v2 changes:
 *   - Coinbase ENTRIES routed live (BUY quote_size)
 *   - Coinbase EXITS routed live (SELL base_size = size_usd/entry_price)
 *   - Polymarket ENTRIES + EXITS stay sim-tracked (PolymarketAdapter only
 *     supports FOK_BASKET; adding single-side support is a follow-up)
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db/client";
import { getDefaultRouter } from "@/lib/venue/router";
import { insertEvolutionEvent } from "@/lib/db/queries";
import type { Position, Signal } from "./types";

export type LiveCapsuleBinding = {
  id: string;
  paper_agent_id: number;
  capital_allocated_usd: number;
  capital_available_usd: number;
  max_position_pct: number;
  max_open_positions: number;
  max_daily_loss_usd: number;
  daily_pnl_usd: number;
  status: string;
};

export function findLiveCapsuleForPaperAgent(paperAgentId: number): LiveCapsuleBinding | undefined {
  return db().prepare(
    `SELECT id, paper_agent_id, capital_allocated_usd, capital_available_usd,
            max_position_pct, max_open_positions, max_daily_loss_usd, daily_pnl_usd, status
       FROM capsules WHERE paper_agent_id = ? AND status = 'live'
       LIMIT 1`,
  ).get(paperAgentId) as LiveCapsuleBinding | undefined;
}

function venueLabel(arenaVenue: "sim-poly" | "sim-coinbase"): "polymarket" | "coinbase" {
  return arenaVenue === "sim-poly" ? "polymarket" : "coinbase";
}

/**
 * Whether the live-trading path supports this signal. v1: Coinbase entries +
 * exits only. Polymarket signals always fall through to sim until the
 * PolymarketAdapter learns to do single-side market orders.
 */
export function supportsLiveRouting(signal: Signal): boolean {
  if (signal.kind === "hold") return false;
  return signal.venue === "sim-coinbase";
}

export type RouteResult =
  | { ok: true; status: "filled" | "dry_run"; usdEquivalent: number; brokerOrderId?: string; raw?: unknown }
  | { ok: false; code: string; reason: string };

/**
 * Submit an arena entry OR exit signal through ExecutionRouter using the
 * capsule binding. For exits, `position` must be the open Position being closed
 * (used to compute base_size for SELL).
 */
export async function routeArenaSignal(
  signal: Signal,
  capsule: LiveCapsuleBinding,
  agentId: number,
  refPrice: number,
  position?: Position,
): Promise<RouteResult> {
  if (signal.kind === "hold") return { ok: false, code: "NO_SIGNAL", reason: "hold" };
  if (!supportsLiveRouting(signal)) {
    return { ok: false, code: "UNSUPPORTED_VENUE_LIVE", reason: `${signal.venue} not supported for live routing in v1` };
  }

  const router = getDefaultRouter();

  let side: "BUY" | "SELL";
  let size: number;
  let intent: "entry" | "exit";
  let market_id: string;
  let rationale: string;

  if (signal.kind === "entry") {
    side = signal.side;
    size = signal.size_usd;
    intent = "entry";
    market_id = signal.market_id;
    rationale = signal.rationale;
  } else {
    // EXIT: derive the closing-side + size from the open position.
    if (!position) return { ok: false, code: "MISSING_POSITION", reason: "exit signal but no position passed" };
    market_id = signal.market_id;
    rationale = signal.rationale;
    intent = "exit";
    // The closing side is the OPPOSITE of the open side.
    side = position.side === "BUY" ? "SELL" : "BUY";
    if (side === "SELL") {
      // base_size = original USD notional / entry price → the asset qty we hold.
      if (!(position.entry_price > 0)) return { ok: false, code: "BAD_POSITION", reason: "entry_price <= 0" };
      size = position.size_usd / position.entry_price;
    } else {
      // BUY-back to close a short. We bought $X notional at entry_price; cover with similar USD.
      size = position.size_usd;
    }
  }

  const order = {
    clientOrderId: `arena-${capsule.id.slice(0, 8)}-${agentId}-${intent}-${randomUUID().slice(0, 8)}`,
    venue: venueLabel(signal.venue),
    symbol: market_id,
    side,
    type: "MARKET" as const,
    size,
    refPrice,
    capsuleId: capsule.id,
    agentId,
    metadata: { source: "arena", intent, rationale, ...(intent === "exit" && position ? { entry_price: position.entry_price, opened_at: position.opened_at } : {}) },
  };

  const verdict = await router.submit(order);
  if (verdict.ok) {
    if ("status" in verdict && verdict.status === "dry_run") {
      insertEvolutionEvent({
        event_type: "live-capsule-dry-run",
        summary: `capsule ${capsule.id.slice(0, 8)} dry-run ${intent} on agent ${agentId}: ${market_id}`,
        payload_json: JSON.stringify({ order, verdict }),
      });
      return { ok: true, status: "dry_run", usdEquivalent: verdict.usdEquivalent };
    }
    insertEvolutionEvent({
      event_type: "live-capsule-fill",
      summary: `capsule ${capsule.id.slice(0, 8)} FILLED ${intent} on agent ${agentId}: ${market_id} $${verdict.usdEquivalent.toFixed(2)}`,
      payload_json: JSON.stringify({ order, verdict }),
    });
    return {
      ok: true,
      status: "filled",
      usdEquivalent: verdict.usdEquivalent,
      brokerOrderId: "brokerOrderId" in verdict ? verdict.brokerOrderId : undefined,
      raw: "raw" in verdict ? verdict.raw : undefined,
    };
  }
  insertEvolutionEvent({
    event_type: "live-capsule-rejected",
    summary: `capsule ${capsule.id.slice(0, 8)} REJECTED ${intent} on agent ${agentId}: ${verdict.code} (${verdict.reason})`,
    payload_json: JSON.stringify({ order, verdict }),
  });
  return { ok: false, code: verdict.code, reason: verdict.reason };
}

export function refreshCapsuleRealtime(capsuleId: string, paperAgentId: number): void {
  const agent = db().prepare(
    `SELECT cash_usd_current, unrealized_pnl_usd, realized_pnl_usd
       FROM paper_agents WHERE id = ?`,
  ).get(paperAgentId) as { cash_usd_current: number; unrealized_pnl_usd: number; realized_pnl_usd: number } | undefined;
  if (!agent) return;
  const currentPnl = agent.realized_pnl_usd + agent.unrealized_pnl_usd;
  const dailyRow = db().prepare(
    `SELECT COALESCE(SUM(json_extract(payload_json, '$.verdict.usdEquivalent')), 0) AS spend
       FROM evolution_log
       WHERE event_type = 'live-capsule-fill'
         AND created_at > datetime('now', 'start of day')
         AND json_extract(payload_json, '$.order.capsuleId') = ?`,
  ).get(capsuleId) as { spend: number };
  db().prepare(
    `UPDATE capsules SET current_pnl_usd = ?, daily_pnl_usd = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(currentPnl, -Math.abs(dailyRow.spend ?? 0), capsuleId);
}
