/**
 * Becker empirical-calibration table for Polymarket binary contracts.
 *
 * Source: Jonathan Becker, 2026 — empirical study of 72.1M Polymarket
 * trades across $18.26B volume. Documents the **longshot bias** of the
 * crowd: contracts priced at 1¢ resolve YES only 0.43% of the time
 * (naive expectation: 1%). Contracts at 95¢ resolve YES 95.8% of the
 * time (slightly *under*-priced).
 *
 * Article reference: @de1lymoon "How To Use Markov Chains To Win Every
 * Single Trade" (2026-05-26) — saved at
 * docs/research/articles/de1lymoon-markov-chains-framework.md
 *
 * ## What this module does
 *
 * `calibrateProbability(rawP)` takes a model's "fair" probability
 * estimate and returns the empirically-corrected value. Use this to
 * post-process ANY probability that came from a model (Markov / Monte
 * Carlo / LLM oracle / etc.) before deciding whether to enter a trade
 * as a taker.
 *
 * `inferRawFromCalibrated(calP)` runs the inverse — given an empirical
 * resolution rate, what's the corresponding market price level the crowd
 * would assign. Useful for "is this market mispriced in the longshot-
 * bias direction" checks.
 *
 * `calibrationGap(rawP)` returns the percentage-point spread between
 * raw and calibrated. When this is ≥ 0.05 (5pp), the raw value is
 * noticeably overstating the true probability and acting on it without
 * calibration is dangerous.
 *
 * ## Important: this is a published-paper table, not OUR data
 *
 * The CALIBRATION_TABLE constants below are reproduced from the cited
 * article (which in turn cites Becker's analysis). They are *correct
 * for the population studied*. The article explicitly notes:
 *
 *   "the deciding factor turns out to be ... cleaner error handling
 *    [and] more conservative defaults"
 *
 * In other words: this is a fine baseline, but if/when we have enough
 * resolved-trade data of our own (via reconcile-polymarket-fills.ts +
 * decision_journal), we should re-derive these constants from our
 * actual fills and replace them. Until then: this is a calibration
 * *prior*, not a calibration *truth*.
 *
 * Pure functions only. No DB, no HTTP, no side effects.
 */

/**
 * Empirical resolution rates from Becker's 72.1M-trade analysis.
 * Keys are the naive (raw) probability — the "what should resolve YES
 * if the market were perfectly efficient". Values are the actual
 * fraction that did.
 *
 * Numbers below 0.50 are pulled UP slightly toward 0 (longshot
 * over-priced). Numbers above 0.50 are pulled UP slightly toward 1
 * (favorites slightly under-priced). The asymmetry around 0.50 reflects
 * the "Optimism Tax" the same article documents.
 */
export const CALIBRATION_TABLE: Readonly<Record<number, number>> = Object.freeze({
  0.01: 0.0043,
  0.05: 0.0418,
  0.10: 0.087,
  0.20: 0.181,
  0.30: 0.285,
  0.50: 0.500,
  0.70: 0.715,
  0.80: 0.819,
  0.90: 0.913,
  0.95: 0.958,
});

const SORTED_KEYS = Object.keys(CALIBRATION_TABLE)
  .map((k) => Number(k))
  .sort((a, b) => a - b);

/**
 * Map a raw model probability to its empirically-calibrated value
 * via linear interpolation across the Becker table.
 *
 * Edge cases:
 *  - rawP ≤ 0.01 → clamps to the 0.01 entry
 *  - rawP ≥ 0.95 → clamps to the 0.95 entry
 *  - NaN / non-finite → returns 0.5 (neutral fallback so a broken
 *    model doesn't accidentally produce a "high confidence" trade)
 */
export function calibrateProbability(rawP: number): number {
  if (!Number.isFinite(rawP)) return 0.5;
  if (rawP <= SORTED_KEYS[0]) return CALIBRATION_TABLE[SORTED_KEYS[0]];
  if (rawP >= SORTED_KEYS[SORTED_KEYS.length - 1]) return CALIBRATION_TABLE[SORTED_KEYS[SORTED_KEYS.length - 1]];
  for (let i = 0; i < SORTED_KEYS.length - 1; i++) {
    const lo = SORTED_KEYS[i];
    const hi = SORTED_KEYS[i + 1];
    if (rawP >= lo && rawP <= hi) {
      const frac = (rawP - lo) / (hi - lo);
      return CALIBRATION_TABLE[lo] + frac * (CALIBRATION_TABLE[hi] - CALIBRATION_TABLE[lo]);
    }
  }
  return rawP;
}

/**
 * Inverse of calibrateProbability — given an actual resolution rate,
 * approximate the naive probability the crowd would price it at.
 *
 * Same linear-interpolation strategy, walking the *values* of the
 * calibration table.
 */
export function inferRawFromCalibrated(calP: number): number {
  if (!Number.isFinite(calP)) return 0.5;
  const valuePairs = SORTED_KEYS.map((k) => [k, CALIBRATION_TABLE[k]] as const);
  if (calP <= valuePairs[0][1]) return valuePairs[0][0];
  if (calP >= valuePairs[valuePairs.length - 1][1]) return valuePairs[valuePairs.length - 1][0];
  for (let i = 0; i < valuePairs.length - 1; i++) {
    const [rawLo, calLo] = valuePairs[i];
    const [rawHi, calHi] = valuePairs[i + 1];
    if (calP >= calLo && calP <= calHi) {
      const frac = (calP - calLo) / (calHi - calLo);
      return rawLo + frac * (rawHi - rawLo);
    }
  }
  return calP;
}

/**
 * Percentage-point gap between raw and calibrated probability.
 * Positive = raw overstates true probability (longshot bias).
 * Negative = raw understates (uncommon — favorites zone).
 */
export function calibrationGap(rawP: number): number {
  return rawP - calibrateProbability(rawP);
}

/**
 * Convenience helper for guard clauses in strategies.
 * Returns true when the calibration adjustment is large enough that
 * acting on the raw value would be materially wrong (default 5pp).
 */
export function isCalibrationGapMaterial(rawP: number, thresholdPp = 0.05): boolean {
  return Math.abs(calibrationGap(rawP)) >= thresholdPp;
}
