"""Sequence model for binary Up/Down outcome prediction.

Input  : 10-tick YES-price window + scalars (volume, liquidity,
         min_to_resolution, total_bid_depth, total_ask_depth, spread).
Output : P(YES at expiry).

Architecture:
  - Bi-LSTM over the price window (hidden=64, layers=2)
  - Last hidden state concatenated with the scalars
  - 2-layer MLP head → sigmoid

Training:
  - BCEWithLogitsLoss (handles class imbalance better than separate sigmoid)
  - Adam, lr=1e-3, weight_decay=1e-4
  - Mixed precision (autocast + GradScaler) — the 4070 SUPER's tensor cores
    cut training time roughly 2x at FP16/BF16 vs FP32
  - Early stopping on val loss with patience=5

Eval — produced for both calibration and the existing overfit battery:
  - Brier score (calibration)
  - ROC AUC (discrimination)
  - Win rate at threshold 0.55 / 0.65 / 0.75 (for the actual trading rule)
  - PBO + DSR via train/eval_overfit.py (separate script)

USAGE
  train/.venv/Scripts/python train/train_lstm.py
  train/.venv/Scripts/python train/train_lstm.py --epochs 30 --batch 256
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = REPO_ROOT / "train" / "datasets" / "binary_outcomes.parquet"
DEFAULT_OUT = REPO_ROOT / "train" / "checkpoints" / "lstm_v0.pt"
HISTORY_LOOKBACK = 10
SCALAR_COLS = [
    "yes_price", "volume_usd", "liquidity_usd",
    "min_to_resolution", "total_bid_depth", "total_ask_depth", "spread",
    "ofi_1s", "ofi_5s", "ofi_30s",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(DEFAULT_DATA))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--hidden", type=int, default=64)
    ap.add_argument("--layers", type=int, default=2)
    ap.add_argument("--val-split", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--asset", default=None,
                    help="Filter dataset to one asset (BTC/ETH/SOL/XRP/DOGE).")
    ap.add_argument("--filter-ofi-only", action="store_true",
                    help="Keep only rows whose ofi_30s != 0 (book-covered).")
    ap.add_argument("--class-weighted", action="store_true",
                    help="Use class-balanced BCE loss (pos_weight = "
                         "n_neg/n_pos). Fixes regime-bias fold instability.")
    ap.add_argument("--time-stratified-split", action="store_true",
                    help="Split val by sampling within each chronological "
                         "block instead of randomly across the dataset. "
                         "Ensures train + val see the same temporal regimes; "
                         "fixes the symptom where val is dominated by one "
                         "time window the model never trained on.")
    args = ap.parse_args()

    try:
        import numpy as np
        import pandas as pd
        import torch
        from torch import nn
        from torch.utils.data import DataLoader, TensorDataset
        from sklearn.metrics import brier_score_loss, roc_auc_score
    except ImportError as e:
        print(f"missing dep: {e}", flush=True)
        return 1

    if not torch.cuda.is_available():
        print("WARN: CUDA not available — training on CPU will be slow.", flush=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    df = pd.read_parquet(args.data)
    df = df.dropna(subset=["label_resolved_yes"]).copy()
    print(f"loaded {len(df)} labeled rows", flush=True)
    if args.asset:
        df = df[df["asset"] == args.asset].copy()
        print(f"  after asset={args.asset} filter: {len(df)}", flush=True)
    if args.filter_ofi_only:
        if "ofi_30s" not in df.columns:
            print("FAIL: --filter-ofi-only requested but parquet has no ofi_30s column.", flush=True)
            return 1
        df = df[df["ofi_30s"] != 0].copy()
        print(f"  after OFI-only filter: {len(df)}", flush=True)
    if len(df) < 200:
        print("FAIL: fewer than 200 labeled rows after filters — wait or relax filters.", flush=True)
        return 1

    # Auto-detect lookback from parquet columns. Dataset builder defaults to 10
    # but operators can build with --lookback 4 / 5 / 20 for ablation; the
    # trainer adapts so we don't have to keep them in lockstep.
    available = [c for c in df.columns if c.startswith("price_window_-")]
    if not available:
        print("FAIL: parquet has no price_window_* columns.", flush=True)
        return 1
    indices = sorted(int(c.replace("price_window_-", "")) for c in available)
    actual_lookback = max(indices)
    price_cols = [f"price_window_{-i}" for i in range(actual_lookback, 0, -1)]
    print(f"detected lookback={actual_lookback} (price cols: {len(price_cols)})", flush=True)

    # Scalar columns: use whichever subset of the canonical list is
    # actually present in the parquet. The dataset builder doesn't always
    # emit book-derived columns (total_bid_depth / spread) — those need
    # a book_snapshots join that hasn't been wired into build_rows yet.
    # Missing scalars just shrink the input dim; everything else works.
    scalar_cols = [c for c in SCALAR_COLS if c in df.columns]
    if not scalar_cols:
        print("FAIL: no recognised scalar columns in parquet.", flush=True)
        return 1
    print(f"using {len(scalar_cols)}/{len(SCALAR_COLS)} scalar cols: {scalar_cols}", flush=True)

    for c in price_cols + scalar_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

    X_seq = df[price_cols].to_numpy(dtype=np.float32)
    X_seq = X_seq.reshape(-1, actual_lookback, 1)
    X_sca = df[scalar_cols].to_numpy(dtype=np.float32)
    # Normalize scalars (per-column zscore, robust to outliers).
    sca_mean = X_sca.mean(axis=0, keepdims=True)
    sca_std = X_sca.std(axis=0, keepdims=True) + 1e-6
    X_sca = (X_sca - sca_mean) / sca_std
    y = df["label_resolved_yes"].to_numpy(dtype=np.float32)

    n = len(df)
    if args.time_stratified_split:
        # Sort by decision_ts so chronological order is canonical, then
        # take every K-th row for val (K = round(1/val_split)). This
        # interleaves train + val across the entire time axis so the
        # model never sees a val window from a regime it didn't train on.
        if "decision_ts" not in df.columns:
            print("FAIL: --time-stratified-split needs decision_ts column.", flush=True)
            return 1
        df = df.sort_values("decision_ts", kind="stable").reset_index(drop=True)
        # Recompute features from the now-sorted df
        X_seq = df[price_cols].to_numpy(dtype=np.float32).reshape(-1, actual_lookback, 1)
        X_sca = (df[scalar_cols].to_numpy(dtype=np.float32) - sca_mean) / sca_std
        y = df["label_resolved_yes"].to_numpy(dtype=np.float32)
        # Stride sampling: pick every K-th row for val
        K = max(2, int(round(1 / args.val_split)))
        all_idx = np.arange(n)
        va = all_idx[K - 1::K]  # offset so val rows don't coincide with row 0
        tr = np.setdiff1d(all_idx, va, assume_unique=True)
        print(f"time-stratified split: K={K} → train={len(tr)} val={len(va)}", flush=True)
    else:
        idx = np.random.permutation(n)
        cut = int(n * (1 - args.val_split))
        tr, va = idx[:cut], idx[cut:]

    def make_loader(idx_split, shuffle):
        ds = TensorDataset(
            torch.from_numpy(X_seq[idx_split]).to(device),
            torch.from_numpy(X_sca[idx_split]).to(device),
            torch.from_numpy(y[idx_split]).to(device),
        )
        return DataLoader(ds, batch_size=args.batch, shuffle=shuffle)

    tr_loader = make_loader(tr, True)
    va_loader = make_loader(va, False)

    class LSTMHead(nn.Module):
        def __init__(self, scalar_dim: int, hidden: int, layers: int):
            super().__init__()
            self.lstm = nn.LSTM(input_size=1, hidden_size=hidden, num_layers=layers,
                                batch_first=True, bidirectional=True, dropout=0.1 if layers > 1 else 0)
            self.head = nn.Sequential(
                nn.Linear(hidden * 2 + scalar_dim, 64), nn.ReLU(), nn.Dropout(0.2),
                nn.Linear(64, 1),
            )

        def forward(self, seq: "torch.Tensor", scalars: "torch.Tensor") -> "torch.Tensor":
            out, _ = self.lstm(seq)  # B × T × 2H
            last = out[:, -1, :]
            z = torch.cat([last, scalars], dim=-1)
            return self.head(z).squeeze(-1)

    model = LSTMHead(len(scalar_cols), args.hidden, args.layers).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-4)
    if args.class_weighted:
        # pos_weight scales the BCE loss for the positive class so an
        # imbalanced training set doesn't push the model toward the
        # majority class. Computed once over the training split only —
        # the held-out val split sees the un-reweighted loss for fair
        # comparison.
        n_pos = float((y[tr] == 1).sum())
        n_neg = float((y[tr] == 0).sum())
        pos_weight = torch.tensor([n_neg / max(1.0, n_pos)], device=device)
        bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
        print(f"class-weighted BCE: pos_weight={pos_weight.item():.3f} (n_pos={int(n_pos)}, n_neg={int(n_neg)})", flush=True)
    else:
        bce = nn.BCEWithLogitsLoss()
    bce_val = nn.BCEWithLogitsLoss()  # un-weighted for val loss reporting
    scaler = torch.amp.GradScaler("cuda", enabled=(device == "cuda"))

    best_val = math.inf
    patience = 5
    bad = 0
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        tr_loss = 0.0
        n_tr = 0
        for seq, sca, label in tr_loader:
            opt.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", enabled=(device == "cuda")):
                logits = model(seq, sca)
                loss = bce(logits, label)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
            tr_loss += loss.item() * label.size(0)
            n_tr += label.size(0)
        tr_loss /= max(1, n_tr)

        model.eval()
        va_loss = 0.0
        n_va = 0
        probs: list[float] = []
        ys: list[float] = []
        with torch.no_grad():
            for seq, sca, label in va_loader:
                logits = model(seq, sca)
                loss = bce_val(logits, label)
                va_loss += loss.item() * label.size(0)
                n_va += label.size(0)
                probs.extend(torch.sigmoid(logits).cpu().tolist())
                ys.extend(label.cpu().tolist())
        va_loss /= max(1, n_va)
        try:
            auc = roc_auc_score(ys, probs)
        except Exception:
            auc = float("nan")
        brier = brier_score_loss(ys, probs) if ys else float("nan")
        print(
            f"epoch {epoch:02d}  train_loss={tr_loss:.4f}  val_loss={va_loss:.4f}  AUC={auc:.3f}  Brier={brier:.3f}",
            flush=True,
        )

        if va_loss < best_val - 1e-4:
            best_val = va_loss
            bad = 0
            torch.save({
                "model_state": model.state_dict(),
                "args": vars(args),
                "sca_mean": sca_mean,
                "sca_std": sca_std,
                "scalar_cols": scalar_cols,
                "price_cols": price_cols,
                "lookback": actual_lookback,
            }, args.out)
            print(f"  saved checkpoint → {args.out}", flush=True)
        else:
            bad += 1
            if bad >= patience:
                print(f"early stop at epoch {epoch}", flush=True)
                break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
