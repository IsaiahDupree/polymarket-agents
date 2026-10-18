"""Isotonic calibration for a trained LSTM checkpoint.

Why: AUC measures discrimination (do high-probability examples win
more often than low-probability ones?). It doesn't measure
*calibration* — whether the model's "0.65" actually means a 65% true
probability. A model with great AUC but miscalibrated probabilities
can't drive Kelly sizing or threshold-based decisions correctly.

Isotonic regression is the standard non-parametric calibrator:
  - Fits a monotone non-decreasing function P(true | model_p) from a
    held-out validation set
  - Preserves AUC (it's monotone) but reshapes the probability surface
  - Handles small samples better than Platt scaling on this scale

Usage:
  train/.venv/Scripts/python train/calibrate.py \
      --checkpoint train/checkpoints/lstm_v2.pt \
      --data train/datasets/v2.parquet \
      --out train/checkpoints/lstm_v2_calibrated.pt \
      --filter-ofi-only

The output checkpoint is a thin wrapper around the original with the
calibration map stored as `iso_x` / `iso_y` arrays — the inference
helper does a linear interp through those at decide time.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def fit_isotonic(probs, y):
    """Fit isotonic regression. Returns (xs, ys) — sorted unique input
    probabilities and the corresponding calibrated outputs. Inference is
    a numpy.interp call against these arrays."""
    from sklearn.isotonic import IsotonicRegression
    import numpy as np
    iso = IsotonicRegression(out_of_bounds="clip")
    iso.fit(probs, y)
    # Sample the fitted function on a dense grid so we don't carry the
    # sklearn dependency at decide time.
    xs = np.linspace(0, 1, 1001).astype(np.float64)
    ys = iso.predict(xs).astype(np.float64)
    return xs, ys


def apply_calibration(probs, xs, ys):
    """Apply the saved isotonic map to a probability array."""
    import numpy as np
    return np.interp(probs, xs, ys)


def reliability_bins(probs, y, n_bins: int = 10):
    """Returns per-bin (n, mean_pred, mean_actual) for the reliability
    diagram — operator can eyeball calibration quality."""
    import numpy as np
    edges = np.linspace(0, 1, n_bins + 1)
    out = []
    for i in range(n_bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (probs >= lo) & (probs < hi if i < n_bins - 1 else probs <= hi)
        n = int(mask.sum())
        if n == 0:
            continue
        out.append({
            "bin": f"[{lo:.2f},{hi:.2f})",
            "n": n,
            "mean_pred": float(probs[mask].mean()),
            "mean_actual": float(y[mask].mean()),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--filter-ofi-only", action="store_true")
    ap.add_argument("--asset", default=None)
    ap.add_argument("--val-split", type=float, default=0.2,
                    help="Tail fraction held out for calibration fit. Should "
                         "MATCH the training val-split so calibration uses "
                         "the same held-out set the model never trained on.")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    try:
        import numpy as np
        import pandas as pd
        import torch
        from sklearn.metrics import roc_auc_score, brier_score_loss
    except ImportError as e:
        print(f"missing dep: {e}", flush=True)
        return 1

    ckpt = torch.load(args.checkpoint, map_location="cuda" if torch.cuda.is_available() else "cpu",
                       weights_only=False)
    scalar_cols = ckpt["scalar_cols"]
    price_cols = ckpt["price_cols"]

    df = pd.read_parquet(args.data).dropna(subset=["label_resolved_yes"]).copy()
    if args.asset:
        df = df[df["asset"] == args.asset].copy()
    if args.filter_ofi_only:
        df = df[df["ofi_30s"] != 0].copy()
    if len(df) < 100:
        print(f"FAIL: only {len(df)} rows after filters, need 100+ for calibration.", flush=True)
        return 1

    # Same train/val split as the trainer.
    np.random.seed(args.seed)
    idx = np.random.permutation(len(df))
    cut = int(len(df) * (1 - args.val_split))
    val_idx = idx[cut:]
    df_val = df.iloc[val_idx].copy()

    for c in scalar_cols + price_cols:
        df_val[c] = pd.to_numeric(df_val[c], errors="coerce").fillna(0)
    sca = (df_val[scalar_cols].to_numpy("float32") - ckpt["sca_mean"]) / ckpt["sca_std"]
    seq = df_val[price_cols].to_numpy("float32").reshape(-1, len(price_cols), 1)
    y = df_val["label_resolved_yes"].to_numpy("float32")

    # Reconstruct the model architecture (matches train_lstm.py)
    class LSTMHead(torch.nn.Module):
        def __init__(self, sd, hidden, layers):
            super().__init__()
            self.lstm = torch.nn.LSTM(input_size=1, hidden_size=hidden, num_layers=layers,
                                       batch_first=True, bidirectional=True,
                                       dropout=0.1 if layers > 1 else 0)
            self.head = torch.nn.Sequential(
                torch.nn.Linear(hidden * 2 + sd, 64), torch.nn.ReLU(), torch.nn.Dropout(0.2),
                torch.nn.Linear(64, 1),
            )
        def forward(self, s, sc):
            o, _ = self.lstm(s)
            return self.head(torch.cat([o[:, -1, :], sc], dim=-1)).squeeze(-1)

    targs = ckpt["args"]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = LSTMHead(len(scalar_cols), targs["hidden"], targs["layers"]).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    # Predict in batches
    probs = []
    B = 4096
    with torch.no_grad():
        for i in range(0, len(df_val), B):
            s = torch.from_numpy(seq[i:i + B]).to(device)
            sc = torch.from_numpy(sca[i:i + B]).to(device)
            logits = model(s, sc)
            probs.extend(torch.sigmoid(logits).cpu().numpy().tolist())
    probs = np.array(probs)

    auc_raw = roc_auc_score(y, probs)
    brier_raw = brier_score_loss(y, probs)
    print(f"raw model:  AUC={auc_raw:.4f}  Brier={brier_raw:.4f}", flush=True)

    # Fit isotonic on the held-out set
    xs, ys = fit_isotonic(probs, y)
    calibrated = apply_calibration(probs, xs, ys)
    auc_cal = roc_auc_score(y, calibrated)
    brier_cal = brier_score_loss(y, calibrated)
    print(f"calibrated: AUC={auc_cal:.4f}  Brier={brier_cal:.4f}", flush=True)
    print(f"  Brier improvement: {brier_raw - brier_cal:+.4f}", flush=True)

    # Reliability diagram (operator readout)
    print("\nReliability diagram (calibrated, val set):")
    print(f"  {'bin':14s}  {'n':>6s}  {'pred':>6s}  {'actual':>7s}  {'gap':>6s}")
    for b in reliability_bins(calibrated, y):
        gap = b["mean_actual"] - b["mean_pred"]
        print(f"  {b['bin']:14s}  {b['n']:>6d}  {b['mean_pred']:6.3f}  {b['mean_actual']:7.3f}  {gap:+.3f}")

    # Save bundled checkpoint
    ckpt_out = dict(ckpt)
    ckpt_out["iso_x"] = xs
    ckpt_out["iso_y"] = ys
    ckpt_out["calibration"] = {
        "method": "isotonic", "n_val": len(y),
        "auc_raw": float(auc_raw), "auc_cal": float(auc_cal),
        "brier_raw": float(brier_raw), "brier_cal": float(brier_cal),
        "fit_filter_ofi_only": args.filter_ofi_only,
        "fit_asset": args.asset,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    torch.save(ckpt_out, args.out)
    print(f"\nsaved calibrated checkpoint -> {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
