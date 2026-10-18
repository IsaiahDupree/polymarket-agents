/**
 * Agent UP-probability inference for a specific binary window.
 *
 * For every agent on the high-pnl page, given (agent, binary window),
 * return the agent's current predicted P(UP) so the operator can compare
 * MARKET vs every AGENT in one panel. Composite agents return both an
 * aggregate prediction AND each sub-strategy's individual prediction.
 *
 * This is NOT a call to decide() — decide() returns a BUY/SELL/HOLD action
 * tied to position state. We want the agent's *current belief* on this
 * specific market regardless of whether they'd act.
 *
 * Per-kind mapping is intentionally simple — heuristic projections of each
 * strategy's primary signal onto a probability scale, with a confidence
 * indicator. Returns null for kinds that have no opinion on a 5-min binary.
 */
import { db } from "@/lib/db/client";
import type { BinaryWindow } from "./binary-window";
import type { Genome, SubGenome } from "./genome";
import { loadRecentCandles, velocity, acceleration, type Candle } from "./momentum";
import { peekOracleCache } from "./llm-oracle";
import { assetToFeed, type BinaryAsset } from "./short-binaries";

export type Confidence = "high" | "medium" | "low" | "none";

export type SubPrediction = {
  kind: string;
  upProb: number | null;
  confidence: Confidence;
  rationale: string;
};

export type AgentPrediction = {
  upProb: number | null;
  confidence: Confidence;
  rationale: string;
  subs?: SubPrediction[];
};

type Tick = { ts_unix: number; price: number };

/**
 * Read sub-minute price history from realtime_ticks for a CB product, sorted
 * ascending. Returns at most `limit` ticks from the last `windowMin` minutes.
 * Returns null when no ticks exist (caller falls back to 1-min candles).
 */
function readRecentTicks(productId: string, windowMin = 10, limit = 600): Tick[] | null {
  const rows = db()
    .prepare(
      `SELECT ts_unix, price FROM realtime_ticks
      WHERE product_id = ? AND ts_unix >= strftime('%s','now','-' || ? || ' minutes')
      ORDER BY ts_unix DESC
      LIMIT ?`,
    )
    .all(productId, windowMin, limit) as Tick[];
  if (rows.length === 0) return null;
  return rows.reverse();
}

/**
 * Velocity from sub-minute ticks: (last - lookback) / lookback over the last
 * `windowMin` minutes. Returns NaN when too few ticks available.
 */
function tickVelocity(ticks: Tick[], windowMin: number): number {
  if (ticks.length < 2) return NaN;
  const last = ticks[ticks.length - 1];
  const cutoff = last.ts_unix - windowMin * 60;
  // First tick at-or-after the cutoff
  let lookback = ticks[0];
  for (const t of ticks) {
    if (t.ts_unix >= cutoff) {
      lookback = t;
      break;
    }
  }
  if (lookback.price <= 0) return NaN;
  return (last.price - lookback.price) / lookback.price;
}

/** Convert a velocity reading to P(UP) — saturating to ±35pp at the entry
 *  threshold, capped to [0.05, 0.95]. */
function velocityToProb(v: number, threshold: number): number {
  if (!Number.isFinite(v) || threshold <= 0) return 0.5;
  const norm = Math.max(-1, Math.min(1, v / threshold));
  return Math.max(0.05, Math.min(0.95, 0.5 + norm * 0.35));
}

function clampProb(p: number): number {
  return Math.max(0.05, Math.min(0.95, p));
}

function isBinaryAsset(asset: string): asset is BinaryAsset {
  return ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "HYPE"].includes(asset);
}

function noOpinion(kind: string, reason: string): SubPrediction {
  return { kind, upProb: null, confidence: "none", rationale: reason };
}

function predictForKind(g: SubGenome | Genome, win: BinaryWindow): SubPrediction {
  switch ((g as any).kind) {
    case "poly_short_binary_directional": {
      // Prefer realtime_ticks (sub-minute resolution) over 1-min candles so
      // the prediction ticks live with the WS feed. Falls back to candles
      // when no realtime ticks exist for the product.
      if (!isBinaryAsset(win.asset)) return noOpinion(g.kind, "asset not in CB universe");
      const feed = assetToFeed(win.asset as BinaryAsset);
      if (!feed) return noOpinion(g.kind, `no CB feed for ${win.asset}`);
      const params = (g as any).params;
      const ticks = readRecentTicks(feed.instrument, Math.max(params.vel_window_min + 2, 10));
      if (ticks && ticks.length >= 4) {
        const v = tickVelocity(ticks, params.vel_window_min);
        if (Number.isFinite(v)) {
          const fires = Math.abs(v) >= params.vel_entry_pct;
          return {
            kind: g.kind,
            upProb: velocityToProb(v, params.vel_entry_pct),
            confidence: fires ? "high" : "medium",
            rationale: `tick-vel=${(v * 100).toFixed(3)}% (gate ${(params.vel_entry_pct * 100).toFixed(2)}%) · ${ticks.length} ticks`,
          };
        }
      }
      const candles = loadRecentCandles(feed.instrument, Math.max(params.vel_window_min * 2 + 5, 30));
      if (candles.length < params.vel_window_min + 2) return noOpinion(g.kind, `${candles.length} candles, need ${params.vel_window_min + 2}`);
      const v = velocity(candles, params.vel_window_min);
      const a = acceleration(candles, params.vel_window_min);
      const fires = Math.abs(v) >= params.vel_entry_pct;
      return {
        kind: g.kind,
        upProb: velocityToProb(v, params.vel_entry_pct),
        confidence: fires ? "high" : "medium",
        rationale: `vel=${(v * 100).toFixed(3)}% (gate ${(params.vel_entry_pct * 100).toFixed(2)}%) accel=${(a * 100).toFixed(3)}%`,
      };
    }
    case "cb_momentum_burst": {
      // Same velocity reading but on the strategy's selected product, not the
      // binary's asset. If they don't match, this agent has no opinion on this
      // specific binary.
      const params = (g as any).params;
      const productSymbol = String(params.product_id).replace("-USD", "");
      if (productSymbol !== win.asset) {
        return noOpinion(g.kind, `agent tracks ${params.product_id}, binary is ${win.asset}`);
      }
      const candles = loadRecentCandles(params.product_id, Math.max(params.vel_window_min * 2 + 5, 30));
      if (candles.length < params.vel_window_min + 2) return noOpinion(g.kind, `${candles.length} candles`);
      const v = velocity(candles, params.vel_window_min);
      const fires = Math.abs(v) >= params.vel_entry_pct;
      return {
        kind: g.kind,
        upProb: velocityToProb(v, params.vel_entry_pct),
        confidence: fires ? "high" : "medium",
        rationale: `momentum v=${(v * 100).toFixed(3)}%`,
      };
    }
    case "cb_breakout": {
      const params = (g as any).params;
      const productSymbol = String(params.product_id).replace("-USD", "");
      if (productSymbol !== win.asset) return noOpinion(g.kind, `agent tracks ${params.product_id}`);
      const candles = loadRecentCandles(params.product_id, params.lookback_min);
      if (candles.length < 6) return noOpinion(g.kind, `${candles.length} candles`);
      const closes = candles.map((c: Candle) => c.close);
      const recentMax = Math.max(...closes.slice(0, -1));
      const last = closes[closes.length - 1];
      const ratio = recentMax > 0 ? last / recentMax : 1;
      const fires = ratio > params.breakout_mult;
      return {
        kind: g.kind,
        upProb: clampProb(0.5 + (ratio - 1) * 5),
        confidence: fires ? "high" : "low",
        rationale: `last/max=${ratio.toFixed(4)} (gate ${params.breakout_mult.toFixed(3)})`,
      };
    }
    case "cb_mean_reversion": {
      const params = (g as any).params;
      const productSymbol = String(params.product_id).replace("-USD", "");
      if (productSymbol !== win.asset) return noOpinion(g.kind, `agent tracks ${params.product_id}`);
      const candles = loadRecentCandles(params.product_id, params.lookback_min);
      if (candles.length < 12) return noOpinion(g.kind, `${candles.length} candles`);
      const closes = candles.map((c: Candle) => c.close);
      const mean = closes.reduce((a: number, b: number) => a + b, 0) / closes.length;
      const variance = closes.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / closes.length;
      const sd = Math.sqrt(variance);
      if (sd <= 0) return noOpinion(g.kind, "zero variance");
      const z = (closes[closes.length - 1] - mean) / sd;
      // mean-reversion fades: if z >> 0 (overpriced) → bet DOWN; z << 0 → bet UP.
      const upProb = clampProb(0.5 - z * 0.15);
      const fires = Math.abs(z) >= params.z_entry;
      return {
        kind: g.kind,
        upProb,
        confidence: fires ? "high" : "medium",
        rationale: `z=${z.toFixed(2)} → fade ${z > 0 ? "DOWN" : "UP"}`,
      };
    }
    case "cb_orderbook_imbalance": {
      const params = (g as any).params;
      const productSymbol = String(params.product_id).replace("-USD", "");
      if (productSymbol !== win.asset) return noOpinion(g.kind, `agent tracks ${params.product_id}`);
      const row = db()
        .prepare(
          `SELECT imbalance_ratio, total_bid_usd, total_ask_usd, captured_at
           FROM coinbase_l2_snapshots
          WHERE product_id = ?
          ORDER BY captured_at DESC
          LIMIT 1`,
        )
        .get(params.product_id) as { imbalance_ratio: number; total_bid_usd: number; total_ask_usd: number; captured_at: string } | undefined;
      if (!row) return noOpinion(g.kind, "no L2 snapshot yet — run snapshot:cb-depth");
      const totalDepth = row.total_bid_usd + row.total_ask_usd;
      const fires = Math.abs(row.imbalance_ratio - 0.5) >= params.imbalance_threshold && totalDepth >= params.min_total_depth_usd;
      // Direct identity — ratio is P(bid-side wins) which ≈ P(price rises).
      return {
        kind: g.kind,
        upProb: clampProb(row.imbalance_ratio),
        confidence: fires ? "high" : totalDepth >= params.min_total_depth_usd ? "medium" : "low",
        rationale: `L2 ratio=${(row.imbalance_ratio * 100).toFixed(1)}% depth=$${totalDepth.toFixed(0)}`,
      };
    }
    case "cb_trade_flow_burst": {
      const params = (g as any).params;
      const productSymbol = String(params.product_id).replace("-USD", "");
      if (productSymbol !== win.asset) return noOpinion(g.kind, `agent tracks ${params.product_id}`);
      const recentCutoff = new Date(Date.now() - params.arrival_window_min * 60_000).toISOString().slice(0, 19).replace("T", " ");
      const rows = db()
        .prepare(
          `SELECT side, size_usd FROM coinbase_trades
          WHERE product_id = ? AND trade_time >= ?`,
        )
        .all(params.product_id, recentCutoff) as Array<{ side: string; size_usd: number }>;
      if (rows.length === 0) return noOpinion(g.kind, "no trades yet — run snapshot:cb-trades");
      let buyUsd = 0, sellUsd = 0;
      for (const r of rows) {
        if (r.side === "BUY") buyUsd += r.size_usd;
        else sellUsd += r.size_usd;
      }
      const total = buyUsd + sellUsd;
      if (total <= 0) return noOpinion(g.kind, "zero notional");
      const buyFrac = buyUsd / total;
      const fires = buyFrac >= params.buy_pressure_min || 1 - buyFrac >= params.buy_pressure_min;
      return {
        kind: g.kind,
        upProb: clampProb(buyFrac),
        confidence: fires ? "high" : "medium",
        rationale: `flow buy=${(buyFrac * 100).toFixed(0)}% over ${params.arrival_window_min}m (${rows.length} trades)`,
      };
    }
    case "llm_probability_oracle": {
      const params = (g as any).params;
      // Try the cache keyed by the binary's condition_id. The oracle is fed
      // poly markets, not binaries directly — cache hits will only fire
      // when warmOracleCacheForTick has touched this market.
      const cached = peekOracleCache(win.upTokenId, params.prompt_version);
      if (!cached) return noOpinion(g.kind, "oracle cache miss for this market");
      return {
        kind: g.kind,
        upProb: clampProb(cached.probability),
        confidence: (cached.confidence as Confidence) ?? "medium",
        rationale: `LLM p=${(cached.probability * 100).toFixed(1)}% (${params.model})`,
      };
    }
    case "poly_fade_spike": {
      // Fade-spike on a binary: read recent move from realtime_ticks (or fall
      // back to candles) and bet against it.
      if (!isBinaryAsset(win.asset)) return noOpinion(g.kind, "asset not in CB universe");
      const feed = assetToFeed(win.asset as BinaryAsset);
      if (!feed) return noOpinion(g.kind, `no CB feed for ${win.asset}`);
      const ticks = readRecentTicks(feed.instrument, 10);
      let first: number, last: number, source: string;
      if (ticks && ticks.length >= 2) {
        first = ticks[0].price;
        last = ticks[ticks.length - 1].price;
        source = `${ticks.length}t`;
      } else {
        const candles = loadRecentCandles(feed.instrument, 10);
        if (candles.length < 2) return noOpinion(g.kind, "no candles");
        first = candles[0].close;
        last = candles[candles.length - 1].close;
        source = `${candles.length}c`;
      }
      if (first <= 0) return noOpinion(g.kind, "zero open");
      const moveBps = ((last - first) / first) * 10_000; // 1 bp = 0.01%
      // Fade: large UP move → bet DOWN. Saturate at 200 bp = ~strong fade.
      const norm = Math.max(-1, Math.min(1, moveBps / 200));
      return {
        kind: g.kind,
        upProb: clampProb(0.5 - norm * 0.30),
        confidence: Math.abs(moveBps) > 50 ? "high" : "medium",
        rationale: `move=${moveBps.toFixed(0)}bp (${source}) → fade ${moveBps > 0 ? "DOWN" : "UP"}`,
      };
    }
    case "poly_binary_arbitrage": {
      const params = (g as any).params;
      const tilt = params.direction_bias;
      const ratio = params.tilt_ratio;
      const upWeight = tilt === "tilt_up" ? ratio : 1;
      const downWeight = tilt === "tilt_down" ? ratio : 1;
      const effectiveUp = upWeight / (upWeight + downWeight);
      return {
        kind: g.kind,
        upProb: effectiveUp,
        confidence: "medium",
        rationale: `arb ${tilt} · effective UP=${(effectiveUp * 100).toFixed(0)}% · combined≤${(params.max_combined_price * 100).toFixed(0)}%`,
      };
    }
    case "poly_binary_repricing": {
      if (!isBinaryAsset(win.asset)) return noOpinion(g.kind, "asset not in CB universe");
      const feed = assetToFeed(win.asset as BinaryAsset);
      if (!feed) return noOpinion(g.kind, `no CB feed for ${win.asset}`);
      const params = (g as any).params;
      const ticks = readRecentTicks(feed.instrument, params.bs_vol_window_min);
      let v: number;
      if (ticks && ticks.length >= 4) {
        v = tickVelocity(ticks, params.bs_vol_window_min);
      } else {
        const candles = loadRecentCandles(feed.instrument, params.bs_vol_window_min + 5);
        if (candles.length < 4) return noOpinion(g.kind, `${candles.length} candles`);
        v = (candles[candles.length - 1].close - candles[0].close) / candles[0].close;
      }
      if (!Number.isFinite(v)) return noOpinion(g.kind, "velocity NaN");
      const norm = Math.max(-1, Math.min(1, v / params.vel_sat_pct));
      const implied = clampProb(0.5 + norm * 0.45);
      return {
        kind: g.kind,
        upProb: implied,
        confidence: Math.abs(norm) > 0.5 ? "high" : "medium",
        rationale: `repricing implied=${(implied * 100).toFixed(0)}% (vel=${(v * 100).toFixed(3)}% / sat ${(params.vel_sat_pct * 100).toFixed(2)}%)`,
      };
    }
    case "poly_late_window_scalp": {
      const params = (g as any).params;
      // Direction inference: at this layer we don't know which side (UP/DOWN)
      // is near-cert without reading both order books. Project a neutral 0.5
      // until the executor side fires (where the actual ask gate runs).
      return {
        kind: g.kind,
        upProb: 0.5,
        confidence: "low",
        rationale: `late-scalp · waits for ask∈[${(params.min_ask * 100).toFixed(0)},${(params.max_ask * 100).toFixed(0)}]% in last ${params.max_remaining_sec}s`,
      };
    }
    case "poly_cross_market_zscore": {
      const params = (g as any).params;
      // Look for a 5M and 15M binary on this asset; compute the spread and
      // surface a directional prediction toward whichever side the LEADER
      // (most-extreme midpoint) sits. No spread history at prediction time —
      // confidence stays medium unless we see a strong extreme.
      const rows = db()
        .prepare(
          `SELECT token_id, duration_kind FROM poly_binaries
          WHERE settled = 0 AND asset = ?
            AND duration_kind IN ('5M','15M')
            AND strftime('%s', expiry_iso) > strftime('%s','now')
          ORDER BY expiry_iso ASC LIMIT 6`,
        )
        .all(win.asset) as Array<{ token_id: string; duration_kind: string }>;
      const withMid = rows.map((r) => {
        const m = db().prepare("SELECT midpoint FROM market_snapshots WHERE token_id = ? ORDER BY captured_at DESC LIMIT 1").get(r.token_id) as { midpoint: number } | undefined;
        return { ...r, price: m?.midpoint ?? null };
      });
      const five = withMid.find((r) => r.duration_kind === "5M" && r.price != null);
      const fifteen = withMid.find((r) => r.duration_kind === "15M" && r.price != null);
      if (!five || !fifteen) return noOpinion(g.kind, "missing 5M/15M pair for asset");
      const mid5 = five.price!;
      const mid15 = fifteen.price!;
      const spread = mid5 - mid15;
      const z = spread / 0.03; // matches sim.ts SPREAD_SIGMA
      // Predicted UP for the binary panel's window: lean toward the leader's side.
      const leaderMid = Math.abs(mid5 - 0.5) >= Math.abs(mid15 - 0.5) ? mid5 : mid15;
      const upProb = clampProb(leaderMid);
      return {
        kind: g.kind,
        upProb,
        confidence: Math.abs(z) >= params.z_threshold ? "high" : "medium",
        rationale: `zsp 5m@${(mid5 * 100).toFixed(0)}% 15m@${(mid15 * 100).toFixed(0)}% z=${z.toFixed(2)}`,
      };
    }
    case "poly_consensus_follow": {
      const params = (g as any).params;
      // Look up the latest consensus signal for this binary's market. If
      // one exists and clears thresholds, project UP based on direction.
      const rows = db()
        .prepare(
          `SELECT payload_json FROM evolution_log
          WHERE event_type = 'consensus-signal'
            AND payload_json LIKE '%' || ? || '%'
            AND created_at >= datetime('now', '-' || ? || ' seconds')
          ORDER BY id DESC LIMIT 1`,
        )
        .all(win.conditionId, params.max_signal_age_sec) as Array<{ payload_json: string }>;
      if (rows.length === 0) return noOpinion(g.kind, "no fresh consensus for this market");
      let p: any;
      try {
        p = JSON.parse(rows[0].payload_json);
      } catch {
        return noOpinion(g.kind, "payload parse error");
      }
      if ((p.effectiveWallets ?? 0) < params.min_effective_wallets) return noOpinion(g.kind, "wallets below threshold");
      if ((p.combinedTrust ?? 0) < params.min_combined_trust) return noOpinion(g.kind, "trust below threshold");
      if ((p.combinedUsd ?? 0) < params.min_combined_usd) return noOpinion(g.kind, "usd below threshold");
      const dir = String(p.direction ?? "").toUpperCase();
      const upProb = dir === "UP" || dir === "YES" || dir === "BUY" ? 0.75 : 0.25;
      return {
        kind: g.kind,
        upProb,
        confidence: "high",
        rationale: `consensus ${dir} · wallets=${p.effectiveWallets} trust=${p.combinedTrust} $${p.combinedUsd}`,
      };
    }
    case "poly_breakout":
    case "polymarket_market_maker":
    case "wallet_copy_filtered":
    case "category_specialist":
    case "cross_venue_arb":
    case "random_walk_baseline":
      // These don't have a clean projection onto a 5-min binary — declare no opinion.
      return noOpinion(g.kind, "strategy doesn't project to short binaries");
    default:
      // SubGenome union excludes multi_strategy, but predictForKind also
      // receives top-level Genomes (via the non-composite path of predictAgent).
      // Treat anything we don't handle above as no-opinion.
      return noOpinion((g as any).kind ?? "unknown", "unknown kind");
  }
}

export function predictAgent(genome: Genome, win: BinaryWindow): AgentPrediction {
  if ((genome as any).kind === "multi_strategy") {
    const params = (genome as any).params;
    const subs = (params.subs as SubGenome[]).map((s) => predictForKind(s, win));
    const valid = subs.filter((s) => s.upProb != null);
    if (valid.length === 0) {
      return {
        upProb: null,
        confidence: "none",
        rationale: "all sub-strategies abstained",
        subs,
      };
    }
    // Weight by confidence: high=1, medium=0.5, low=0.25.
    const w = (c: Confidence) => (c === "high" ? 1 : c === "medium" ? 0.5 : c === "low" ? 0.25 : 0);
    let num = 0, den = 0;
    for (const s of valid) {
      const wi = w(s.confidence);
      num += (s.upProb ?? 0) * wi;
      den += wi;
    }
    const upProb = den > 0 ? num / den : null;
    const maxConf = valid.reduce<Confidence>((acc, s) => (w(s.confidence) > w(acc) ? s.confidence : acc), "low");
    return {
      upProb,
      confidence: maxConf,
      rationale: `${valid.length}/${subs.length} subs voting`,
      subs,
    };
  }
  const sub = predictForKind(genome, win);
  return {
    upProb: sub.upProb,
    confidence: sub.confidence,
    rationale: sub.rationale,
  };
}
