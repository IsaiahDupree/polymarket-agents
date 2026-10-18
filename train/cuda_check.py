"""Verify PyTorch sees the RTX 4070 SUPER. Run after pip-install of torch.

Run with: train/.venv/Scripts/python train/cuda_check.py
"""
from __future__ import annotations

import sys
import torch


def main() -> int:
    print(f"python      : {sys.version.split()[0]}")
    print(f"torch       : {torch.__version__}")
    print(f"cuda built  : {torch.version.cuda}")
    print(f"cuda runtime: {'available' if torch.cuda.is_available() else 'MISSING'}")
    if not torch.cuda.is_available():
        print("\nFAIL — torch.cuda.is_available() is False.")
        print("Likely cause: torch installed without CUDA support.")
        print("Re-install with:")
        print("  train/.venv/Scripts/python -m pip install torch torchvision \\")
        print("      --index-url https://download.pytorch.org/whl/cu124")
        return 1
    n = torch.cuda.device_count()
    print(f"device count: {n}")
    for i in range(n):
        props = torch.cuda.get_device_properties(i)
        print(f"  [{i}] {props.name}  vram={props.total_memory / 1024**3:.1f} GiB  sm={props.major}.{props.minor}")
    # Tiny kernel to prove computation actually lands on the GPU.
    x = torch.randn(1024, 1024, device="cuda")
    y = x @ x.T
    torch.cuda.synchronize()
    print(f"matmul ok   : {y.shape}, dtype={y.dtype}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
