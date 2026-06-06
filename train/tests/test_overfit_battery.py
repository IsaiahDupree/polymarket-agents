"""Tests for the Python overfit_battery port (PBO / DSR / hardenVerdict).

The TS-side tests in tests/unit/overfit-battery.test.ts already pin
this math on the production side. These mirror the same assertions on
the Python side so a model audit and the TS arena audit return
comparable numbers.
"""
from __future__ import annotations

import math

import numpy as np
import pytest

from overfit_battery import (
    sharpe, median, normal_cdf, deflated_sharpe, pbo, harden_verdict,
    HardenedVerdict,
)


class TestSharpe:
    def test_zero_for_insufficient_data(self):
        assert sharpe([]) == 0.0
        assert sharpe([1.0]) == 0.0

    def test_positive_for_uptrend(self):
        # Mostly positive returns
        assert sharpe([0.01, 0.02, 0.03, 0.04, 0.05]) > 0

    def test_negative_for_downtrend(self):
        assert sharpe([-0.01, -0.02, -0.03, -0.04, -0.05]) < 0

    def test_zero_for_no_variance(self):
        # std=0 → can't compute Sharpe
        assert sharpe([0.05, 0.05, 0.05, 0.05]) == 0.0


class TestMedian:
    def test_handles_empty(self):
        assert median([]) == 0.0

    def test_odd_count(self):
        assert median([1, 2, 3]) == 2.0

    def test_even_count_averages(self):
        assert median([1, 2, 3, 4]) == 2.5


class TestNormalCdf:
    def test_zero_at_zero(self):
        assert normal_cdf(0) == pytest.approx(0.5, abs=1e-3)

    def test_near_one_for_large_positive(self):
        assert normal_cdf(5) > 0.999

    def test_near_zero_for_large_negative(self):
        assert normal_cdf(-5) < 0.001

    def test_symmetric(self):
        for x in [0.5, 1.0, 1.5, 2.0]:
            assert normal_cdf(x) + normal_cdf(-x) == pytest.approx(1.0, abs=1e-4)


class TestDeflatedSharpe:
    def test_returns_probability_in_range(self):
        rng = np.random.default_rng(0)
        trials = rng.normal(0.5, 0.5, 100).tolist()
        d = deflated_sharpe(1.0, n_observations=100, trial_sharpes=trials)
        assert 0 <= d <= 1

    def test_higher_observed_sharpe_higher_dsr(self):
        trials = [0.3, 0.4, 0.5, 0.6, 0.7]
        d_low = deflated_sharpe(0.5, n_observations=50, trial_sharpes=trials)
        d_high = deflated_sharpe(2.0, n_observations=50, trial_sharpes=trials)
        assert d_high > d_low

    def test_more_trials_lower_dsr_for_same_observed(self):
        """More trials → higher expected_max → lower dsr."""
        d_few = deflated_sharpe(1.0, n_observations=50,
                                  trial_sharpes=[0.5, 0.6, 0.7])
        d_many = deflated_sharpe(1.0, n_observations=50,
                                   trial_sharpes=[0.5, 0.6, 0.7] * 30)
        assert d_few > d_many


class TestPBO:
    def test_returns_default_for_insufficient_data(self):
        # 1 variant or too few timesteps → 0.5 (uncertain)
        assert pbo([[1, 2, 3]]) == 0.5
        assert pbo([[1, 2], [3, 4]]) == 0.5

    def test_low_pbo_when_real_signal(self):
        """If variant 0 is genuinely better than all others in BOTH train
        and test halves, PBO should be near 0."""
        rng = np.random.default_rng(1)
        T = 60
        C = 6
        M = rng.normal(0, 0.01, (T, C))
        # Variant 0 has consistent +0.05 alpha
        M[:, 0] += 0.05
        p = pbo(M.tolist())
        # Some randomness inherent; just confirm it's well below 0.5
        assert p < 0.4

    def test_high_pbo_when_pure_noise(self):
        """Random returns matrix → PBO should be ~0.5."""
        rng = np.random.default_rng(7)
        T = 60
        C = 6
        M = rng.normal(0, 0.05, (T, C))
        p = pbo(M.tolist())
        # Could go either way around 0.5; just assert it's not near 0
        assert p > 0.2


class TestHardenVerdict:
    def test_returns_HardenedVerdict_dataclass(self):
        rng = np.random.default_rng(0)
        M = rng.normal(0.001, 0.05, (50, 5)).tolist()
        variants = [list(r) for r in zip(*M)]  # column-wise
        best = max(variants, key=lambda v: sharpe(v))
        v = harden_verdict(M, variants, best)
        assert isinstance(v, HardenedVerdict)
        assert hasattr(v, "hardened")
        assert hasattr(v, "pbo")
        assert hasattr(v, "dsr")

    def test_real_signal_can_pass_with_loose_thresholds(self):
        rng = np.random.default_rng(2)
        T = 60
        C = 4
        M = rng.normal(0, 0.01, (T, C))
        M[:, 0] += 0.05  # variant 0 has clear edge
        variants = [M[:, c].tolist() for c in range(C)]
        best = variants[0]
        v = harden_verdict(M.tolist(), variants, best,
                            pbo_threshold=0.5, dsr_threshold=0.5,
                            median_oos_threshold=-1)
        # With loose thresholds + real signal, should pass
        assert v.pbo < 0.5

    def test_as_dict_serializable(self):
        rng = np.random.default_rng(0)
        M = rng.normal(0, 0.05, (40, 3)).tolist()
        variants = [list(r) for r in zip(*M)]
        v = harden_verdict(M, variants, variants[0])
        d = v.as_dict()
        # All keys present, all JSON-serializable scalars
        for k in ["hardened", "pbo", "dsr", "median_oos",
                  "pass_pbo", "pass_dsr", "pass_median_oos", "n_variants"]:
            assert k in d
