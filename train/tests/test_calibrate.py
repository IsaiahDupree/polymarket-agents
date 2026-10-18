"""Tests for calibrate.py — the isotonic regression layer."""
from __future__ import annotations

import numpy as np
import pytest

from calibrate import fit_isotonic, apply_calibration, reliability_bins


class TestFitIsotonic:
    def test_monotone_output(self):
        """Isotonic output must be non-decreasing in input."""
        rng = np.random.default_rng(0)
        probs = rng.uniform(0, 1, 1000)
        y = (probs + 0.1 * rng.normal(0, 1, 1000) > 0.5).astype(float)
        xs, ys = fit_isotonic(probs, y)
        assert all(ys[i] <= ys[i + 1] + 1e-9 for i in range(len(ys) - 1))

    def test_uncalibrated_input_corrected_toward_actual(self):
        """If raw probs systematically underestimate (e.g. always 0.3 when
        truth is 0.6), isotonic should pull them up."""
        rng = np.random.default_rng(1)
        n = 2000
        # 60% positives, raw model emits 0.3 ± noise (badly miscalibrated).
        y = (rng.uniform(0, 1, n) < 0.6).astype(float)
        raw = np.clip(0.3 + 0.05 * rng.normal(0, 1, n), 0, 1)
        xs, ys = fit_isotonic(raw, y)
        cal = apply_calibration(raw, xs, ys)
        # After calibration the mean should be close to actual 0.6.
        assert abs(cal.mean() - y.mean()) < 0.05


class TestApplyCalibration:
    def test_handles_out_of_range_via_clip(self):
        xs = np.linspace(0, 1, 11)
        ys = xs ** 2
        # interp clips negative and >1 to bounds
        v1 = apply_calibration(np.array([-0.5]), xs, ys)
        v2 = apply_calibration(np.array([1.5]), xs, ys)
        assert v1[0] == ys[0]
        assert v2[0] == ys[-1]


class TestReliabilityBins:
    def test_perfect_calibration_zero_gap(self):
        """If preds == actuals, every bin has gap = 0."""
        rng = np.random.default_rng(2)
        n = 5000
        true_p = rng.uniform(0, 1, n)
        y = (rng.uniform(0, 1, n) < true_p).astype(float)
        bins = reliability_bins(true_p, y, n_bins=10)
        for b in bins:
            assert abs(b["mean_actual"] - b["mean_pred"]) < 0.05

    def test_empty_bin_skipped(self):
        # All predictions clustered at 0.5; outer bins should be empty
        # and absent from the result, not zero-filled.
        probs = np.full(100, 0.5)
        y = np.zeros(100)
        bins = reliability_bins(probs, y, n_bins=10)
        # Should have only the one bin containing 0.5
        assert all(b["n"] > 0 for b in bins)
        assert len(bins) >= 1
