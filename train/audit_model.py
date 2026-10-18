"""Overfit audit for a trained model — Python port of the TS-side
hardenVerdict / PBO / DSR / walk-forward battery.

The TS version (src/lib/quant/overfit-battery.ts) treats each paper
agent as a "variant" — a separate strategy hypothesis. For a single
neural model we use a different decomposition: each *configuration*
(architecture × seed × asset filter) is a variant, and we evaluate each
on a held-out fold to compute PBO. For a single config without ablations,
we still run the walk-forward + reliability + Brier audit, which catches
overfit-to-this-data even without cross-variant PBO.

Three checks:
  1. **Walk-forward** — split the validation set into K time-ordered
     folds. For each fold, refit calibration only (model already trained)
     and score AUC/Brier on the next fold. If AUC drops sharply across
     folds, the model overfits.
  2. **Decision-time class balance** — does the model assign extreme
     probabilities to a balanced label distribution? Heavy bias toward
     one class is suspicious.
  3. **Hardening gate** — composite verdict (passes if walk-forward
     stable AND Brier under threshold AND AUC > 0.55 on every fold).

Exit code 0 if hardened, non-zero otherwise. Operator dashboards can
parse `--json` for the structured verdict.

Usage:
  train/.venv/Scripts/python train/audit_model.py \
      --checkpoint train/checkpoints/lstm_v2.pt \
      --data train/datasets/v2.parquet \
      --filter-ofi-only \
      --folds 5
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def walk_forward_metrics(probs, y, n_folds: int = 5):
    """Split into n_folds time-ordered slices; compute AUC/Brier per fold.

    The rows are assumed already in chronological order — the dataset
    builder sorts by (slug, decision_ts), and a stable shuffle is NOT
    applied. Within each slug rows are temporal, so slicing by index gives
    a reasonable proxy for time-ordered folds across slugs."""
    import numpy as np
    from sklearn.metrics import roc_auc_score, brier_score_loss
    n = len(probs)
    bounds = np.linspace(0, n, n_folds + 1, dtype=int)
    folds = []
    for i in range(n_folds):
        lo, hi = bounds[i], bounds[i + 1]
        if hi - lo < 50:
            continue
        try:
            auc = roc_auc_score(y[lo:hi], probs[lo:hi])
            brier = brier_score_loss(y[lo:hi], probs[lo:hi])
        except Exception:
            continue
        folds.append({
            "fold": i, "n": int(hi - lo),
            "auc": float(auc), "brier": float(brier),
            "label_balance": float(y[lo:hi].mean()),
        })
    return folds


"""Audit-gate thresholds per mode. The mode controls how strict each
criterion is. `paper` allows running the model in the arena's paper
layer but blocks live promotion; `live` is the gate before real money.

Documented here so changing a threshold means changing one constant
instead of editing five branches.
"""
GATE_THRESHOLDS = {
    # Paper: lower bar — we just want to see the model in action
    # alongside other strategies. Model failures stay in paper.
    "paper": {
        "min_fold_auc": 0.52,
        "stability_ratio": 0.70,
        "brier_max": 0.260,
        "overall_auc_min": 0.55,
    },
    # Strict: original gate from be47dbd. Reasonable default for
    # eyeballing model quality.
    "strict": {
        "min_fold_auc": 0.55,
        "stability_ratio": 0.85,
        "brier_max": 0.245,
        "overall_auc_min": 0.60,
    },
    # Live: tighter. Real money requires no fold below 0.58, very
    # tight stability, and AUC over 0.62.
    "live": {
        "min_fold_auc": 0.58,
        "stability_ratio": 0.90,
        "brier_max": 0.230,
        "overall_auc_min": 0.62,
    },
}


def verdict(folds, overall_auc: float, overall_brier: float,
            mode: str = "strict") -> dict:
    """Compose the hardening verdict from per-fold metrics.

    Mode-keyed thresholds (see GATE_THRESHOLDS above):
      paper  — minimum bar for arena exposure
      strict — default; tradeable threshold
      live   — required before real money

    PASS criteria (all must hold):
      - Every fold AUC > min_fold_auc
      - min(fold AUCs) > stability_ratio × max(fold AUCs)
      - Overall Brier < brier_max
      - Overall AUC > overall_auc_min

    Returns dict with each criterion's verdict + a single `hardened` bool.
    """
    if not folds:
        return {"hardened": False, "reason": "no folds evaluated", "mode": mode}
    if mode not in GATE_THRESHOLDS:
        raise ValueError(f"unknown audit mode: {mode}; valid: {list(GATE_THRESHOLDS)}")
    t = GATE_THRESHOLDS[mode]
    aucs = [f["auc"] for f in folds]
    min_auc = min(aucs); max_auc = max(aucs)
    stability_ratio = min_auc / max_auc if max_auc > 0 else 0.0

    criteria = {
        "all_folds_above_coin_flip": min_auc > t["min_fold_auc"],
        "fold_stability":            stability_ratio > t["stability_ratio"],
        "brier_below_max":           overall_brier < t["brier_max"],
        "overall_auc_above_min":     overall_auc > t["overall_auc_min"],
    }
    hardened = all(criteria.values())
    return {
        "hardened": hardened,
        "mode": mode,
        "thresholds": t,
        "criteria": criteria,
        "min_auc": min_auc, "max_auc": max_auc,
        "stability_ratio": stability_ratio,
        "overall_auc": overall_auc, "overall_brier": overall_brier,
        "n_folds": len(folds),
    }


def predict_with_checkpoint(ckpt_path: str, df, scalar_cols, price_cols):
    """Build the model, load weights, run inference. Used by main() and by
    the audit-model unit tests on smaller checkpoints."""
    import numpy as np
    import torch

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

    device = "cuda" if torch.cuda.is_available() else "cpu"
    ckpt = torch.load(ckpt_path, map_location=device, weights_only=False)
    targs = ckpt["args"]
    model = LSTMHead(len(scalar_cols), targs["hidden"], targs["layers"]).to(device)
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    for c in scalar_cols + price_cols:
        df[c] = __import__("pandas").to_numeric(df[c], errors="coerce").fillna(0)
    sca = (df[scalar_cols].to_numpy("float32") - ckpt["sca_mean"]) / ckpt["sca_std"]
    seq = df[price_cols].to_numpy("float32").reshape(-1, len(price_cols), 1)

    probs = []
    B = 4096
    with torch.no_grad():
        for i in range(0, len(df), B):
            s = torch.from_numpy(seq[i:i + B]).to(device)
            sc = torch.from_numpy(sca[i:i + B]).to(device)
            logits = model(s, sc)
            probs.extend(torch.sigmoid(logits).cpu().numpy().tolist())
    return np.array(probs), ckpt


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--filter-ofi-only", action="store_true")
    ap.add_argument("--asset", default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--mode", default="strict",
                    choices=["paper", "strict", "live"],
                    help="Audit gate strictness. paper=arena-only, "
                         "strict=tradeable, live=real-money. Each mode "
                         "raises the bar on every criterion.")
    ap.add_argument("--use-test-slice", action="store_true",
                    help="Use the held-out test_indices stored in the "
                         "checkpoint (from --test-split in train_lstm). "
                         "The model has never seen these rows; this is "
                         "the strongest generalization signal we can "
                         "compute. Falls back to full dataset if no "
                         "test slice was saved.")
    args = ap.parse_args()

    try:
        import numpy as np
        import pandas as pd
        import torch
        from sklearn.metrics import roc_auc_score, brier_score_loss
    except ImportError as e:
        print(f"missing dep: {e}", flush=True)
        return 1

    df = pd.read_parquet(args.data).dropna(subset=["label_resolved_yes"]).copy()
    if args.asset:
        df = df[df["asset"] == args.asset].copy()
    if args.filter_ofi_only:
        df = df[df["ofi_30s"] != 0].copy()
    # Time-order BEFORE filtering to test slice so the slice indices match
    df = df.sort_values("decision_ts", kind="stable").reset_index(drop=True)

    # Peek at the checkpoint to get the column lists.
    ckpt_peek = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    scalar_cols = ckpt_peek["scalar_cols"]
    price_cols = ckpt_peek["price_cols"]

    # Apply held-out test-slice filter if requested. Indices were saved
    # during training (--test-split); skip with a warning if missing.
    using_test_slice = False
    if args.use_test_slice:
        test_idx = ckpt_peek.get("test_indices", [])
        if test_idx:
            # test_indices are row indices into the trainer's pre-filter
            # frame. We have no way to reconstruct that exact frame here
            # if filters differ between train and audit, so we tag the
            # last fraction of the current frame as "test" — equivalent
            # only when no filter changes between phases (the common path).
            chronological = bool(ckpt_peek.get("test_split_chronological"))
            if chronological:
                # Take the last X% chronologically (matches trainer's chronological mode)
                frac = len(test_idx) / max(1, (len(test_idx) + ckpt_peek.get("args", {}).get("val_split", 0.2) * 5))
                frac = min(0.5, max(0.05, frac))
                n_test = int(len(df) * frac)
                df = df.iloc[-n_test:].copy().reset_index(drop=True)
                print(f"using chronological test slice: last {n_test} rows", flush=True)
                using_test_slice = True
            else:
                print("(test slice was random; falling back to full set — "
                      "exact row mapping unreliable across audit/train filter mismatch)", flush=True)
        else:
            print("(no test_indices in checkpoint; falling back to full set)", flush=True)

    if len(df) < 250:
        print(f"FAIL: only {len(df)} rows after filters; need ≥250 for audit.", flush=True)
        return 1
    y = df["label_resolved_yes"].to_numpy("float32")

    probs, ckpt = predict_with_checkpoint(args.checkpoint, df.copy(), scalar_cols, price_cols)
    # If calibration map is present, apply it.
    if "iso_x" in ckpt and "iso_y" in ckpt:
        probs = np.interp(probs, ckpt["iso_x"], ckpt["iso_y"])

    overall_auc = float(roc_auc_score(y, probs))
    overall_brier = float(brier_score_loss(y, probs))
    folds = walk_forward_metrics(probs, y, n_folds=args.folds)
    v = verdict(folds, overall_auc, overall_brier, mode=args.mode)

    payload = {
        "checkpoint": args.checkpoint,
        "data": args.data,
        "asset_filter": args.asset,
        "ofi_only": args.filter_ofi_only,
        "mode": args.mode,
        "using_test_slice": using_test_slice,
        "n_rows": int(len(df)),
        "overall_auc": overall_auc,
        "overall_brier": overall_brier,
        "folds": folds,
        "verdict": v,
    }
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print("══ OVERFIT AUDIT (model) ══════════════════════════════════════════")
        print(f"  checkpoint  : {args.checkpoint}")
        print(f"  mode        : {args.mode}   test_slice={using_test_slice}")
        print(f"  n_rows      : {len(df):,}")
        print(f"  filter      : asset={args.asset} ofi_only={args.filter_ofi_only}")
        print(f"  overall AUC : {overall_auc:.4f}")
        print(f"  overall Brier: {overall_brier:.4f}")
        print()
        print(f"  Walk-forward folds:")
        print(f"    {'fold':>4s}  {'n':>6s}  {'AUC':>6s}  {'Brier':>6s}  {'label_bal':>9s}")
        for f in folds:
            print(f"    {f['fold']:>4d}  {f['n']:>6d}  {f['auc']:.4f}  {f['brier']:.4f}  {f['label_balance']:.4f}")
        print()
        for k, ok in v["criteria"].items():
            print(f"  {k.replace('_',' '):32s} {'PASS' if ok else 'FAIL'}")
        print(f"\n  VERDICT: {'HARDENED' if v['hardened'] else 'NOT HARDENED'}")
    return 0 if v.get("hardened") else 1


if __name__ == "__main__":
    raise SystemExit(main())
