/**
 * Overfit-detection statistics for backtests — Bailey & López de Prado
 * 2014, López de Prado CSCV, multi-fold walk-forward. Ported from
 * HFT/src/lib/backtest/candle/stats.ts (commit cd85cad).
 *
 * Three diagnostics:
 *
 *   1. deflatedSharpe(bestReturns, trialSharpes)
 *      P(true Sharpe > 0) after deflating for multiple testing AND
 *      return non-normality. DSR > 0.95 ⇒ strong evidence the edge is
 *      real, not a multiple-testing artifact.
 *
 *   2. pbo(returnsMatrix, nBlocks)
 *      Probability of Backtest Overfit (López de Prado CSCV). Returns
 *      the fraction of train/test partitions where the IS-best config
 *      lands BELOW the median OOS. PBO < 0.3 ⇒ robust.
 *
 *   3. multiFoldWalkForward(returnsPerVariant, folds)
 *      Expanding-window walk-forward: first 40 % always IS, then `folds`
 *      equal OOS chunks over the back 60 %. Each fold re-picks the
 *      IS-best variant on training data and reports its OOS Sharpe.
 *
 * Generalized away from HFT's DailyCandle dependency — these functions
 * take plain numeric arrays so they're usable across the arena pipeline
 * (paper_trades returns, campaign-candidate per-bar PnL, etc.).
 *
 * Pure / deterministic — no DB, no I/O.
 */

// ---------------------------------------------------------------------------
// Basic stats

function mean(a: readonly number[]): number {
  if (a.length === 0) return 0;
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

function std(a: readonly number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

/** Per-period Sharpe (mean/std), NOT annualized — for ranking + DSR. */
export function sharpe(rets: readonly number[]): number {
  const sd = std(rets);
  return sd > 0 ? mean(rets) / sd : 0;
}

export function median(a: readonly number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------
// Normal distribution (CDF + inverse). erf via Abramowitz-Stegun 7.1.26;
// normalInv via Acklam's rational approximation. Both functions copied
// from HFT/stats.ts because they're standard reference implementations.

function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425, ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
         / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ---------------------------------------------------------------------------
// Moments — skewness + excess kurtosis (needed for DSR correction)

function moments(a: readonly number[]): { m2: number; m3: number; m4: number } {
  const n = a.length;
  const m = mean(a);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of a) {
    const dx = x - m;
    const d2 = dx * dx;
    m2 += d2;
    m3 += d2 * dx;
    m4 += d2 * d2;
  }
  return { m2: m2 / n, m3: m3 / n, m4: m4 / n };
}

export function skewness(a: readonly number[]): number {
  const { m2, m3 } = moments(a);
  return m2 > 0 ? m3 / m2 ** 1.5 : 0;
}

export function excessKurtosis(a: readonly number[]): number {
  const { m2, m4 } = moments(a);
  return m2 > 0 ? m4 / (m2 * m2) - 3 : 0;
}

// ---------------------------------------------------------------------------
// 1. Deflated Sharpe Ratio (Bailey & López de Prado, 2014)
//
//   SR0 = √Var[{SR_n}] · [(1−γ)Φ⁻¹(1−1/N) + γΦ⁻¹(1−1/(N·e))]
//   DSR = Φ[ (SR − SR0) / √((1 − γ3·SR + ((κ−1)/4)·SR²)/(T−1)) ]
//
// The expected-max term IS scaled by √Var[{SR_n}] across trials —
// that's the HFT commit's adversarially-verified fix (the handbook's
// simplified code had a different bug, since fixed here too).

export type DeflatedSharpeResult = {
  sr: number;
  dsr: number;
  /** Expected-max-Sharpe under the null (used internally; surfaced for debugging). */
  sr0: number;
};

export function deflatedSharpe(
  bestReturns: readonly number[],
  trialSharpes: readonly number[],
): DeflatedSharpeResult {
  const T = bestReturns.length;
  const N = Math.max(2, trialSharpes.length);
  if (T < 4) return { sr: 0, dsr: 0, sr0: 0 };
  const sr = sharpe(bestReturns);
  const g3 = skewness(bestReturns);
  const kurt = excessKurtosis(bestReturns) + 3;  // non-excess kurtosis
  const euler = 0.5772156649015329;
  const varSR = trialSharpes.length > 1
    ? (() => {
        const m = mean(trialSharpes);
        let s = 0;
        for (const x of trialSharpes) s += (x - m) ** 2;
        return s / (trialSharpes.length - 1);
      })()
    : 0;
  const eMaxStd = (1 - euler) * normalInv(1 - 1 / N) + euler * normalInv(1 - 1 / (N * Math.E));
  const sr0 = Math.sqrt(varSR) * eMaxStd;
  const srVar = (1 - g3 * sr + ((kurt - 1) / 4) * sr * sr) / (T - 1);
  if (srVar <= 0) return { sr, dsr: 0, sr0 };
  return { sr, dsr: normalCdf((sr - sr0) / Math.sqrt(srVar)), sr0 };
}

// ---------------------------------------------------------------------------
// 2. Probability of Backtest Overfit (López de Prado CSCV)

function kCombinations<T>(arr: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, combo: T[]) => {
    if (combo.length === k) { out.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      rec(i + 1, combo);
      combo.pop();
    }
  };
  rec(0, []);
  return out;
}

function argmax(a: readonly number[]): number {
  let bi = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i;
  return bi;
}

/**
 * Probability of Backtest Overfit. Inputs:
 *   M[t][c] = per-bar return for variant c at time t (T rows × N variants).
 *
 * Splits time into `nBlocks` even chunks. Over all C(nBlocks, nBlocks/2)
 * train/test partitions, picks the IS-best variant and computes its
 * OOS rank. PBO = fraction of partitions where the IS-best variant
 * lands BELOW the median OOS Sharpe.
 *
 * PBO < 0.3 → robust (the IS winner usually wins OOS).
 * PBO > 0.5 → coin-flip (the backtest is overfit; live results will
 *             not look like the IS picks suggested).
 *
 * Returns 1 (worst case) when there isn't enough data to evaluate.
 */
export function pbo(M: readonly (readonly number[])[], nBlocks = 8): number {
  const T = M.length;
  const N = M[0]?.length ?? 0;
  if (T < nBlocks * 2 || N < 2) return 1;
  const bounds: Array<[number, number]> = [];
  for (let b = 0; b < nBlocks; b++) {
    bounds.push([Math.floor((b * T) / nBlocks), Math.floor(((b + 1) * T) / nBlocks)]);
  }
  const combos = kCombinations([...Array(nBlocks).keys()], nBlocks >> 1);
  let under = 0;
  let count = 0;
  for (const train of combos) {
    const trainSet = new Set(train);
    const trainIdx: number[] = [];
    const testIdx: number[] = [];
    for (let b = 0; b < nBlocks; b++) {
      const [s, e] = bounds[b];
      const target = trainSet.has(b) ? trainIdx : testIdx;
      for (let i = s; i < e; i++) target.push(i);
    }
    const isS: number[] = [];
    const oosS: number[] = [];
    for (let c = 0; c < N; c++) {
      isS.push(sharpe(trainIdx.map((i) => M[i][c])));
      oosS.push(sharpe(testIdx.map((i) => M[i][c])));
    }
    const best = argmax(isS);
    // Rank = how many configs had STRICTLY lower OOS Sharpe than the IS winner.
    let rank = 0;
    for (const s of oosS) if (s < oosS[best]) rank++;
    if ((rank + 1) / (N + 1) < 0.5) under++;
    count++;
  }
  return count > 0 ? under / count : 1;
}

// ---------------------------------------------------------------------------
// 3. Multi-fold walk-forward

export type Variant = {
  label: string;
  /** Per-bar returns (length T). The walk-forward slices time, not variants. */
  returns: number[];
};

export type FoldResult = {
  fold: number;
  /** Which variant won the IS slice for this fold. */
  label: string;
  /** Its Sharpe on the held-out OOS slice. */
  oosSharpe: number;
  /** Number of OOS bars used. */
  bars: number;
};

/**
 * Expanding-window walk-forward. First 40 % of bars are always IS; the
 * remaining 60 % is split into `folds` equal OOS chunks. Each fold:
 *   1. Picks the variant with the highest Sharpe over bars [0, isEnd).
 *   2. Reports that variant's Sharpe over the held-out OOS chunk.
 *
 * Decoupled from the HFT version's DailyCandle dependency — pass raw
 * per-bar returns per variant. The arena can compute these from
 * paper_trades (per-bar P&L of each campaign candidate).
 */
export function multiFoldWalkForward(
  variants: readonly Variant[],
  opts: { folds?: number; bars?: number } = {},
): FoldResult[] {
  const folds = opts.folds ?? 4;
  if (variants.length === 0) return [];
  const T = opts.bars ?? Math.min(...variants.map((v) => v.returns.length));
  const start = Math.floor(T * 0.4);
  const chunk = Math.floor((T - start) / folds);
  if (chunk <= 0) return [];
  const out: FoldResult[] = [];
  for (let k = 0; k < folds; k++) {
    const isEnd = start + k * chunk;
    const oosStart = isEnd;
    const oosEnd = k === folds - 1 ? T : isEnd + chunk;
    let best = variants[0];
    let bestSh = -Infinity;
    for (const v of variants) {
      const sh = sharpe(v.returns.slice(0, isEnd));
      if (sh > bestSh) { bestSh = sh; best = v; }
    }
    const oosSh = sharpe(best.returns.slice(oosStart, oosEnd));
    out.push({ fold: k, label: best.label, oosSharpe: oosSh, bars: oosEnd - oosStart });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Composite "hardening" verdict — mirrors HFT scripts/harden-priors.ts logic.
//
// HARDENED only if:
//   PBO < pboMax   (default 0.3, robust)
//   DSR > dsrMin   (default 0.95, statistically defensible)
//   median(OOS Sharpe across folds) > medianMin  (default 0, positive OOS)

export type HardenInput = {
  /** Returns matrix M[t][c] for PBO. */
  returnsMatrix: readonly (readonly number[])[];
  /** Variants for walk-forward (their per-bar returns). */
  variants: readonly Variant[];
  /** Cross-trial Sharpe of every variant — used by deflatedSharpe. */
  trialSharpes: readonly number[];
  /** Returns of the IS-best variant — used by deflatedSharpe. */
  bestReturns: readonly number[];
  /** Optional thresholds. */
  pboMax?: number;
  dsrMin?: number;
  medianMin?: number;
};

export type HardenVerdict = {
  hardened: boolean;
  pbo: number;
  dsr: number;
  medianOos: number;
  folds: FoldResult[];
  sr: number;
  sr0: number;
  /** Per-criterion pass flags so callers can show which gate failed. */
  pass: { pbo: boolean; dsr: boolean; medianOos: boolean };
};

export function hardenVerdict(input: HardenInput): HardenVerdict {
  const pboMax = input.pboMax ?? 0.3;
  const dsrMin = input.dsrMin ?? 0.95;
  const medianMin = input.medianMin ?? 0;
  const pboVal = pbo(input.returnsMatrix);
  const ds = deflatedSharpe(input.bestReturns, input.trialSharpes);
  const wf = multiFoldWalkForward(input.variants);
  const medianOos = median(wf.map((f) => f.oosSharpe));
  const pass = {
    pbo: pboVal < pboMax,
    dsr: ds.dsr > dsrMin,
    medianOos: medianOos > medianMin,
  };
  return {
    hardened: pass.pbo && pass.dsr && pass.medianOos,
    pbo: pboVal,
    dsr: ds.dsr,
    medianOos,
    folds: wf,
    sr: ds.sr,
    sr0: ds.sr0,
    pass,
  };
}
