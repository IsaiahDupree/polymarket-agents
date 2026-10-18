"""Export a trained PyTorch checkpoint to ONNX for TS-side inference.

ONNX is the cleanest way to run the trained model from the Node/tsx
arena code without shelling out to Python at every decide call.
`onnxruntime-node` loads the model once per process and runs inference
in tens of microseconds.

The ONNX file co-locates with the calibration map (saved as a sidecar
JSON because ONNX itself can't carry arbitrary metadata cleanly).

USAGE
  train/.venv/Scripts/python train/export_onnx.py \
      --checkpoint train/checkpoints/lstm_v2_ofi_ts_cal.pt \
      --out train/checkpoints/lstm_v2_ofi_ts_cal.onnx
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--out", required=True,
                    help="Output ONNX path. A sidecar .meta.json with the "
                         "scalar/price column order, normalization stats, "
                         "and isotonic map gets written next to it.")
    ap.add_argument("--opset", type=int, default=17)
    args = ap.parse_args()

    try:
        import numpy as np
        import torch
    except ImportError as e:
        print(f"missing dep: {e}", flush=True)
        return 1

    ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    scalar_cols = ckpt["scalar_cols"]
    price_cols = ckpt["price_cols"]
    lookback = ckpt.get("lookback", len(price_cols))

    # Re-create the model architecture
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
        def forward(self, seq, scalars):
            out, _ = self.lstm(seq)
            return self.head(torch.cat([out[:, -1, :], scalars], dim=-1)).squeeze(-1)

    targs = ckpt["args"]
    model = LSTMHead(len(scalar_cols), targs["hidden"], targs["layers"])
    model.load_state_dict(ckpt["model_state"])
    model.eval()

    # Dummy inputs — batch=1, seq_len=lookback, features=1 / scalars dim
    dummy_seq = torch.randn(1, lookback, 1, dtype=torch.float32)
    dummy_sca = torch.randn(1, len(scalar_cols), dtype=torch.float32)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    torch.onnx.export(
        model, (dummy_seq, dummy_sca), str(out_path),
        input_names=["seq", "scalars"],
        output_names=["logit"],
        dynamic_axes={"seq": {0: "batch"}, "scalars": {0: "batch"}, "logit": {0: "batch"}},
        opset_version=args.opset,
    )
    print(f"ONNX written: {out_path}", flush=True)

    # Sidecar metadata — TS reads this to know how to build the feature
    # vectors + apply normalization + run isotonic calibration.
    meta = {
        "scalar_cols": scalar_cols,
        "price_cols": price_cols,
        "lookback": int(lookback),
        "sca_mean": ckpt["sca_mean"].astype(float).flatten().tolist(),
        "sca_std": ckpt["sca_std"].astype(float).flatten().tolist(),
        "hidden": targs["hidden"],
        "layers": targs["layers"],
    }
    if "iso_x" in ckpt and "iso_y" in ckpt:
        meta["isotonic_x"] = ckpt["iso_x"].astype(float).tolist()
        meta["isotonic_y"] = ckpt["iso_y"].astype(float).tolist()
        meta["calibrated"] = True
    else:
        meta["calibrated"] = False
    meta_path = out_path.with_suffix(out_path.suffix + ".meta.json")
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"meta written: {meta_path}", flush=True)

    # Smoke test: load the ONNX with onnxruntime and verify it produces output
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(str(out_path), providers=["CPUExecutionProvider"])
        result = sess.run(None, {
            "seq": dummy_seq.numpy(),
            "scalars": dummy_sca.numpy(),
        })
        print(f"smoke test OK: output shape={result[0].shape}", flush=True)
    except ImportError:
        print("(onnxruntime not installed — skipping smoke test)", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
