/**
 * Arena genome — typed parameter-vector strategy specs.
 *
 * Each paper agent carries a `Genome` (kind + params). The sim engine reads
 * the discriminator and calls the matching decision function. The mutation
 * operator clamps perturbations to the zod bounds so children are always
 * valid by construction.
 *
 * Strategy roster (MVP set):
 *   poly_fade_spike     — Polymarket: fade large recent moves
 *   poly_breakout       — Polymarket: ride breakouts above recent high
 *   cb_breakout         — Coinbase:   ride breakouts above recent high
 *   cb_mean_reversion   — Coinbase:   buy when z-score < -threshold, exit on reversion
 *   cross_venue_arb     — Cross-venue: fade Polymarket vs Coinbase-implied prob spread
 *   random_walk_baseline — null hypothesis control; do not promote
 */
import { z } from "zod";

// --- helpers: bounded numeric params ---
const pct = (lo: number, hi: number) => z.number().min(lo).max(hi);
const num = (lo: number, hi: number) => z.number().min(lo).max(hi);

// --- per-strategy param schemas ---

const PolyFadeSpike = z.object({
  threshold_pts: num(3, 25),       // points the price has moved in lookback window
  lookback_h: num(6, 72),
  confirm_quiet_h: num(2, 24),     // how long the move must have settled
  entry_size_usd: num(5, 100),
  exit_target_pts: num(1, 10),
  stop_pts: num(2, 15),
  time_stop_h: num(12, 168),
}).strict();

const PolyBreakout = z.object({
  lookback_h: num(6, 168),
  breakout_mult: num(1.05, 3.0),
  entry_size_usd: num(5, 100),
  target_pts: num(1, 15),
  stop_pts: num(2, 15),
  time_stop_h: num(12, 168),
}).strict();

const CbBreakout = z.object({
  product_id: z.enum(["BTC-USD", "ETH-USD", "SOL-USD"]),
  lookback_min: num(15, 1440),
  breakout_mult: num(1.01, 1.10),
  entry_size_usd: num(5, 100),
  target_pct: pct(0.001, 0.10),
  stop_pct: pct(0.002, 0.10),
  time_stop_min: num(30, 4320),
}).strict();

const CbMeanReversion = z.object({
  product_id: z.enum(["BTC-USD", "ETH-USD", "SOL-USD"]),
  lookback_min: num(60, 4320),
  z_entry: num(1.0, 4.0),
  z_exit: num(-1.0, 1.0),
  entry_size_usd: num(5, 100),
  stop_pct: pct(0.005, 0.10),
  time_stop_min: num(30, 4320),
}).strict();

const CrossVenueArb = z.object({
  cb_product_id: z.enum(["BTC-USD", "ETH-USD"]),
  poly_condition_id: z.string().min(3),   // pair must be pre-registered in cross_venue_arbs
  edge_pts: num(2, 20),                    // minimum implied-vs-bs spread to fade
  bs_vol_window_days: num(7, 60),
  entry_size_usd: num(5, 100),
  time_stop_h: num(12, 168),
}).strict();

const RandomWalkBaseline = z.object({
  trade_prob: pct(0.001, 0.10),            // per-tick probability of firing
  buy_bias_pct: pct(0.30, 0.70),
  entry_size_usd: num(5, 50),
}).strict();

const WalletCopyFiltered = z.object({
  // Mirror a tracked wallet's trades, filtered by category dominance. Lunar
  // article's Mental Bug #4: "A wallet has 91% WR on crypto and 15% on
  // politics. Copying everything = net negative. Filter by category."
  // PRD lunar-inspired §6.3.R3.
  wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  copy_category: z.enum(["geopolitics", "elections", "crypto", "sports", "macro", "weather", "tech", "other"]),
  /** Fraction of source's trade size to mirror (e.g. 0.01 = 1% of source size). */
  size_pct_of_source: pct(0.001, 0.10),
  /** Hard cap on our position size in USD regardless of source's size. */
  max_size_usd: num(1, 100),
  /** Only copy fills younger than this many minutes — older fills are stale. */
  delay_min: num(1, 60),
  /** Minimum source win-rate in copy_category over the last 30 days to allow
   *  copying. Below this, the genome holds with rationale "underperforming". */
  min_source_win_rate: pct(0.40, 0.90),
  /** Minimum trades the source needs in this category for win-rate to be
   *  trustworthy. Below this, genome holds (overfitting guardrail). */
  min_source_trades: num(5, 200),
}).strict();

const CategorySpecialist = z.object({
  // Polymarket archetype inspired by majorexploiter ($2.4M in March 2026,
  // geopolitics+elections only — laser-focused single-category trader).
  // Internally reuses fade-spike OR breakout logic but only considers markets
  // tagged with the chosen category. PRD lunar-inspired §6.2.R2.
  category: z.enum(["geopolitics", "elections", "crypto", "sports", "macro", "weather", "tech", "other"]),
  inner_strategy: z.enum(["fade_spike", "breakout"]),
  threshold_pts: num(3, 15),
  lookback_h: num(6, 72),
  confirm_quiet_h: num(2, 24),
  entry_size_usd: num(5, 100),
  exit_target_pts: num(1, 10),
  stop_pts: num(2, 15),
  time_stop_h: num(12, 168),
  breakout_mult: num(1.05, 3.0),
}).strict();

const CbMomentumBurst = z.object({
  product_id: z.enum(["BTC-USD", "ETH-USD", "SOL-USD"]),
  vel_window_min: num(3, 30),              // 1-min candles → short window
  vel_entry_pct: pct(0.0005, 0.05),        // 0.05% .. 5% over the window
  accel_min: num(0.00001, 0.02),           // require positive acceleration this large
  entry_size_usd: num(5, 100),
  target_pct: pct(0.001, 0.05),
  stop_pct: pct(0.002, 0.05),
  time_stop_min: num(5, 120),
  direction_bias: z.enum(["long_only", "long_short"]),
}).strict();

// --- discriminated union ---

export const GenomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("poly_fade_spike"),      params: PolyFadeSpike }),
  z.object({ kind: z.literal("poly_breakout"),        params: PolyBreakout }),
  z.object({ kind: z.literal("cb_breakout"),          params: CbBreakout }),
  z.object({ kind: z.literal("cb_mean_reversion"),    params: CbMeanReversion }),
  z.object({ kind: z.literal("cross_venue_arb"),      params: CrossVenueArb }),
  z.object({ kind: z.literal("cb_momentum_burst"),    params: CbMomentumBurst }),
  z.object({ kind: z.literal("random_walk_baseline"), params: RandomWalkBaseline }),
  z.object({ kind: z.literal("category_specialist"),  params: CategorySpecialist }),
  z.object({ kind: z.literal("wallet_copy_filtered"), params: WalletCopyFiltered }),
]);

export type Genome = z.infer<typeof GenomeSchema>;
export type GenomeKind = Genome["kind"];

export const GENOME_KINDS: GenomeKind[] = [
  "poly_fade_spike",
  "poly_breakout",
  "cb_breakout",
  "cb_mean_reversion",
  "cross_venue_arb",
  "cb_momentum_burst",
  "random_walk_baseline",
  "category_specialist",
  "wallet_copy_filtered",
];

const PARAM_BOUNDS: Record<GenomeKind, Record<string, [number, number] | string[]>> = {
  poly_fade_spike: {
    // Tightened 2026-05-25 to fight cold-start: threshold_pts up to 25
    // basically never triggered on real Polymarket data. Lowering ceiling so
    // initial population produces firing agents.
    threshold_pts: [3, 10], lookback_h: [6, 72], confirm_quiet_h: [2, 24],
    entry_size_usd: [5, 100], exit_target_pts: [1, 8], stop_pts: [2, 10], time_stop_h: [12, 168],
  },
  poly_breakout: {
    lookback_h: [6, 168], breakout_mult: [1.05, 3.0], entry_size_usd: [5, 100],
    target_pts: [1, 15], stop_pts: [2, 15], time_stop_h: [12, 168],
  },
  cb_breakout: {
    product_id: ["BTC-USD", "ETH-USD", "SOL-USD"], lookback_min: [15, 1440],
    breakout_mult: [1.01, 1.10], entry_size_usd: [5, 100], target_pct: [0.001, 0.10],
    stop_pct: [0.002, 0.10], time_stop_min: [30, 4320],
  },
  cb_mean_reversion: {
    product_id: ["BTC-USD", "ETH-USD", "SOL-USD"], lookback_min: [60, 4320],
    // Tightened 2026-05-25: z_entry up to 4 sigma is a 1-in-15000 event,
    // basically never fires. Bringing ceiling down to 2.5 keeps the
    // mean-reversion premise but ensures the bar is reachable.
    z_entry: [1.0, 2.5], z_exit: [-1.0, 1.0], entry_size_usd: [5, 100],
    stop_pct: [0.005, 0.10], time_stop_min: [30, 4320],
  },
  cross_venue_arb: {
    cb_product_id: ["BTC-USD", "ETH-USD"], poly_condition_id: [],
    edge_pts: [2, 20], bs_vol_window_days: [7, 60],
    entry_size_usd: [5, 100], time_stop_h: [12, 168],
  },
  cb_momentum_burst: {
    product_id: ["BTC-USD", "ETH-USD", "SOL-USD"],
    // Tightened 2026-05-25: vel_entry_pct up to 5% over a 30-min window
    // basically never fires on BTC. Pulled the ceiling down so initial
    // population trades + evolution has a fitness gradient to climb.
    vel_window_min: [3, 20], vel_entry_pct: [0.001, 0.012],
    accel_min: [0.00005, 0.003], entry_size_usd: [5, 100],
    target_pct: [0.001, 0.02], stop_pct: [0.002, 0.02], time_stop_min: [5, 120],
    direction_bias: ["long_only", "long_short"],
  },
  random_walk_baseline: {
    trade_prob: [0.001, 0.10], buy_bias_pct: [0.30, 0.70], entry_size_usd: [5, 50],
  },
  category_specialist: {
    category: ["geopolitics", "elections", "crypto", "sports", "macro", "weather", "tech", "other"],
    inner_strategy: ["fade_spike", "breakout"],
    threshold_pts: [3, 12], lookback_h: [6, 72], confirm_quiet_h: [2, 24],
    entry_size_usd: [5, 100], exit_target_pts: [1, 8], stop_pts: [2, 10],
    time_stop_h: [12, 168], breakout_mult: [1.05, 2.5],
  },
  wallet_copy_filtered: {
    // wallet_address is a string opaque to bounds — randomGenome picks from a
    // pool passed via opts.walletPool when seeding/mutating.
    copy_category: ["geopolitics", "elections", "crypto", "sports", "macro", "weather", "tech", "other"],
    size_pct_of_source: [0.001, 0.10], max_size_usd: [1, 100],
    delay_min: [1, 60], min_source_win_rate: [0.40, 0.90],
    min_source_trades: [5, 200],
  },
};

export function getParamBounds(kind: GenomeKind): Record<string, [number, number] | string[]> {
  return PARAM_BOUNDS[kind];
}

/** Clamp a number into [lo, hi] (inclusive). */
export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Build a genome with random parameters uniformly inside each bound. The
 * `poly_condition_id` for `cross_venue_arb` is left to the caller (must be
 * one of the registered pairings in `cross_venue_arbs`). Used by `arena:init`
 * to seed the initial population.
 */
export function randomGenome(
  rng: () => number,
  kind?: GenomeKind,
  opts: { polyConditionIdPool?: string[]; walletPool?: string[] } = {},
): Genome {
  const chosen = kind ?? GENOME_KINDS[Math.floor(rng() * GENOME_KINDS.length)];
  const bounds = PARAM_BOUNDS[chosen];
  const params: Record<string, unknown> = {};
  for (const [k, b] of Object.entries(bounds)) {
    if (Array.isArray(b) && b.length === 2 && typeof b[0] === "number") {
      const [lo, hi] = b as [number, number];
      params[k] = lo + rng() * (hi - lo);
    } else if (Array.isArray(b) && typeof b[0] === "string") {
      const list = b as string[];
      params[k] = list[Math.floor(rng() * list.length)];
    } else {
      // string fields handled below
    }
  }
  if (chosen === "cross_venue_arb") {
    const pool = opts.polyConditionIdPool ?? [];
    params.poly_condition_id = pool[Math.floor(rng() * Math.max(1, pool.length))] ?? "seed-btc-over-150k-eoy-2026";
  }
  if (chosen === "wallet_copy_filtered") {
    const pool = opts.walletPool ?? [];
    // Fallback to HorizonSplendidView's address (the article's high-freq
    // archetype) — so random-genome generation still produces a valid genome
    // even when the wallet pool isn't passed (e.g. in unit tests).
    params.wallet_address = pool[Math.floor(rng() * Math.max(1, pool.length))]
      ?? "0x02227b8f5a9636e895607edd3185ed6ee5598ff7";
  }
  // Round integers where the strategy semantically expects integers (lookbacks, time stops).
  const intKeys = new Set([
    "lookback_h", "confirm_quiet_h", "time_stop_h",
    "lookback_min", "time_stop_min", "bs_vol_window_days",
    "vel_window_min",
  ]);
  for (const k of intKeys) if (params[k] !== undefined) params[k] = Math.round(params[k] as number);
  // Validate.
  const genome = GenomeSchema.parse({ kind: chosen, params });
  return genome;
}

/** Serialize for DB storage (deterministic key order isn't required but matches expectations). */
export function serializeGenome(g: Genome): string {
  return JSON.stringify(g);
}
export function parseGenome(json: string): Genome {
  return GenomeSchema.parse(JSON.parse(json));
}

/** Human-friendly short name used in agent names (e.g. "fade-spike", "cb-bo"). */
export function genomeNickname(g: Genome): string {
  switch (g.kind) {
    case "poly_fade_spike": return "fade-spike";
    case "poly_breakout": return "poly-bo";
    case "cb_breakout": return `cb-bo-${(g.params.product_id ?? "BTC-USD").toLowerCase().replace("-usd", "")}`;
    case "cb_mean_reversion": return `cb-mr-${(g.params.product_id ?? "BTC-USD").toLowerCase().replace("-usd", "")}`;
    case "cross_venue_arb": return `xv-${(g.params.cb_product_id ?? "BTC-USD").toLowerCase().replace("-usd", "")}`;
    case "cb_momentum_burst": return `mom-${(g.params.product_id ?? "BTC-USD").toLowerCase().replace("-usd", "")}`;
    case "random_walk_baseline": return "rand";
    case "category_specialist": return `cat-${g.params.category}-${g.params.inner_strategy === "breakout" ? "bo" : "fs"}`;
    case "wallet_copy_filtered": return `copy-${g.params.wallet_address.slice(2, 8)}-${g.params.copy_category}`;
  }
}
