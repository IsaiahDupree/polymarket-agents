/**
 * Agent arsenal inventory.
 *
 * For any agent, returns a structured view of what it can *see* (data feeds),
 * what it can *think with* (decision modules), and what it can *do* (strategy
 * detector + genome parameters). Used by /arena/high-pnl-agents to expose the
 * full capability surface so the operator knows what they're arming when
 * staging a capsule.
 *
 * Pure read-only function over a parsed Genome — no DB queries here so the
 * page can call it 50 times without amplifying load.
 */
import { getParamBounds, GENOME_KINDS, type Genome, type GenomeKind, type SubGenome } from "./genome";

export type ArsenalCategory = "data_feed" | "decision_module" | "constraint";

export type ArsenalCapability = {
  category: ArsenalCategory;
  name: string;
  detail: string;
};

export type GenomeParam = {
  key: string;
  value: unknown;
  bounds?: [number, number] | string[];
};

export type AgentArsenal = {
  strategyKind: string;
  strategyLabel: string;
  strategyFamily: string;
  isComposite: boolean;
  subKinds: string[];
  capabilities: ArsenalCapability[];
  genomeParams: GenomeParam[];
};

const STRATEGY_LABELS: Record<string, string> = {
  poly_fade_spike: "Polymarket · fade-spike (mean-reversion on overextended moves)",
  poly_breakout: "Polymarket · breakout (ride moves above recent high)",
  cb_breakout: "Coinbase · breakout (ride spot moves above lookback high)",
  cb_mean_reversion: "Coinbase · mean-reversion (z-score entry / reversion exit)",
  cross_venue_arb: "Cross-venue · poly vs Coinbase implied-prob spread",
  cb_momentum_burst: "Coinbase · short-window momentum + acceleration",
  random_walk_baseline: "Random-walk null hypothesis (control, do-not-promote)",
  category_specialist: "Polymarket · category-filtered fade/breakout",
  wallet_copy_filtered: "Wallet-copy · mirror tracked wallet by category",
  polymarket_market_maker: "Polymarket · single-token market maker (sim-only CLOB)",
  llm_probability_oracle: "LLM probability oracle (Claude estimates P_true → EV/Kelly rail)",
  poly_short_binary_directional: "Polymarket · 5-min binary directional from CB velocity",
  cb_orderbook_imbalance: "Coinbase · orderbook L2 depth-imbalance entry",
  cb_trade_flow_burst: "Coinbase · trade-flow burst (arrival rate + buy/sell pressure)",
  poly_binary_arbitrage: "Polymarket · binary UP+DOWN arbitrage (with optional directional tilt)",
  poly_binary_repricing: "Polymarket · fair-value repricing (Coinbase velocity → implied prob vs poly midpoint)",
  poly_late_window_scalp: "Polymarket · near-resolution scalp (buy 0.95→1.00 convergence in last 30–180s)",
  poly_consensus_follow: "Polymarket · follow consensus-signal events from tracked wallets",
  poly_cross_market_zscore: "Polymarket · cross-market z-score spread (5m vs 15m on same asset)",
  multi_strategy: "Composite · priority-ordered sub-strategies",
};

const STRATEGY_FAMILY: Record<string, string> = {
  poly_fade_spike: "polymarket",
  poly_breakout: "polymarket",
  cb_breakout: "coinbase",
  cb_mean_reversion: "coinbase",
  cross_venue_arb: "cross_venue",
  cb_momentum_burst: "coinbase",
  random_walk_baseline: "baseline",
  category_specialist: "polymarket",
  wallet_copy_filtered: "wallet_copy",
  polymarket_market_maker: "polymarket",
  llm_probability_oracle: "llm",
  poly_short_binary_directional: "polymarket",
  cb_orderbook_imbalance: "coinbase",
  cb_trade_flow_burst: "coinbase",
  poly_binary_arbitrage: "polymarket",
  poly_binary_repricing: "polymarket",
  poly_late_window_scalp: "polymarket",
  poly_consensus_follow: "polymarket",
  poly_cross_market_zscore: "polymarket",
  multi_strategy: "composite",
};

/**
 * Per-strategy data-feed enumeration. Each kind taps a known set of feeds —
 * derived from src/lib/arena/sim.ts decision functions + context builders.
 */
function feedsForKind(kind: string): ArsenalCapability[] {
  switch (kind) {
    case "poly_fade_spike":
    case "poly_breakout":
      return [
        { category: "data_feed", name: "Polymarket midpoint snapshots", detail: "poly_market_snapshots table — price-history over lookback_h" },
        { category: "data_feed", name: "Polymarket market list", detail: "active markets with non-zero size + open trading window" },
      ];
    case "cb_breakout":
    case "cb_mean_reversion":
    case "cb_momentum_burst":
      return [
        { category: "data_feed", name: "Coinbase 1-min candles", detail: "coinbase_candles table — close/volume per minute (worker:snapshot)" },
        { category: "data_feed", name: "Coinbase top-of-book", detail: "coinbase_snapshots — best bid/ask for slippage estimate" },
        { category: "data_feed", name: "Coinbase multi-timeframe candles (accessible)", detail: "cb.getProductCandles — 1m/5m/15m/1h/6h/1d on demand (currently only 1m persisted)" },
        { category: "data_feed", name: "Coinbase orderbook L50 (accessible)", detail: "cb.getProductBook(limit=50) — depth view; persisted to coinbase_l2_snapshots by snapshot:cb-depth worker" },
        { category: "data_feed", name: "Coinbase recent trades (accessible)", detail: "cb.getMarketTrades — time & sales; persisted to coinbase_trades by snapshot:cb-trades worker" },
        { category: "data_feed", name: "Coinbase live WebSocket streams (accessible)", detail: "ticker / level2 / market_trades / candles channels via subscribeCoinbase()" },
        { category: "data_feed", name: "Coinbase 24h product stats (accessible)", detail: "cb.getProduct — 24h volume + price change pct; persisted to coinbase_product_stats" },
      ];
    case "cb_orderbook_imbalance":
      return [
        { category: "data_feed", name: "Coinbase L2 depth snapshots", detail: "coinbase_l2_snapshots — top 10 bid/ask levels per snapshot (snapshot:cb-depth)" },
        { category: "data_feed", name: "Coinbase top-of-book", detail: "coinbase_snapshots — for entry/exit price reference" },
      ];
    case "cb_trade_flow_burst":
      return [
        { category: "data_feed", name: "Coinbase recent trades firehose", detail: "coinbase_trades — every market trade with side + size (snapshot:cb-trades)" },
        { category: "data_feed", name: "Coinbase 1-min candles", detail: "coinbase_candles — for arrival-rate baseline + exit pricing" },
      ];
    case "poly_binary_arbitrage":
      return [
        { category: "data_feed", name: "Polymarket 5-min binaries (UP + DOWN tokens)", detail: "poly_binaries — needs both token_id and no_token_id" },
        { category: "data_feed", name: "Polymarket orderbook (both sides)", detail: "poly.orderbook(token_id) for UP + DOWN best ask + depth" },
        { category: "data_feed", name: "Coinbase 1-min candles", detail: "(for tilt mode) reads velocity to pick the tilted side" },
      ];
    case "poly_binary_repricing":
      return [
        { category: "data_feed", name: "Polymarket 5-min binaries (UP token)", detail: "poly_binaries — UP token midpoint vs implied prob" },
        { category: "data_feed", name: "Coinbase 1-min candles + realtime ticks", detail: "for the binary's underlying asset; computes velocity over bs_vol_window_min" },
        { category: "data_feed", name: "ctx.snapshots (poly mid)", detail: "current poly midpoint to compare against implied prob" },
      ];
    case "poly_late_window_scalp":
      return [
        { category: "data_feed", name: "Polymarket 5-min binaries near expiry", detail: "filters poly_binaries to those with remaining_sec ≤ max_remaining_sec" },
        { category: "data_feed", name: "Polymarket orderbook (UP + DOWN)", detail: "reads best ask to verify it's inside [min_ask, max_ask]" },
        { category: "data_feed", name: "evolution_log late-window-scalp-opportunity events", detail: "if observe:late-window-scalp is running, agent consumes those events directly" },
      ];
    case "poly_consensus_follow":
      return [
        { category: "data_feed", name: "evolution_log consensus-signal events", detail: "fed by worker:consensus from tracked wallet trades" },
        { category: "data_feed", name: "Polymarket orderbook (signal market)", detail: "for entry pricing on the consensus market" },
      ];
    case "poly_cross_market_zscore":
      return [
        { category: "data_feed", name: "Polymarket midpoint history (related markets)", detail: "5m + 15m binaries on the same asset; reads midpoint over baseline_min" },
        { category: "data_feed", name: "ctx.snapshots (poly mid history)", detail: "computes rolling mean + sd of spread between paired contracts" },
      ];
    case "cross_venue_arb":
      return [
        { category: "data_feed", name: "Polymarket midpoint snapshots", detail: "for selected condition_id" },
        { category: "data_feed", name: "Coinbase 1-min candles", detail: "for paired cb_product_id (Black-Scholes implied-prob)" },
        { category: "data_feed", name: "cross_venue_arbs registry", detail: "pre-registered (poly_condition_id, cb_product_id) pairs" },
      ];
    case "category_specialist":
      return [
        { category: "data_feed", name: "Polymarket midpoint snapshots", detail: "filtered by genome.category tag" },
        { category: "data_feed", name: "Market category index", detail: "category-tagged subset of poly_binaries / poly_markets" },
      ];
    case "wallet_copy_filtered":
      return [
        { category: "data_feed", name: "Tracked wallet fills", detail: "polygon trade stream for genome.wallet_address" },
        { category: "data_feed", name: "Wallet category stats", detail: "rolling 30-day win-rate per category for gating" },
        { category: "data_feed", name: "Wallet typology classifier", detail: "src/lib/wallets/typology — copyability bucket" },
      ];
    case "polymarket_market_maker":
      return [{ category: "data_feed", name: "Polymarket orderbook", detail: "for genome.token_id — best bid/ask spread" }];
    case "llm_probability_oracle":
      return [
        { category: "data_feed", name: "Polymarket binaries + question text", detail: "passed to LLM prompt for probability estimation" },
        { category: "data_feed", name: "Recent fills + opportunities", detail: "AgentContext.recentOpportunities / recentTrades fed into prompt" },
      ];
    case "poly_short_binary_directional":
      return [
        { category: "data_feed", name: "Polymarket 5-min binaries", detail: "poly_binaries table — Up/Down markets near expiry" },
        { category: "data_feed", name: "Coinbase 1-min candles", detail: "per-asset velocity (BTC, ETH, SOL, XRP, DOGE)" },
        { category: "data_feed", name: "OKX 1-min candles", detail: "for BNB / HYPE (assets Coinbase lacks)" },
        { category: "data_feed", name: "Coinbase L2 depth (accessible)", detail: "coinbase_l2_snapshots — could gate entry on confirming depth imbalance" },
        { category: "data_feed", name: "Coinbase recent trades (accessible)", detail: "coinbase_trades — buy/sell pressure within velocity window" },
      ];
    case "random_walk_baseline":
      return [{ category: "data_feed", name: "(none)", detail: "Coin-flip baseline — no market data consulted" }];
    case "multi_strategy":
      return [{ category: "data_feed", name: "(union of sub-strategy feeds)", detail: "see expanded sub-genome rows" }];
    default:
      return [];
  }
}

/** Decision modules — quant rails, LLM, heuristic evaluators, etc. */
function decisionModulesForKind(kind: string): ArsenalCapability[] {
  const common: ArsenalCapability[] = [
    { category: "decision_module", name: "Position cap + risk budget", detail: "src/lib/arena/risk-budget — caps per-tick stake to genome.entry_size_usd and remaining risk budget" },
  ];
  const perKind: Record<string, ArsenalCapability[]> = {
    poly_fade_spike: [
      { category: "decision_module", name: "Spike detector (threshold + quiet confirm)", detail: "fires when |move over lookback_h| ≥ threshold_pts AND price has settled for confirm_quiet_h" },
    ],
    poly_breakout: [
      { category: "decision_module", name: "Lookback-high breakout test", detail: "fires when price × breakout_mult > rolling-max(lookback_h)" },
    ],
    cb_breakout: [
      { category: "decision_module", name: "Lookback-high breakout test", detail: "fires when last close × breakout_mult > rolling-max(lookback_min)" },
    ],
    cb_mean_reversion: [
      { category: "decision_module", name: "Z-score band", detail: "enters when |z| ≥ z_entry; exits when |z| ≤ z_exit" },
    ],
    cross_venue_arb: [
      { category: "decision_module", name: "Black-Scholes implied probability", detail: "computes CB-implied P(condition true) using bs_vol_window_days for σ" },
      { category: "decision_module", name: "Edge filter", detail: "trades only when |poly_price − bs_prob| ≥ edge_pts" },
    ],
    cb_momentum_burst: [
      { category: "decision_module", name: "Velocity + acceleration gates", detail: "src/lib/arena/momentum.ts — vel_entry_pct AND accel_min must both clear" },
    ],
    random_walk_baseline: [
      { category: "decision_module", name: "Coin flip", detail: "rng().<trade_prob → fire; buy_bias_pct determines side" },
    ],
    category_specialist: [
      { category: "decision_module", name: "Category filter + inner detector", detail: "applies fade_spike OR breakout logic, but only on markets in the chosen category" },
    ],
    wallet_copy_filtered: [
      { category: "decision_module", name: "Source-quality gate", detail: "min_source_win_rate × min_source_trades — refuses copy when source's category-stats are weak" },
      { category: "decision_module", name: "Delay window", detail: "delay_min — refuses fills older than this (stale signal)" },
      { category: "decision_module", name: "Size scaler + hard cap", detail: "size_pct_of_source × source.size, capped at max_size_usd" },
    ],
    polymarket_market_maker: [
      { category: "decision_module", name: "Spread quote", detail: "places sim limits at midpoint ± spread_pts/2; alternates side by entries_count parity" },
    ],
    llm_probability_oracle: [
      { category: "decision_module", name: "Claude probability prompt", detail: "model=<see genome>; cached cache_ttl_min minutes (versioned by prompt_version)" },
      { category: "decision_module", name: "EV + Kelly sizing rail", detail: "src/lib/quant — EV = P_true·payoff − (1−P_true)·stake; Kelly suggests fraction; min_ev_pct gate" },
      { category: "decision_module", name: "Per-tick call budget", detail: "max_calls_per_tick — cache hits free, live calls billed via ARENA_LLM_ORACLE_BUDGET_USD" },
    ],
    poly_short_binary_directional: [
      { category: "decision_module", name: "Velocity-from-CB-candles direction", detail: "vel_window_min minute velocity → Up if +ve, Down if −ve" },
      { category: "decision_module", name: "Pre-cutoff timing window", detail: "enters only when pre_cutoff_min ≤ minutes-to-expiry ≤ max_window_min" },
      { category: "decision_module", name: "Price-edge filter", detail: "max_yes_price_for_buy / min_yes_price_for_sell — refuses when YES already prices our direction" },
      { category: "decision_module", name: "Per-asset position cap", detail: "max_positions_per_asset — caps stacking on consecutive same-asset binaries" },
    ],
    cb_orderbook_imbalance: [
      { category: "decision_module", name: "Bid/ask depth ratio gate", detail: "enters when depth_imbalance = bidUsd/askUsd crosses threshold in either direction" },
      { category: "decision_module", name: "Minimum total depth filter", detail: "min_depth_usd — refuses thin books where the ratio is noisy" },
    ],
    cb_trade_flow_burst: [
      { category: "decision_module", name: "Trade arrival-rate z-score", detail: "fires when trades/min over window > z_threshold above prior baseline" },
      { category: "decision_module", name: "Buy/sell pressure split", detail: "buy_pressure_min — minimum fraction of trade volume on the active side" },
    ],
    poly_binary_arbitrage: [
      { category: "decision_module", name: "Combined-ask gate", detail: "fires when UP_ask + DOWN_ask ≤ max_combined_price — riskless edge per pair" },
      { category: "decision_module", name: "Per-side depth filter", detail: "refuses to fire when either side has less than min_book_depth_usd notional" },
      { category: "decision_module", name: "Expiry guardrail", detail: "max_minutes_to_expiry — avoids entering inside the last-second tail-risk zone" },
      { category: "decision_module", name: "Tilt asymmetric sizer", detail: "direction_bias=tilt_up/tilt_down sizes that leg at tilt_ratio× the other" },
      { category: "decision_module", name: "Alternating leg emitter", detail: "single Signal/tick limitation — emits UP then DOWN on consecutive ticks (sim-only)" },
    ],
    poly_binary_repricing: [
      { category: "decision_module", name: "Velocity-to-prob projector", detail: "linear projection: implied_UP = 0.5 + clamp(velocity / vel_sat_pct, -1, 1) × 0.45" },
      { category: "decision_module", name: "Edge gate (pp threshold)", detail: "fires when |implied − market_mid| × 100 ≥ edge_threshold_pp" },
      { category: "decision_module", name: "Expiry guardrail", detail: "max_minutes_to_expiry — avoids late entries" },
    ],
    poly_late_window_scalp: [
      { category: "decision_module", name: "Ask range filter", detail: "buys only when best ask ∈ [min_ask, max_ask] (near-cert outcomes)" },
      { category: "decision_module", name: "Remaining-time window", detail: "remaining_sec ≤ max_remaining_sec, otherwise hold" },
      { category: "decision_module", name: "Min payoff filter", detail: "(1 − ask) ≥ min_payoff_per_share — refuses too-thin yields" },
    ],
    poly_consensus_follow: [
      { category: "decision_module", name: "Consensus strength gate", detail: "all of {min_effective_wallets, min_combined_trust, min_combined_usd} must clear" },
      { category: "decision_module", name: "Signal freshness gate", detail: "signal age ≤ max_signal_age_sec; older signals are stale" },
      { category: "decision_module", name: "Direction follower", detail: "buys YES on UP signals, NO on DOWN signals — direct follow, no fade" },
    ],
    poly_cross_market_zscore: [
      { category: "decision_module", name: "Rolling spread z-score", detail: "z = (spread_now − μ) / σ over baseline_min — fires when |z| ≥ z_threshold" },
      { category: "decision_module", name: "Lagger detection", detail: "picks the contract whose midpoint hasn't caught up to its pair (further from 0.5 = leader, closer = lagger)" },
      { category: "decision_module", name: "Direction follower", detail: "trades the lagger in the leader's direction (converging spread = mean-reversion trade)" },
    ],
    multi_strategy: [
      { category: "decision_module", name: "Priority-ordered sub selection", detail: "walks subs in order; returns first non-hold signal" },
    ],
  };
  return [...common, ...(perKind[kind] ?? [])];
}

/** Constraints — system-wide guards that touch this agent's decisions. */
function constraintsForKind(kind: string): ArsenalCapability[] {
  const out: ArsenalCapability[] = [
    { category: "constraint", name: "Global ALLOW_TRADE kill", detail: "ALLOW_TRADE=0 forces dry-run on the live router even if a capsule is bound" },
    { category: "constraint", name: "Capsule risk budget", detail: "max_daily_loss_usd + max_total_drawdown_usd from capsule binding (when staged)" },
  ];
  if (kind === "llm_probability_oracle") {
    out.push({ category: "constraint", name: "LLM call budget", detail: "ARENA_LLM_ORACLE_ENABLED gate + per-day USD cap" });
  }
  if (kind === "poly_short_binary_directional") {
    out.push({ category: "constraint", name: "Binary resolver force-close", detail: "src/lib/arena/binary-resolver settles all open positions at expiry" });
  }
  return out;
}

/**
 * Decode genome.params into rows with bounds for the UI. Multi-strategy
 * flattens to "see sub-genome rows below" — the caller renders each sub
 * independently.
 */
function paramsToRows(genome: Genome): GenomeParam[] {
  if (genome.kind === "multi_strategy") {
    const params = (genome as any).params;
    return [
      { key: "selection", value: params.selection },
      { key: "entry_size_usd", value: params.entry_size_usd, bounds: [5, 100] as [number, number] },
    ];
  }
  const bounds = getParamBounds(genome.kind as GenomeKind);
  const out: GenomeParam[] = [];
  for (const [key, value] of Object.entries((genome as any).params)) {
    out.push({ key, value, bounds: (bounds as any)[key] });
  }
  return out;
}

export function buildArsenal(genome: Genome | SubGenome): AgentArsenal {
  const isComposite = (genome as any).kind === "multi_strategy";
  const subKinds: string[] = isComposite ? (genome as any).params.subs.map((s: SubGenome) => s.kind) : [];
  // Composite agents inherit feeds + modules from each sub. Dedupe by name.
  let capabilities: ArsenalCapability[];
  if (isComposite) {
    const seen = new Set<string>();
    capabilities = [];
    for (const sub of (genome as any).params.subs as SubGenome[]) {
      for (const cap of [...feedsForKind(sub.kind), ...decisionModulesForKind(sub.kind)]) {
        const key = `${cap.category}:${cap.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        capabilities.push(cap);
      }
    }
    for (const cap of constraintsForKind("multi_strategy")) capabilities.push(cap);
  } else {
    capabilities = [
      ...feedsForKind(genome.kind),
      ...decisionModulesForKind(genome.kind),
      ...constraintsForKind(genome.kind),
    ];
  }
  return {
    strategyKind: genome.kind,
    strategyLabel: STRATEGY_LABELS[genome.kind] ?? genome.kind,
    strategyFamily: STRATEGY_FAMILY[genome.kind] ?? "unknown",
    isComposite,
    subKinds,
    capabilities,
    genomeParams: paramsToRows(genome as Genome),
  };
}

export function buildSubArsenals(genome: Genome): AgentArsenal[] | null {
  if (genome.kind !== "multi_strategy") return null;
  // Each sub is a complete (kind, params) — wrap and recurse without the
  // composite check (subs cannot themselves be composites — schema enforces).
  return ((genome as any).params.subs as SubGenome[]).map((sub) => buildArsenal(sub));
}

export function listAllStrategies(): Array<{ kind: string; label: string; family: string }> {
  return (GENOME_KINDS as readonly string[]).map((kind) => ({
    kind,
    label: STRATEGY_LABELS[kind] ?? kind,
    family: STRATEGY_FAMILY[kind] ?? "unknown",
  }));
}
