"""Smoke tests for the LSTM trainer.

These don't validate model quality (no real data) — they validate that
the training loop runs end-to-end on synthetic data, that mixed
precision works on the available device, and that the checkpoint
roundtrip preserves what we need for inference.

The dataset construction here mirrors what build_dataset.py emits so
the trainer accepts the parquet shape it'll see in production.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

# Skip the whole module when torch isn't importable — keeps CI environments
# that don't have a GPU sane.
torch = pytest.importorskip("torch")


HISTORY = 10
SCALAR_COLS = [
    "yes_price", "volume_usd", "liquidity_usd",
    "min_to_resolution", "total_bid_depth", "total_ask_depth", "spread",
]


def _make_synthetic_parquet(path: Path, n_rows: int = 500, seed: int = 42) -> None:
    """Build a fake parquet matching the build_dataset.py output schema."""
    rng = np.random.default_rng(seed)
    base_price = rng.uniform(0.3, 0.7, size=n_rows)
    rows = []
    for i in range(n_rows):
        p = base_price[i]
        # Walk price as a random walk + drift toward the label
        label = 1 if p > 0.5 else 0
        drift = 0.01 if label else -0.01
        window = np.clip(p + drift * np.arange(HISTORY) + rng.normal(0, 0.01, HISTORY), 0.01, 0.99)
        row = {
            "slug": f"x{i}", "asset": "BTC", "recurrence": "5m",
            "decision_ts": "2026-05-31 07:30:00", "expiry_ts": "2026-05-31T07:35:00Z",
            "min_to_resolution": float(rng.uniform(1, 10)),
            "yes_price": float(window[-1]),
            "no_price": float(1 - window[-1]),
            "volume_usd": float(rng.uniform(10, 5000)),
            "liquidity_usd": float(rng.uniform(100, 50_000)),
            "total_bid_depth": 0.0, "total_ask_depth": 0.0, "spread": 0.0,
            "label_resolved_yes": int(label),
        }
        for k in range(-HISTORY, 0):
            row[f"price_window_{k}"] = float(window[k + HISTORY])
        rows.append(row)
    pd.DataFrame(rows).to_parquet(path, index=False)


class TestSyntheticTraining:
    def test_synthetic_parquet_has_expected_shape(self, tmp_path):
        p = tmp_path / "fake.parquet"
        _make_synthetic_parquet(p, n_rows=200)
        df = pd.read_parquet(p)
        assert len(df) == 200
        for c in SCALAR_COLS + [f"price_window_{k}" for k in range(-HISTORY, 0)]:
            assert c in df.columns, f"missing {c}"
        assert df["label_resolved_yes"].notna().all()

    def test_trainer_runs_one_epoch_without_crashing(self, tmp_path, monkeypatch):
        """The smoke test we actually want — drive train_lstm.main() with
        a synthetic parquet, 2 epochs, tiny batch, no early-stop. Verify
        a checkpoint lands."""
        p = tmp_path / "fake.parquet"
        out = tmp_path / "ckpt.pt"
        _make_synthetic_parquet(p, n_rows=300)

        # Drive main() by manipulating sys.argv (the script is CLI-based).
        import sys
        import train_lstm
        argv_save = sys.argv
        try:
            sys.argv = [
                "train_lstm.py",
                "--data", str(p),
                "--out", str(out),
                "--epochs", "2",
                "--batch", "16",
                "--lr", "1e-3",
            ]
            rc = train_lstm.main()
            assert rc == 0, "trainer exit code"
        finally:
            sys.argv = argv_save

        assert out.exists(), "no checkpoint written"
        ckpt = torch.load(out, weights_only=False, map_location="cpu")
        assert "model_state" in ckpt
        assert "scalar_cols" in ckpt
        assert "price_cols" in ckpt
        assert "sca_mean" in ckpt and "sca_std" in ckpt
        # Verify the checkpoint can be used for inference
        assert ckpt["sca_mean"].shape[1] == len(SCALAR_COLS)

    def test_trainer_aborts_on_too_few_rows(self, tmp_path):
        p = tmp_path / "tiny.parquet"
        _make_synthetic_parquet(p, n_rows=50)  # below the 200-row floor
        import sys
        import train_lstm
        argv_save = sys.argv
        try:
            sys.argv = ["train_lstm.py", "--data", str(p), "--out",
                        str(tmp_path / "x.pt"), "--epochs", "1"]
            rc = train_lstm.main()
            assert rc == 1, "trainer should abort below row floor"
        finally:
            sys.argv = argv_save

    def test_trainer_class_weighted_runs_and_saves(self, tmp_path):
        """--class-weighted should not crash and should produce a checkpoint
        with the same structure as the default loss."""
        p = tmp_path / "synth.parquet"
        out = tmp_path / "cw.pt"
        _make_synthetic_parquet(p, n_rows=400, seed=7)
        import sys
        import train_lstm
        argv_save = sys.argv
        try:
            sys.argv = ["train_lstm.py", "--data", str(p), "--out", str(out),
                        "--epochs", "2", "--batch", "32", "--class-weighted"]
            rc = train_lstm.main()
            assert rc == 0
        finally:
            sys.argv = argv_save
        assert out.exists()
        ckpt = torch.load(out, weights_only=False, map_location="cpu")
        assert "model_state" in ckpt and "scalar_cols" in ckpt

    def test_trainer_time_stratified_split_runs(self, tmp_path):
        """--time-stratified-split should interleave train/val rows along
        decision_ts so no time window is val-only."""
        p = tmp_path / "synth.parquet"
        out = tmp_path / "ts.pt"
        _make_synthetic_parquet(p, n_rows=400, seed=11)
        # Synthetic data needs a decision_ts column for time-stratified.
        df = pd.read_parquet(p)
        df["decision_ts"] = pd.date_range("2026-01-01", periods=len(df),
                                            freq="1min").strftime("%Y-%m-%d %H:%M:%S")
        df.to_parquet(p, index=False)
        import sys
        import train_lstm
        argv_save = sys.argv
        try:
            sys.argv = ["train_lstm.py", "--data", str(p), "--out", str(out),
                        "--epochs", "2", "--batch", "32",
                        "--time-stratified-split"]
            rc = train_lstm.main()
            assert rc == 0
        finally:
            sys.argv = argv_save
        assert out.exists()


@pytest.mark.skipif(not torch.cuda.is_available(),
                    reason="CUDA not available — skipping GPU-specific test")
class TestGPU:
    def test_cuda_actually_used(self):
        """If the host claims CUDA is available, a simple computation must
        land on it."""
        x = torch.randn(64, 64, device="cuda")
        y = x @ x.T
        assert y.device.type == "cuda"
        assert y.shape == (64, 64)

    def test_mixed_precision_doesnt_explode(self):
        """The trainer uses autocast + GradScaler; verify on this device."""
        with torch.amp.autocast("cuda"):
            x = torch.randn(64, 64, device="cuda")
            y = x @ x.T
        assert torch.isfinite(y).all()
