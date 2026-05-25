/**
 * Trade execution with hard safety gates.
 *
 * Three layers of protection — ALL must be satisfied for a real order to fire:
 *   1. ENV: ALLOW_TRADE=1 (otherwise DRY_RUN, only logs intent)
 *   2. Per-trade cap: MAX_TRADE_USD (default $25)
 *   3. Per-day cap:   MAX_DAILY_USD (default $100, computed from evolution_log)
 *
 * Every intended execution writes an evolution_log row BEFORE attempting the
 * trade so we always have an audit trail, even on crash. Live submissions go
 * through @polymarket/clob-client's `createAndPostMarketOrder` (FOK by default).
 *
 * Provides a `killSwitch()` that calls `cancelAll()` if anything goes wrong.
 */
import { db } from "@/lib/db/client";
import { insertEvolutionEvent } from "@/lib/db/queries";
import type { SingleMarketArb } from "./arb";

// SDK is heavy + dynamic-loaded so the module is usable in environments
// (the UI server pages) that should never trade.
type ClobClient = any;
let _clientPromise: Promise<ClobClient> | null = null;
async function getClobClient(): Promise<ClobClient> {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const mod: any = await import("@polymarket/clob-client");
      const ClobClient = mod.ClobClient ?? mod.default?.ClobClient;
      const apiCreds = {
        key: process.env.POLYMARKET_CLOB_API_KEY ?? "",
        secret: process.env.POLYMARKET_CLOB_SECRET ?? "",
        passphrase: process.env.POLYMARKET_CLOB_PASSPHRASE ?? "",
      };
      const sigType = Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "1");
      const funder = process.env.POLYMARKET_FUNDER_ADDRESS || process.env.POLYMARKET_RELAYER_API_KEY_ADDRESS || "";
      // The v4 SDK expects an ethers Signer; build one off the private key.
      const ethers = await import("ethers");
      const wallet = new ethers.Wallet(process.env.POLYMARKET_PRIVATE_KEY!);
      const host = process.env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com";
      const chain = Number(process.env.POLYMARKET_CHAIN_ID ?? "137");
      return new ClobClient(host, chain, wallet, apiCreds, sigType, funder);
    })();
  }
  return _clientPromise;
}

export type ExecuteMode = "DRY_RUN" | "LIVE";

function readMode(): ExecuteMode {
  return process.env.ALLOW_TRADE === "1" ? "LIVE" : "DRY_RUN";
}
function readMaxTradeUsd(): number {
  return Number(process.env.MAX_TRADE_USD ?? "25");
}
function readMaxDailyUsd(): number {
  return Number(process.env.MAX_DAILY_USD ?? "100");
}

/** Sum executed-arb USD spend in the last 24h from evolution_log. */
function dailyExecutedUsd(): number {
  const row = db().prepare(
    `SELECT COALESCE(SUM(json_extract(payload_json, '$.cost_usd')), 0) AS spend
     FROM evolution_log
     WHERE event_type = 'arb-executed' AND created_at > datetime('now', '-1 day')`,
  ).get() as { spend: number };
  return row.spend ?? 0;
}

export type ExecuteVerdict =
  | { kind: "dry-run"; reason: string; planned: { yes: PlannedLeg; no: PlannedLeg }; capUsed: { trade: number; daily: number } }
  | { kind: "executed"; orders: any[]; planned: { yes: PlannedLeg; no: PlannedLeg } }
  | { kind: "rejected"; reason: string };

type PlannedLeg = { tokenId: string; side: "BUY"; price: number; sizeUsd: number; shares: number };

function planLegs(arb: SingleMarketArb, sizeUsd: number): { yes: PlannedLeg; no: PlannedLeg } {
  // We buy YES and NO at their respective asks. We split the budget so that the
  // resulting share count is identical across legs — that's what locks in the $1 payoff.
  const sharesByBudget = sizeUsd / (arb.bestYesAsk + arb.bestNoAsk);
  const shares = Math.min(Math.floor(sharesByBudget), arb.maxExecutableShares);
  if (shares <= 0) {
    throw new Error("sizeUsd too small for any whole-share basket");
  }
  return {
    yes: { tokenId: arb.yesTokenId, side: "BUY", price: arb.bestYesAsk, sizeUsd: shares * arb.bestYesAsk, shares },
    no: { tokenId: arb.noTokenId, side: "BUY", price: arb.bestNoAsk, sizeUsd: shares * arb.bestNoAsk, shares },
  };
}

/** Decide-and-act on a single arb candidate. Always logs to evolution_log. */
export async function executeSingleMarketArb(arb: SingleMarketArb, opts: { sizeUsd?: number; agentId?: number; strategyId?: number } = {}): Promise<ExecuteVerdict> {
  const mode = readMode();
  const maxTrade = readMaxTradeUsd();
  const maxDaily = readMaxDailyUsd();
  const requestedSize = Math.min(opts.sizeUsd ?? Math.min(arb.expectedProfitUsd * 5, maxTrade), maxTrade);
  let planned;
  try {
    planned = planLegs(arb, requestedSize);
  } catch (err) {
    insertEvolutionEvent({
      agent_id: opts.agentId, strategy_id: opts.strategyId,
      event_type: "arb-rejected", summary: `Plan failed: ${(err as Error).message}`,
      payload_json: JSON.stringify({ arb, requestedSize }),
    });
    return { kind: "rejected", reason: (err as Error).message };
  }
  const totalCost = planned.yes.sizeUsd + planned.no.sizeUsd;
  if (totalCost > maxTrade) {
    insertEvolutionEvent({
      agent_id: opts.agentId, strategy_id: opts.strategyId,
      event_type: "arb-rejected", summary: `Plan exceeds MAX_TRADE_USD ($${totalCost.toFixed(2)} > $${maxTrade})`,
      payload_json: JSON.stringify({ planned, totalCost }),
    });
    return { kind: "rejected", reason: `trade cap` };
  }
  const dailySpent = dailyExecutedUsd();
  if (dailySpent + totalCost > maxDaily) {
    insertEvolutionEvent({
      agent_id: opts.agentId, strategy_id: opts.strategyId,
      event_type: "arb-rejected", summary: `Plan exceeds MAX_DAILY_USD ($${(dailySpent + totalCost).toFixed(2)} > $${maxDaily})`,
      payload_json: JSON.stringify({ planned, dailySpent, totalCost }),
    });
    return { kind: "rejected", reason: "daily cap" };
  }

  if (mode === "DRY_RUN") {
    const reason = `ALLOW_TRADE!=1 → not submitting; planned cost $${totalCost.toFixed(2)}, expected edge $${arb.expectedProfitUsd.toFixed(2)}`;
    insertEvolutionEvent({
      agent_id: opts.agentId, strategy_id: opts.strategyId,
      event_type: "arb-dry-run", summary: `DRY: ${arb.question.slice(0, 60)} — buy ${planned.yes.shares}sh`,
      payload_json: JSON.stringify({ planned, arb, cost_usd: totalCost, expected_edge_usd: arb.expectedProfitUsd }),
    });
    return { kind: "dry-run", reason, planned, capUsed: { trade: totalCost, daily: dailySpent + totalCost } };
  }

  // LIVE path — submit both legs as FOK market orders.
  insertEvolutionEvent({
    agent_id: opts.agentId, strategy_id: opts.strategyId,
    event_type: "arb-submitting", summary: `Submitting: ${arb.question.slice(0, 60)} — ${planned.yes.shares}sh basket`,
    payload_json: JSON.stringify({ planned, arb, cost_usd: totalCost }),
  });

  try {
    const client = await getClobClient();
    const opt = { tickSize: "0.01", negRisk: false };
    const [yesResp, noResp] = await Promise.all([
      client.createAndPostMarketOrder({ tokenID: planned.yes.tokenId, amount: planned.yes.sizeUsd, side: "BUY", price: planned.yes.price }, opt, "FOK"),
      client.createAndPostMarketOrder({ tokenID: planned.no.tokenId, amount: planned.no.sizeUsd, side: "BUY", price: planned.no.price }, opt, "FOK"),
    ]);
    const allOk = (yesResp?.success ?? true) && (noResp?.success ?? true);
    insertEvolutionEvent({
      agent_id: opts.agentId, strategy_id: opts.strategyId,
      event_type: allOk ? "arb-executed" : "arb-partial",
      summary: `${allOk ? "EXEC" : "PARTIAL"}: ${arb.question.slice(0, 60)}`,
      payload_json: JSON.stringify({ planned, yes: yesResp, no: noResp, cost_usd: totalCost }),
    });
    return { kind: "executed", orders: [yesResp, noResp], planned };
  } catch (err) {
    insertEvolutionEvent({
      agent_id: opts.agentId, strategy_id: opts.strategyId,
      event_type: "arb-error", summary: `Submission failure: ${(err as Error).message.slice(0, 100)}`,
      payload_json: JSON.stringify({ planned, error: (err as Error).message }),
    });
    return { kind: "rejected", reason: (err as Error).message };
  }
}

/** Emergency: cancel every open order for the signer. Always allowed (defensive). */
export async function killSwitch(): Promise<{ ok: boolean; result?: any; error?: string }> {
  try {
    const client = await getClobClient();
    const result = await client.cancelAll();
    insertEvolutionEvent({ event_type: "kill-switch", summary: "cancelAll() invoked", payload_json: JSON.stringify({ result }) });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export const safety = {
  mode: readMode,
  maxTrade: readMaxTradeUsd,
  maxDaily: readMaxDailyUsd,
  dailyExecutedUsd,
};
