/**
 * gpu_oracle — runtime stub for the genome kind that runs a trained
 * neural model's inference at decide time. Phase C of the GPU training
 * pipeline (see train/README.md).
 *
 * This file is **scaffolding only**. The genome is NOT yet wired into
 * `genome.ts` / `sim.ts` because doing so without a trained model would
 * change every typed switch + test in the arena code path. The wiring
 * lands as a separate, focused PR once a model has been trained,
 * exported to ONNX, and clears the overfit-battery gate.
 *
 * Wiring checklist (TODO when model exists):
 *
 *   1. Schema    : add `GpuOracle` zod schema below the other strategy
 *                  schemas in `src/lib/arena/genome.ts`. Discriminator =
 *                  `"gpu_oracle"`. Params: model_path (string, default
 *                  "train/checkpoints/lstm_v0.onnx"), threshold_buy_yes,
 *                  threshold_buy_no, stake_usd, min_to_resolution_min
 *                  (lower bound), max_to_resolution_min (upper bound).
 *
 *   2. Union     : add the discriminator literal to `GenomeSchema` (line
 *                  ~385) and `GENOME_KINDS` (line ~409) in genome.ts.
 *
 *   3. Decide    : add `decideGpuOracle(g, agent, ctx)` to `src/lib/arena/sim.ts`
 *                  alongside the other decide functions; route via the
 *                  switch at the top.
 *
 *   4. Inference : load the ONNX model once per process (cache in module
 *                  scope, lazy on first decide). Use `onnxruntime-node`
 *                  with `executionProviders: ['cuda', 'cpu']` so it runs
 *                  on the 4070 when available and falls back gracefully.
 *
 *   5. Safety    : `gpu_oracle` is NOT added to `DEFAULT_SAFETY_CEILING`
 *                  in dynamic-eligibility.ts. Lives only in paper until
 *                  it has its own audit:overfit verdict marked HARDENED,
 *                  then promote by editing the safety ceiling list.
 *
 * Until #1-5 land, this module exports just types and the inference
 * wrapper. Importing it has no side effects.
 */

import type { Signal } from "./types";

export type GpuOracleParams = {
  /** Filesystem path to the ONNX model, relative to repo root. */
  model_path: string;
  /** P(YES) ≥ this → BUY_YES. */
  threshold_buy_yes: number;
  /** P(YES) ≤ this → BUY_NO. */
  threshold_buy_no: number;
  /** $ stake per fill (matches the $2 baseline). */
  stake_usd: number;
  /** Only act when minutes-to-resolution is in [min, max]. */
  min_to_resolution_min: number;
  max_to_resolution_min: number;
};

/** Feature vector at decide time. Must match the dataset column order
 *  used in `train/build_dataset.py` + `train/train_lstm.py` exactly. */
export type GpuOracleFeatures = {
  /** 10 prior YES prices (oldest → newest). */
  price_window: number[];
  yes_price: number;
  no_price: number;
  volume_usd: number;
  liquidity_usd: number;
  min_to_resolution: number;
  total_bid_depth: number;
  total_ask_depth: number;
  spread: number;
};

/**
 * Lazy ONNX session cache, keyed by model_path. Loading is expensive
 * (~50-200 ms cold) so we share across decide-calls within one process.
 *
 * TODO when wiring: replace the placeholder with a real
 * `import { InferenceSession } from "onnxruntime-node"` once the dep is
 * added to package.json. Until then this throws — keeps the stub from
 * silently returning HOLD if someone tries to use it prematurely.
 */
type InferenceSessionStub = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
};
const SESSION_CACHE = new Map<string, InferenceSessionStub>();

/** Stub — replace with `await InferenceSession.create(path, opts)`. */
async function loadModel(modelPath: string): Promise<InferenceSessionStub> {
  const cached = SESSION_CACHE.get(modelPath);
  if (cached) return cached;
  throw new Error(
    `gpu-oracle: model not loaded — wire up onnxruntime-node and update loadModel(). ` +
    `Requested path: ${modelPath}`,
  );
}

/**
 * Run inference for one decide tick. When wired this:
 *   1. Loads the ONNX model (cached)
 *   2. Builds the input tensor in dataset column order
 *   3. Runs the session
 *   4. Returns P(YES) as a number
 */
export async function predictYesProbability(
  modelPath: string,
  features: GpuOracleFeatures,
): Promise<number> {
  const session = await loadModel(modelPath);
  // Concatenate features in the exact order train_lstm.py uses.
  // Sequence input: [batch=1, T=10, features=1]
  const seq = Float32Array.from(features.price_window);
  // Scalar input: [batch=1, F=7] — order MUST match SCALAR_COLS in
  // train/train_lstm.py.
  const scalars = Float32Array.from([
    features.yes_price,
    features.volume_usd,
    features.liquidity_usd,
    features.min_to_resolution,
    features.total_bid_depth,
    features.total_ask_depth,
    features.spread,
  ]);
  const out = await session.run({ seq, scalars });
  // The exported model emits a single "logit" output; sigmoid it here so
  // the genome only deals with probabilities.
  const logit = out.logit?.data[0] ?? 0;
  return 1 / (1 + Math.exp(-logit));
}

/**
 * Map a P(YES) prediction to a Signal. Pure / unit-testable; the I/O
 * portion is in predictYesProbability() above.
 *
 * Wired into `sim.ts:decideGpuOracle` once Phase C lands.
 */
export function probabilityToSignal(
  probYes: number,
  marketYesPrice: number,
  params: Pick<GpuOracleParams, "threshold_buy_yes" | "threshold_buy_no" | "stake_usd">,
  marketId: string,
): Signal {
  if (probYes >= params.threshold_buy_yes && probYes > marketYesPrice) {
    return {
      action: "BUY",
      market_id: marketId,
      side: "YES",
      size_usd: params.stake_usd,
      reason: `gpu_oracle: P(YES)=${probYes.toFixed(3)} ≥ ${params.threshold_buy_yes} (market ${marketYesPrice.toFixed(3)})`,
    };
  }
  if (probYes <= params.threshold_buy_no && probYes < marketYesPrice) {
    return {
      action: "BUY",
      market_id: marketId,
      side: "NO",
      size_usd: params.stake_usd,
      reason: `gpu_oracle: P(YES)=${probYes.toFixed(3)} ≤ ${params.threshold_buy_no} (market ${marketYesPrice.toFixed(3)})`,
    };
  }
  return { action: "HOLD", reason: `gpu_oracle: P(YES)=${probYes.toFixed(3)} within thresholds` };
}
