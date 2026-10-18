"""Wrapper that trains one LSTM per asset and prints a comparison table.

Each asset's model is saved to train/checkpoints/lstm_v2_<asset>.pt with
the same args otherwise passed to train_lstm.py. The comparison at the
end shows per-asset AUC so the operator can see which slot has the most
signal.

Usage:
  train/.venv/Scripts/python train/train_per_asset.py \
      --data train/datasets/v2.parquet --epochs 30 --batch 256
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=256)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--out-dir", default="train/checkpoints")
    ap.add_argument("--assets", default="BTC,ETH,SOL,XRP,DOGE")
    ap.add_argument("--filter-ofi-only", action="store_true")
    args = ap.parse_args()

    try:
        import train_lstm
    except ImportError as e:
        print(f"missing dep: {e}", flush=True)
        return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    results = {}
    for asset in args.assets.split(","):
        asset = asset.strip().upper()
        if not asset:
            continue
        print(f"\n══ TRAINING {asset} ══════════════════════════════════════════")
        out_path = out_dir / f"lstm_per_asset_{asset.lower()}.pt"
        # Drive train_lstm.main() with sys.argv munging.
        argv_save = sys.argv
        sys.argv = [
            "train_lstm.py",
            "--data", args.data,
            "--out", str(out_path),
            "--epochs", str(args.epochs),
            "--batch", str(args.batch),
            "--lr", str(args.lr),
            "--asset", asset,
        ]
        if args.filter_ofi_only:
            sys.argv.append("--filter-ofi-only")
        try:
            rc = train_lstm.main()
            results[asset] = {"rc": rc, "checkpoint": str(out_path) if rc == 0 else None}
        except SystemExit as e:
            results[asset] = {"rc": int(e.code) if e.code else 1}
        except Exception as e:
            print(f"  {asset} crashed: {e}", flush=True)
            results[asset] = {"rc": 99, "error": str(e)}
        finally:
            sys.argv = argv_save

    print("\n══ PER-ASSET RESULTS ═════════════════════════════════════════════")
    print(f"  {'asset':>6s}  {'rc':>3s}  checkpoint")
    for asset, r in results.items():
        ck = r.get("checkpoint", "(none)")
        print(f"  {asset:>6s}  {r['rc']:>3d}  {ck}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
