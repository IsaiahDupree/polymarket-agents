/**
 * gpu_oracle — runtime helper for a trained neural model loaded via
 * onnxruntime-node. Used by `decideGpuOracle` in sim.ts at decide time.
 *
 * Inference flow:
 *
 *   1. Operator points the genome at an ONNX file (model_path).
 *   2. First call to predictYesProbability for that path:
 *        - load + cache the ONNX session
 *        - load the sidecar `.meta.json` (scalar/price col order, normalization,
 *          isotonic calibration map)
 *   3. Every call after that reuses the cached session.
 *   4. Features get built in the exact column order from meta.json;
 *      scalars are z-score-normalized via the saved (mean, std).
 *   5. The model emits a single logit; we sigmoid it, then run isotonic
 *      calibration when meta says calibrated=true.
 *   6. probabilityToSignal maps to BUY_YES / BUY_NO / HOLD.
 *
 * The .meta.json sidecar is produced by `train/export_onnx.py` and is
 * the contract between Python training and TS inference. Changing
 * scalar order or normalization on one side without the other will
 * produce silently-wrong predictions — locking the column list in the
 * sidecar is what prevents that.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Signal } from "./types";

// Lazy-import onnxruntime-node so tests that don't touch this module
// don't pay the load cost (the package pulls a ~50 MB native binary).
type OrtSession = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | Float64Array }>>;
  inputNames: string[];
  outputNames: string[];
};
type OrtModule = {
  InferenceSession: { create(path: string, opts?: object): Promise<OrtSession> };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
};
let _ort: OrtModule | null = null;
async function getOrt(): Promise<OrtModule> {
  if (_ort) return _ort;
  // @ts-expect-error — runtime dynamic import, not declared in the TS workspace
  _ort = (await import("onnxruntime-node")) as OrtModule;
  return _ort!;
}

export type GpuOracleParams = {
  /** Filesystem path to the ONNX model, relative to repo root. */
  model_path: string;
  /** P(YES) ≥ this → BUY_YES. */
  threshold_buy_yes: number;
  /** P(YES) ≤ this → BUY_NO. */
  threshold_buy_no: number;
  /** $ stake per fill. */
  stake_usd: number;
  /** Only act when minutes-to-resolution is in [min, max]. */
  min_to_resolution_min: number;
  max_to_resolution_min: number;
};

/** Feature vector at decide time — column order is canonical, matching
 *  the SCALAR_COLS order in train/train_lstm.py. The runtime re-orders
 *  according to meta.json so it doesn't have to be hard-coded here. */
export type GpuOracleFeatures = {
  /** N prior YES prices (oldest → newest); length = meta.lookback. */
  price_window: number[];
  yes_price: number;
  no_price: number;
  volume_usd: number;
  liquidity_usd: number;
  min_to_resolution: number;
  total_bid_depth: number;
  total_ask_depth: number;
  spread: number;
  ofi_1s: number;
  ofi_5s: number;
  ofi_30s: number;
};

type ModelMeta = {
  scalar_cols: string[];
  price_cols: string[];
  lookback: number;
  sca_mean: number[];
  sca_std: number[];
  hidden: number;
  layers: number;
  calibrated: boolean;
  isotonic_x?: number[];
  isotonic_y?: number[];
};

type CachedModel = {
  session: OrtSession;
  meta: ModelMeta;
};

/** Lazy session+meta cache, keyed by model_path. Loading takes ~50-200 ms
 *  cold; we share across decide-calls within one process. */
const SESSION_CACHE = new Map<string, CachedModel>();

async function loadModel(modelPath: string): Promise<CachedModel> {
  const cached = SESSION_CACHE.get(modelPath);
  if (cached) return cached;
  const ort = await getOrt();
  const absPath = resolve(modelPath);
  const session = await ort.InferenceSession.create(absPath);
  // Sidecar metadata: <path>.meta.json next to the ONNX file
  const metaPath = `${absPath}.meta.json`;
  let meta: ModelMeta;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8")) as ModelMeta;
  } catch (e) {
    throw new Error(
      `gpu-oracle: could not load meta sidecar at ${metaPath} — produce it via train/export_onnx.py. ` +
      `Original error: ${(e as Error).message}`,
    );
  }
  const bundle: CachedModel = { session, meta };
  SESSION_CACHE.set(modelPath, bundle);
  return bundle;
}

/** Manually invalidate the session cache. Used by tests + by a hot-reload
 *  CLI when the operator swaps in a fresh checkpoint. */
export function clearGpuOracleCache(): void {
  SESSION_CACHE.clear();
}

/** Apply the saved isotonic calibration via linear interpolation. */
function applyIsotonic(prob: number, xs: number[], ys: number[]): number {
  if (prob <= xs[0]) return ys[0];
  if (prob >= xs[xs.length - 1]) return ys[ys.length - 1];
  // Binary search for the interp range
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= prob) lo = mid; else hi = mid;
  }
  const t = (prob - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/** Pull the value for a scalar column from the features object. Each
 *  key is a known column name we know how to project. */
function scalarValue(features: GpuOracleFeatures, col: string): number {
  switch (col) {
    case "yes_price":        return features.yes_price;
    case "no_price":         return features.no_price;
    case "volume_usd":       return features.volume_usd;
    case "liquidity_usd":    return features.liquidity_usd;
    case "min_to_resolution": return features.min_to_resolution;
    case "total_bid_depth":  return features.total_bid_depth;
    case "total_ask_depth":  return features.total_ask_depth;
    case "spread":           return features.spread;
    case "ofi_1s":           return features.ofi_1s;
    case "ofi_5s":           return features.ofi_5s;
    case "ofi_30s":          return features.ofi_30s;
    default:
      // Unknown column in meta — we either trained on a column we don't
      // surface here (silent feature-skew bug) or someone edited meta
      // by hand. Throw loud rather than zero-fill.
      throw new Error(`gpu-oracle: unknown scalar column "${col}" in meta.json`);
  }
}

/** Run inference for one decide tick — returns the (possibly calibrated)
 *  P(YES). Threadsafe across concurrent calls because onnxruntime-node
 *  serializes per-session; we don't share tensors across calls. */
export async function predictYesProbability(
  modelPath: string,
  features: GpuOracleFeatures,
): Promise<number> {
  const { session, meta } = await loadModel(modelPath);
  const ort = await getOrt();

  // Seq input: [batch=1, T=lookback, features=1]
  if (features.price_window.length < meta.lookback) {
    throw new Error(
      `gpu-oracle: feature.price_window length ${features.price_window.length} ` +
      `< model lookback ${meta.lookback}`,
    );
  }
  // Take the LAST `meta.lookback` prices (oldest → newest convention).
  const seqData = Float32Array.from(features.price_window.slice(-meta.lookback));
  const seqTensor = new ort.Tensor("float32", seqData, [1, meta.lookback, 1]);

  // Scalar input — z-score normalize using meta's sca_mean / sca_std.
  // Column order MUST match meta.scalar_cols.
  const sca = new Float32Array(meta.scalar_cols.length);
  for (let i = 0; i < meta.scalar_cols.length; i++) {
    const raw = scalarValue(features, meta.scalar_cols[i]);
    sca[i] = (raw - meta.sca_mean[i]) / (meta.sca_std[i] || 1);
  }
  const scaTensor = new ort.Tensor("float32", sca, [1, meta.scalar_cols.length]);

  const out = await session.run({ seq: seqTensor, scalars: scaTensor });
  const logit = Number(out.logit?.data[0] ?? 0);
  const raw = 1 / (1 + Math.exp(-logit));

  if (meta.calibrated && meta.isotonic_x && meta.isotonic_y) {
    return applyIsotonic(raw, meta.isotonic_x, meta.isotonic_y);
  }
  return raw;
}

/** Map a P(YES) prediction to a Signal. Pure / unit-testable; the I/O
 *  is isolated in predictYesProbability above. */
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
