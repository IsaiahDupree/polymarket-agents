"""Tests for audit_model.py — walk-forward + verdict."""
from __future__ import annotations

import numpy as np
import pytest

from audit_model import walk_forward_metrics, verdict


class TestWalkForwardMetrics:
    def test_returns_one_dict_per_fold(self):
        rng = np.random.default_rng(0)
        n = 1000
        probs = rng.uniform(0, 1, n)
        y = (probs > 0.5).astype(float)
        folds = walk_forward_metrics(probs, y, n_folds=5)
        assert len(folds) == 5
        for f in folds:
            assert {"fold", "n", "auc", "brier", "label_balance"} <= set(f.keys())

    def test_skips_tiny_folds(self):
        """Folds with fewer than 50 rows are skipped."""
        probs = np.linspace(0, 1, 100)
        y = (probs > 0.5).astype(float)
        # 10 folds × 10 rows each → all skipped
        folds = walk_forward_metrics(probs, y, n_folds=10)
        assert folds == []

    def test_handles_degenerate_label_distribution(self):
        """A fold with all-one labels can't compute AUC; should not crash."""
        probs = np.linspace(0, 1, 1000)
        y = np.ones(1000, dtype=np.float32)
        # Every fold has y all 1 → AUC undefined → folds list returned with valid entries only
        folds = walk_forward_metrics(probs, y, n_folds=5)
        # Either all skipped (caught by except) or none; just verify no crash.
        assert isinstance(folds, list)


class TestVerdict:
    def _folds(self, aucs, briers=None, n=200, label_bal=0.5):
        return [{"fold": i, "n": n, "auc": a,
                 "brier": (briers[i] if briers else 0.23),
                 "label_balance": label_bal}
                for i, a in enumerate(aucs)]

    def test_no_folds_is_not_hardened(self):
        v = verdict([], overall_auc=0.65, overall_brier=0.23)
        assert v["hardened"] is False

    def test_passes_when_all_criteria_met(self):
        folds = self._folds([0.62, 0.63, 0.64, 0.61, 0.62])
        v = verdict(folds, overall_auc=0.62, overall_brier=0.23)
        assert v["hardened"] is True
        assert v["criteria"]["all_folds_above_coin_flip"] is True
        assert v["criteria"]["fold_stability_85pct"] is True
        assert v["criteria"]["overall_auc_above_0_60"] is True

    def test_fails_when_one_fold_collapses(self):
        # 4 strong folds, 1 weak — stability ratio < 0.85
        folds = self._folds([0.65, 0.65, 0.65, 0.65, 0.50])
        v = verdict(folds, overall_auc=0.62, overall_brier=0.23)
        assert v["hardened"] is False
        assert v["criteria"]["fold_stability_85pct"] is False

    def test_fails_below_overall_auc_threshold(self):
        folds = self._folds([0.58, 0.58, 0.59, 0.58, 0.58])
        v = verdict(folds, overall_auc=0.58, overall_brier=0.23)
        assert v["hardened"] is False
        assert v["criteria"]["overall_auc_above_0_60"] is False

    def test_fails_high_brier(self):
        folds = self._folds([0.62, 0.63, 0.64, 0.61, 0.62])
        v = verdict(folds, overall_auc=0.62, overall_brier=0.30)
        assert v["hardened"] is False
        assert v["criteria"]["brier_below_0_245"] is False

    def test_fails_below_coin_flip_in_any_fold(self):
        folds = self._folds([0.62, 0.63, 0.54, 0.61, 0.62])
        v = verdict(folds, overall_auc=0.60, overall_brier=0.23)
        assert v["hardened"] is False
        assert v["criteria"]["all_folds_above_coin_flip"] is False
