/**
 * Match agents to live opportunity events from `evolution_log`.
 *
 * Producers (already running in this codebase):
 *   - late-window-scalp-opportunity   (observe:late-window-scalp)
 *   - near-resolution-opportunity     (worker:near-resolution-scrape)
 *   - cross-timeframe-opportunity     (worker:cross-timeframe-spread)
 *   - orderbook-imbalance-signal      (worker:obi-watch)
 *   - consensus-signal                (worker:consensus)
 *
 * The matcher does NOT re-fetch live order books — it shows prices + depth
 * captured at scan time and labels everything with an age stamp.
 *
 * EV + Kelly stake suggestions are computed from the cached price + the
 * strategy's own claimed edge. Quarter-Kelly is the default sizing line.
 */
import { db } from "@/lib/db/client";
import type { Genome } from "./genome";

export type OpportunityEventType =
  | "late-window-scalp-opportunity"
  | "near-resolution-opportunity"
  | "cross-timeframe-opportunity"
  | "orderbook-imbalance-signal"
  | "consensus-signal";

export type RecentOpportunity = {
  id: number;
  createdAt: string;
  ageSec: number;
  eventType: string;
  conditionId: string | null;
  marketTitle: string | null;
  side: string;
  entryPrice: number | null;
  edge: number | null;
  bidDepthUsd: number | null;
  askDepthUsd: number | null;
  extras: Record<string, unknown>;
};

export type StakeSuggestion = {
  betUsd: number;
  ev: number | null;
  evPerDollar: number | null;
  pTrue: number | null;
  sharesAtPrice: number | null;
  fullKellyFraction: number | null;
  quarterKellyUsd: number | null;
  notes: string[];
};

export type AgentMatch = {
  opportunity: RecentOpportunity;
  suggestion: StakeSuggestion;
};

export function compatibleEventTypes(genome: Genome): Set<string> {
  const collect = (kind: string): string[] => {
    switch (kind) {
      case "poly_short_binary_directional":
        return ["near-resolution-opportunity", "orderbook-imbalance-signal", "consensus-signal", "late-window-scalp-opportunity", "cross-timeframe-opportunity"];
      case "poly_fade_spike":
        return ["orderbook-imbalance-signal", "consensus-signal"];
      case "polymarket_market_maker":
        return ["orderbook-imbalance-signal"];
      case "poly_breakout":
        return ["cross-timeframe-opportunity"];
      case "llm_probability_oracle":
        return ["near-resolution-opportunity", "orderbook-imbalance-signal", "consensus-signal", "late-window-scalp-opportunity"];
      case "category_specialist":
        return ["near-resolution-opportunity", "consensus-signal", "late-window-scalp-opportunity"];
      case "wallet_copy_filtered":
        return ["consensus-signal"];
      default:
        return [];
    }
  };
  if ((genome as any).kind === "multi_strategy") {
    const out = new Set<string>();
    for (const sub of (genome as any).params.subs) {
      for (const e of collect(sub.kind)) out.add(e);
    }
    return out;
  }
  return new Set(collect(genome.kind));
}

export function readRecentOpportunities(maxAgeMin = 30): RecentOpportunity[] {
  const cutoff = new Date(Date.now() - maxAgeMin * 60_000).toISOString();
  const rows = db()
    .prepare(
      `SELECT id, created_at, event_type, payload_json
       FROM evolution_log
      WHERE event_type IN (
              'late-window-scalp-opportunity',
              'near-resolution-opportunity',
              'cross-timeframe-opportunity',
              'orderbook-imbalance-signal',
              'consensus-signal'
            )
        AND created_at >= ?
      ORDER BY id DESC
      LIMIT 200`,
    )
    .all(cutoff) as Array<{ id: number; created_at: string; event_type: string; payload_json: string }>;
  const nowMs = Date.now();
  const out: RecentOpportunity[] = [];
  for (const row of rows) {
    let payload: any;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      continue;
    }
    const tsParsed = row.created_at.includes("T") ? row.created_at : row.created_at.replace(" ", "T") + "Z";
    const ageSec = Math.max(0, Math.floor((nowMs - Date.parse(tsParsed)) / 1000));
    const norm = normalizePayload(row.event_type, payload);
    out.push({
      id: row.id,
      createdAt: row.created_at,
      ageSec,
      eventType: row.event_type,
      ...norm,
    });
  }
  return out;
}

function normalizePayload(eventType: string, p: any): Omit<RecentOpportunity, "id" | "createdAt" | "ageSec" | "eventType"> {
  const str = (k: string): string | null => (typeof p[k] === "string" ? p[k] : null);
  const num = (k: string): number | null => {
    const v = p[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  switch (eventType) {
    case "late-window-scalp-opportunity":
      return {
        conditionId: str("conditionId"),
        marketTitle: str("title") ?? str("marketTitle"),
        side: (str("side") ?? "").toUpperCase(),
        entryPrice: num("entry_price"),
        edge: num("payoff_per_share"),
        bidDepthUsd: null,
        askDepthUsd: num("capital_required_usd"),
        extras: {
          max_shares: num("max_shares"),
          max_payoff_usd: num("max_payoff_usd"),
          remaining_sec: num("remaining_sec"),
          token_id: str("token_id"),
          asset: str("asset"),
        },
      };
    case "near-resolution-opportunity":
      return {
        conditionId: str("conditionId") ?? str("marketKey"),
        marketTitle: str("marketTitle"),
        side: (str("side") ?? "").toUpperCase(),
        entryPrice: num("entryPrice"),
        edge: num("edge"),
        bidDepthUsd: null,
        askDepthUsd: null,
        extras: {
          annualizedEdge: num("annualizedEdge"),
          daysToResolution: num("daysToResolution"),
        },
      };
    case "orderbook-imbalance-signal": {
      const side = (str("side") ?? "").toUpperCase();
      const ask = num("topAskPrice");
      const bid = num("topBidPrice");
      const entry = side === "BUY" ? ask : side === "SELL" ? bid : ask ?? bid;
      return {
        conditionId: str("conditionId"),
        marketTitle: str("marketTitle"),
        side,
        entryPrice: entry,
        edge: num("edge"),
        bidDepthUsd: num("bidDepthUsd"),
        askDepthUsd: num("askDepthUsd"),
        extras: {
          imbalanceRatio: num("imbalanceRatio"),
          signalStrength: num("signalStrength"),
          reason: str("reason"),
        },
      };
    }
    case "consensus-signal": {
      const direction = str("direction");
      const wallets = Array.isArray(p.wallets) ? p.wallets : [];
      return {
        conditionId: str("marketKey") ?? str("conditionId"),
        marketTitle: str("marketTitle"),
        side: (direction ?? "").toUpperCase(),
        entryPrice: num("avgPrice"),
        edge: null,
        bidDepthUsd: null,
        askDepthUsd: num("combinedUsd"),
        extras: {
          walletCount: wallets.length,
          effectiveWallets: num("effectiveWallets"),
          combinedTrust: num("combinedTrust"),
          combinedUsd: num("combinedUsd"),
        },
      };
    }
    case "cross-timeframe-opportunity":
      return {
        conditionId: str("conditionId") ?? str("marketKey"),
        marketTitle: str("marketTitle"),
        side: (str("side") ?? "").toUpperCase(),
        entryPrice: num("entryPrice"),
        edge: num("edge"),
        bidDepthUsd: null,
        askDepthUsd: null,
        extras: {
          spreadPts: num("spreadPts"),
          shortTimeframe: str("shortTimeframe"),
          longTimeframe: str("longTimeframe"),
        },
      };
    default:
      return {
        conditionId: str("conditionId") ?? str("marketKey"),
        marketTitle: str("marketTitle"),
        side: (str("side") ?? "").toUpperCase(),
        entryPrice: num("entryPrice") ?? num("entry_price"),
        edge: num("edge"),
        bidDepthUsd: null,
        askDepthUsd: null,
        extras: {},
      };
  }
}

export function matchAgentToOpportunities(genome: Genome, opps: RecentOpportunity[]): RecentOpportunity[] {
  const compat = compatibleEventTypes(genome);
  if (compat.size === 0) return [];
  return opps.filter((o) => compat.has(o.eventType));
}

export function suggestStake(opp: RecentOpportunity, betUsd: number, bankrollUsd: number): StakeSuggestion {
  const notes: string[] = [];
  const price = opp.entryPrice;
  if (price == null || price <= 0 || price >= 1) {
    return {
      betUsd,
      ev: null,
      evPerDollar: null,
      pTrue: null,
      sharesAtPrice: null,
      fullKellyFraction: null,
      quarterKellyUsd: null,
      notes: ["No price captured at scan time — EV and Kelly cannot be computed."],
    };
  }
  const isBuy = ["BUY", "UP", "YES"].includes(opp.side);
  const isSell = ["SELL", "DOWN", "NO"].includes(opp.side);
  if (!isBuy && !isSell) {
    notes.push(`Unknown side='${opp.side}' — assuming BUY semantics.`);
  }
  const edge = opp.edge ?? 0;
  let pTrue: number;
  if (isSell) {
    pTrue = Math.max(0.001, Math.min(0.999, price - edge));
    pTrue = 1 - pTrue;
    notes.push(`SELL side: P(win) ≈ 1 − (price − edge) = ${(pTrue * 100).toFixed(1)}%`);
  } else {
    pTrue = Math.max(0.001, Math.min(0.999, price + edge));
    notes.push(`BUY side: P(win) ≈ price + edge = ${(pTrue * 100).toFixed(1)}%`);
  }
  const shares = betUsd / price;
  const ev = shares * (pTrue * 1 - price);
  const evPerDollar = betUsd > 0 ? ev / betUsd : 0;
  const b = (1 - price) / price;
  const q = 1 - pTrue;
  let kelly = (b * pTrue - q) / b;
  if (!Number.isFinite(kelly)) kelly = 0;
  kelly = Math.max(0, Math.min(1, kelly));
  const quarterKellyUsd = Math.max(0, bankrollUsd * 0.25 * kelly);
  if (edge === 0) notes.push("Edge not provided by strategy — Kelly using price-only prior.");
  if (opp.ageSec > 60) notes.push(`Price was captured ${opp.ageSec}s ago — book may have moved.`);
  return {
    betUsd,
    ev,
    evPerDollar,
    pTrue,
    sharesAtPrice: shares,
    fullKellyFraction: kelly,
    quarterKellyUsd,
    notes,
  };
}

export function buildAgentMatches(agent: { cash_usd_current: number }, genome: Genome, opps: RecentOpportunity[], defaultBetUsd = 5): AgentMatch[] {
  const matches = matchAgentToOpportunities(genome, opps);
  const bankroll = Math.max(1, agent.cash_usd_current);
  return matches.slice(0, 8).map((opportunity) => ({
    opportunity,
    suggestion: suggestStake(opportunity, defaultBetUsd, bankroll),
  }));
}
