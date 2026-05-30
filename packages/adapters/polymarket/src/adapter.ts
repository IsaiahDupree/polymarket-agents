import {
  executeSingleMarketArb, killSwitch as pmKillSwitch, safety as pmSafety,
  submitSingleSideMarket,
} from "@adapters/polymarket/execute";
import type { SingleMarketArb } from "@adapters/polymarket/arb";
import type { SubmitVerdict, UnifiedOrder, VenueAdapter, VenueCapabilities } from "@core/venue/types";

/**
 * Polymarket adapter — wraps the existing executeSingleMarketArb path so the
 * router-driven and direct paths share the same safety pipeline (ALLOW_TRADE,
 * MAX_TRADE_USD, MAX_DAILY_USD). The router lets you submit an arb basket via
 * the generic UnifiedOrder shape:
 *
 *   {
 *     venue: 'polymarket', type: 'FOK_BASKET',
 *     symbol: '<condition_id>',
 *     metadata: { arb: <SingleMarketArb>, sizeUsd: <USD> },
 *     ...
 *   }
 */
export class PolymarketAdapter implements VenueAdapter {
  readonly name = "polymarket";
  readonly capabilities: VenueCapabilities = {
    market: true,
    limit: false,
    fok: true,
    cancel: false,
    cancelAll: true,
    userChannelWs: false,
  };

  isAvailable(): boolean {
    return Boolean(process.env.POLYMARKET_PRIVATE_KEY);
  }

  async submit(order: UnifiedOrder): Promise<SubmitVerdict> {
    if (order.type === "MARKET") return submitMarket(order);
    if (order.type === "FOK_BASKET") return submitFokBasket(order);
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: `polymarket adapter only supports type=MARKET or FOK_BASKET (got ${order.type})`,
      usdEquivalent: order.refPrice * order.size || 0,
    };
  }

  async cancel(_brokerOrderId: string): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: "polymarket adapter does not support single-order cancel (FOK only)" };
  }

  async cancelAll(): Promise<{ ok: boolean; cancelled: number; error?: string; raw?: unknown }> {
    const result = await pmKillSwitch();
    if (!result.ok) return { ok: false, cancelled: 0, error: result.error };
    return { ok: true, cancelled: result.result?.canceled?.length ?? 0, raw: result.result };
  }

  async health() {
    return {
      ok: this.isAvailable(),
      name: this.name,
      details: {
        mode: pmSafety.mode(),
        max_trade_usd: pmSafety.maxTrade(),
        max_daily_usd: pmSafety.maxDaily(),
        daily_executed_usd: pmSafety.dailyExecutedUsd(),
      },
    };
  }
}

function extractBasketId(orders: any[]): string | undefined {
  const ids = (orders ?? [])
    .map((o) => o?.orderID ?? o?.order_id ?? o?.id)
    .filter(Boolean) as string[];
  return ids.length ? ids.join("|") : undefined;
}

async function submitMarket(order: UnifiedOrder): Promise<SubmitVerdict> {
  const intent = (order.metadata?.intent as "entry" | "exit" | undefined) ?? "entry";
  const noTokenId = order.metadata?.no_token_id as string | undefined;

  let tokenId = order.symbol;
  let side: "BUY" | "SELL" = order.side;
  if (intent === "entry" && order.side === "SELL" && noTokenId) {
    tokenId = noTokenId;
    side = "BUY";
  }

  const sizeUsd = Number(order.metadata?.sizeUsd ?? order.size);
  const shares = side === "SELL" ? Number(order.size) : undefined;
  const refPrice = order.refPrice > 0 ? order.refPrice : 0.5;

  const verdict = await submitSingleSideMarket({
    tokenId,
    side,
    sizeUsd,
    shares,
    refPrice,
    agentId: order.agentId,
    strategyId: order.strategyId,
    rationale: (order.metadata?.rationale as string | undefined) ?? "arena-live",
  });

  if (verdict.kind === "dry-run") {
    return { ok: true, status: "dry_run", reason: verdict.reason, usdEquivalent: verdict.capUsed.trade };
  }
  if (verdict.kind === "executed") {
    return {
      ok: true,
      status: "filled",
      brokerOrderId: verdict.brokerOrderId,
      raw: verdict.raw,
      usdEquivalent: side === "BUY" ? sizeUsd : Number(shares ?? 0) * refPrice,
    };
  }
  return { ok: false, code: "ADAPTER_ERROR", reason: verdict.reason };
}

async function submitFokBasket(order: UnifiedOrder): Promise<SubmitVerdict> {
  const arb = order.metadata?.arb as SingleMarketArb | undefined;
  if (!arb) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: "polymarket FOK_BASKET requires metadata.arb (SingleMarketArb)",
    };
  }
  const sizeUsd = Number(order.metadata?.sizeUsd ?? order.size);
  const verdict = await executeSingleMarketArb(arb, {
    sizeUsd,
    agentId: order.agentId,
    strategyId: order.strategyId,
  });

  if (verdict.kind === "dry-run") {
    return { ok: true, status: "dry_run", reason: verdict.reason, usdEquivalent: verdict.capUsed.trade };
  }
  if (verdict.kind === "executed") {
    return {
      ok: true,
      brokerOrderId: extractBasketId(verdict.orders),
      status: "filled",
      raw: verdict,
      usdEquivalent: verdict.planned.yes.sizeUsd + verdict.planned.no.sizeUsd,
    };
  }
  return { ok: false, code: "ADAPTER_ERROR", reason: verdict.reason };
}
