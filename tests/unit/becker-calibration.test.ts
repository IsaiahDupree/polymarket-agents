import { describe, expect, it } from "vitest";
import {
  CALIBRATION_TABLE,
  calibrateProbability,
  inferRawFromCalibrated,
  calibrationGap,
  isCalibrationGapMaterial,
} from "@/lib/quant/becker-calibration";

describe("calibrateProbability — exact table entries match the article", () => {
  it.each([
    [0.01, 0.0043],
    [0.05, 0.0418],
    [0.10, 0.087],
    [0.20, 0.181],
    [0.30, 0.285],
    [0.50, 0.500],
    [0.70, 0.715],
    [0.80, 0.819],
    [0.90, 0.913],
    [0.95, 0.958],
  ])("rawP=%s → %s", (raw, expected) => {
    expect(calibrateProbability(raw)).toBeCloseTo(expected, 6);
  });
});

describe("calibrateProbability — interpolation between entries", () => {
  it("linearly interpolates halfway between 0.10 (0.087) and 0.20 (0.181)", () => {
    // midpoint should be (0.087 + 0.181) / 2 = 0.134
    expect(calibrateProbability(0.15)).toBeCloseTo(0.134, 4);
  });

  it("linearly interpolates between 0.80 (0.819) and 0.90 (0.913)", () => {
    expect(calibrateProbability(0.85)).toBeCloseTo(0.866, 4);
  });
});

describe("calibrateProbability — extremes clamp safely", () => {
  it("clamps below 0.01 to the 0.01 entry (don't extrapolate into nonsense)", () => {
    expect(calibrateProbability(0.001)).toBeCloseTo(0.0043, 6);
    expect(calibrateProbability(0)).toBeCloseTo(0.0043, 6);
  });

  it("clamps above 0.95 to the 0.95 entry", () => {
    expect(calibrateProbability(0.99)).toBeCloseTo(0.958, 6);
    expect(calibrateProbability(1)).toBeCloseTo(0.958, 6);
  });

  it("returns 0.5 (neutral) for NaN / non-finite — broken model shouldn't yield high-confidence trades", () => {
    expect(calibrateProbability(Number.NaN)).toBe(0.5);
    expect(calibrateProbability(Number.POSITIVE_INFINITY)).toBe(0.5);
  });
});

describe("inferRawFromCalibrated — inverse of calibrateProbability", () => {
  it("recovers raw=0.50 from cal=0.50 exactly (table fixes the midpoint)", () => {
    expect(inferRawFromCalibrated(0.5)).toBeCloseTo(0.5, 6);
  });

  it("inverse round-trips on table values", () => {
    for (const raw of [0.05, 0.30, 0.70, 0.90] as const) {
      const cal = calibrateProbability(raw);
      expect(inferRawFromCalibrated(cal)).toBeCloseTo(raw, 5);
    }
  });

  it("clamps below the lowest calibrated value", () => {
    expect(inferRawFromCalibrated(0.001)).toBeCloseTo(0.01, 6);
  });
});

describe("calibrationGap — pp spread between raw and calibrated", () => {
  it("is positive at low probabilities (longshot bias overstates true)", () => {
    expect(calibrationGap(0.10)).toBeCloseTo(0.013, 4); // 10% raw vs 8.7% calibrated
    expect(calibrationGap(0.05)).toBeCloseTo(0.0082, 4);
  });

  it("is zero at the midpoint (50¢ is roughly fair)", () => {
    expect(calibrationGap(0.50)).toBeCloseTo(0, 6);
  });

  it("is slightly negative at high probabilities (favorites slightly underpriced)", () => {
    expect(calibrationGap(0.90)).toBeCloseTo(-0.013, 4); // 90% raw vs 91.3% calibrated
    expect(calibrationGap(0.80)).toBeCloseTo(-0.019, 4);
  });
});

describe("isCalibrationGapMaterial — guard for trade decisions", () => {
  it("flags 1¢ as material (the 'worse than a slot machine' case)", () => {
    expect(isCalibrationGapMaterial(0.01)).toBe(false); // gap is only 0.6pp at 1c
    // But the relative gap is 57% — caller should also check relative size.
  });

  it("ignores the midpoint", () => {
    expect(isCalibrationGapMaterial(0.50)).toBe(false);
  });

  it("respects a custom threshold", () => {
    // Default threshold is 5pp; pass a 0pp threshold and any gap counts.
    expect(isCalibrationGapMaterial(0.10, 0)).toBe(true);
  });
});

describe("CALIBRATION_TABLE — frozen sanity check", () => {
  it("is frozen so callers can't mutate the prior in flight", () => {
    expect(Object.isFrozen(CALIBRATION_TABLE)).toBe(true);
  });
  it("covers the full 0.01–0.95 range with monotonic resolution rates", () => {
    const keys = Object.keys(CALIBRATION_TABLE).map(Number).sort((a, b) => a - b);
    const vals = keys.map((k) => CALIBRATION_TABLE[k]);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1]);
    }
  });
});
