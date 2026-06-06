"""Python port of src/lib/quant/overfit-battery.ts — the PBO/DSR/walk-
forward battery the TS-side arena uses for paper_agents.

These are the standard tests for "is this apparent edge real or is it
overfit / multiple-testing artifact?":

  PBO (Probability of Backtest Overfit)
      López de Prado 2014. Cross-validation-based: split the returns
      matrix into 2C bins, take all (C choose C) train/test splits,
      and count what fraction of "best in train" performs WORSE than
      median in test. PBO ∈ [0, 1]; standard "real edge" threshold is
      < 0.5. Tighter: < 0.30 for live promotion.

  DSR (Deflated Sharpe Ratio)
      Bailey + López de Prado 2014. Corrects Sharpe for trial-count
      inflation. Returns probability that the true Sharpe > 0.

  Multi-fold walk-forward
      Train on chronological IS slice; eval on rolling OOS chunks.
      The model's per-fold OOS Sharpe is the actual generalization
      signal (vs. the IS Sharpe which is fit-by-construction).

Used by:
  train/audit_model.py    Already uses walk-forward + hardenVerdict.
                          With this module's PBO port, the audit can
                          also report probability-of-overfit alongside.
  train/audit_classifier  (this file's main()) — extends the audit to
                          run all three batteries on a model's per-row
                          predictions and emit a unified verdict.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations
from typing import Sequence


def sharpe(returns: Sequence[float]) -> float:
    """Annualization-free Sharpe (mean / std). Use only for ranking
    across variants on the same return basis."""
    if len(returns) < 2:
        return 0.0
    import numpy as np
    arr = np.asarray(returns, dtype=float)
    if len(arr) < 2 or arr.std(ddof=1) < 1e-12:
        return 0.0
    return float(arr.mean() / arr.std(ddof=1))


def median(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    import numpy as np
    return float(np.median(np.asarray(values, dtype=float)))


def normal_cdf(x: float) -> float:
    """Φ via Abramowitz-Stegun 7.1.26. Pure Python so it works in tests
    without numpy."""
    # Lifted from src/lib/quant/overfit-battery.ts
    a1 = 0.254829592
    a2 = -0.284496736
    a3 = 1.421413741
    a4 = -1.453152027
    a5 = 1.061405429
    p = 0.3275911
    sign = 1.0 if x >= 0 else -1.0
    x = abs(x) / math.sqrt(2.0)
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
    return 0.5 * (1.0 + sign * y)


def deflated_sharpe(
    observed_sharpe: float,
    n_observations: int,
    trial_sharpes: Sequence[float],
    skewness: float = 0.0,
    excess_kurtosis: float = 0.0,
) -> float:
    """Bailey-LdP DSR. Returns the probability the true Sharpe > 0
    after accounting for the trial-count inflation. Uses the moment-
    corrected normal approximation from the paper.

    A standard "real edge" threshold is DSR > 0.95.
    """
    import numpy as np
    if n_observations < 2 or len(trial_sharpes) < 1:
        return 0.0
    n = n_observations
    arr = np.asarray(trial_sharpes, dtype=float)
    if arr.std(ddof=1) < 1e-12:
        # All trials degenerate (no variance) → can't deflate; use raw Sharpe.
        z = observed_sharpe * math.sqrt(n - 1)
        return normal_cdf(z)
    # Expected max Sharpe under H0 (no edge), for N trials.
    # See Bailey & LdP (2014) Eq. 8.
    var = arr.var(ddof=1)
    gamma = 0.5772156649  # Euler-Mascheroni
    n_trials = len(arr)
    if n_trials < 2:
        expected_max = 0.0
    else:
        expected_max = math.sqrt(var) * (
            (1 - gamma) * _phi_inv(1 - 1.0 / n_trials)
            + gamma * _phi_inv(1 - 1.0 / (n_trials * math.e))
        )
    # Deflated z-score
    denom = math.sqrt(
        max(1e-12,
            (1 - skewness * observed_sharpe
             + (excess_kurtosis - 1) / 4 * observed_sharpe ** 2)
            / (n - 1))
    )
    z = (observed_sharpe - expected_max) / denom
    return normal_cdf(z)


def _phi_inv(p: float) -> float:
    """Inverse standard normal CDF (Acklam's approximation)."""
    # Lifted from src/lib/quant/overfit-battery.ts
    if p <= 0 or p >= 1:
        return 0.0
    a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
         1.383577518672690e2, -3.066479806614716e1, 2.506628277459239]
    b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
         6.680131188771972e1, -1.328068155288572e1]
    c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
         -2.549732539343734, 4.374664141464968, 2.938163982698783]
    d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
         3.754408661907416]
    plow = 0.02425
    phigh = 1 - plow
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    if p <= phigh:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
               (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    q = math.sqrt(-2 * math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)


def pbo(returns_matrix: Sequence[Sequence[float]]) -> float:
    """López de Prado PBO via Combinatorially Symmetric Cross-Validation
    (CSCV). M[t][c] = return at time t for variant c. Splits time into
    2C bins, iterates all (C choose C) train/test splits, ranks
    variants in each, counts how often the best-in-train is BELOW
    median in test.

    Returns probability ∈ [0, 1]. < 0.5 = unlikely overfit; > 0.5 =
    apparent edge is probably noise.
    """
    import numpy as np
    M = np.asarray(returns_matrix, dtype=float)
    T, C = M.shape
    if C < 2 or T < 4:
        return 0.5  # Insufficient data — treat as uncertain
    # Split T into 2*S equal bins (S as large as possible while keeping
    # bins reasonable size). We use S = min(8, T // 4).
    S = max(2, min(8, T // 4))
    bin_size = T // (2 * S)
    if bin_size < 1:
        return 0.5
    bins = []
    for i in range(2 * S):
        lo = i * bin_size
        hi = (i + 1) * bin_size if i < 2 * S - 1 else T
        bins.append((lo, hi))
    # Iterate all (S of 2S) train/test splits
    losses = 0
    total = 0
    indices = list(range(2 * S))
    for train_combo in combinations(indices, S):
        test_combo = tuple(i for i in indices if i not in train_combo)
        train_idx = np.concatenate([np.arange(bins[i][0], bins[i][1]) for i in train_combo])
        test_idx = np.concatenate([np.arange(bins[i][0], bins[i][1]) for i in test_combo])
        if len(train_idx) < 2 or len(test_idx) < 2:
            continue
        # Train Sharpe per variant
        train_sharpe = []
        test_sharpe = []
        for c in range(C):
            train_sharpe.append(sharpe(M[train_idx, c].tolist()))
            test_sharpe.append(sharpe(M[test_idx, c].tolist()))
        train_arr = np.asarray(train_sharpe)
        test_arr = np.asarray(test_sharpe)
        best_in_train = int(train_arr.argmax())
        # PBO logit: 0 if best-train is below median-test, 1 otherwise
        median_test = float(np.median(test_arr))
        if test_arr[best_in_train] < median_test:
            losses += 1
        total += 1
    if total == 0:
        return 0.5
    return losses / total


@dataclass
class HardenedVerdict:
    """Composite verdict from PBO + DSR + walk-forward."""
    hardened: bool
    pbo: float
    dsr: float
    median_oos: float
    pass_pbo: bool
    pass_dsr: bool
    pass_median_oos: bool
    n_variants: int

    def as_dict(self) -> dict:
        return {
            "hardened": self.hardened,
            "pbo": self.pbo, "dsr": self.dsr, "median_oos": self.median_oos,
            "pass_pbo": self.pass_pbo, "pass_dsr": self.pass_dsr,
            "pass_median_oos": self.pass_median_oos,
            "n_variants": self.n_variants,
        }


def harden_verdict(
    returns_matrix: Sequence[Sequence[float]],
    variant_returns: Sequence[Sequence[float]],
    best_variant_returns: Sequence[float],
    *,
    pbo_threshold: float = 0.30,
    dsr_threshold: float = 0.95,
    median_oos_threshold: float = 0.0,
) -> HardenedVerdict:
    """Composite hardening: PBO + DSR + walk-forward median OOS > 0.

    Defaults match src/lib/quant/overfit-battery.ts and the TS-side
    audit:overfit gate. Override for paper-only (relaxed) audits.
    """
    pbo_val = pbo(returns_matrix)
    trial_sharpes = [sharpe(v) for v in variant_returns]
    best_sharpe = sharpe(best_variant_returns)
    dsr_val = deflated_sharpe(best_sharpe, len(best_variant_returns), trial_sharpes)
    # Median across the variants' walk-forward returns
    med_oos = median(best_variant_returns)
    p_pbo = pbo_val < pbo_threshold
    p_dsr = dsr_val > dsr_threshold
    p_oos = med_oos > median_oos_threshold
    return HardenedVerdict(
        hardened=p_pbo and p_dsr and p_oos,
        pbo=pbo_val, dsr=dsr_val, median_oos=med_oos,
        pass_pbo=p_pbo, pass_dsr=p_dsr, pass_median_oos=p_oos,
        n_variants=len(variant_returns),
    )
