# GPU training pipeline

Isolated Python venv for training neural models on the cached
trade-substrate. Lives outside the Node/tsx codebase on purpose — its
deps (torch, gymnasium, stable-baselines3) don't belong in the main
package graph.

## Hardware

Targets the local RTX 4070 SUPER (12 GiB VRAM, CUDA 13 driver, compute
8.9). Mixed-precision training (autocast + GradScaler at FP16) cuts
wall-clock ~2× vs FP32.

## Layout

```
train/
  .venv/                 (Python 3.12 venv, gitignored)
  requirements.txt       (everything except torch)
  cuda_check.py          (verify torch sees the 4070)
  build_dataset.py       (Phase B.2 — labeled binary outcomes)
  train_lstm.py          (Phase B.3a — sequence model → P(YES))
  train_ppo.py           (Phase B.3b — discrete-3 policy w/ reward shaping)
  datasets/              (built artifacts — gitignored)
  checkpoints/           (model weights — gitignored)
```

## One-time setup

```powershell
# Already done by Claude on 2026-06-05 — included for replay:
py -3.12 -m venv train/.venv
train/.venv/Scripts/python -m pip install --upgrade pip
train/.venv/Scripts/python -m pip install torch torchvision `
    --index-url https://download.pytorch.org/whl/cu124
train/.venv/Scripts/python -m pip install -r train/requirements.txt
train/.venv/Scripts/python train/cuda_check.py
```

The CUDA wheel index pins the right CUDA-12.4 build (works on a CUDA-13
driver — driver is backward compatible).

## Run the pipeline

```powershell
# 1. Build the labeled dataset from data/polymarket.db
train/.venv/Scripts/python train/build_dataset.py

# 2a. Train sequence model (predicts P(YES at expiry))
train/.venv/Scripts/python train/train_lstm.py --epochs 30

# 2b. Train RL policy (chooses HOLD / BUY_YES / BUY_NO)
train/.venv/Scripts/python train/train_ppo.py --steps 500_000

# 3. Evaluate via the same overfit battery the paper agents face
#    (PBO + DSR + walk-forward) — same gate, no double standard.
npm run audit:overfit
```

## Reward shape (PPO)

Directly encodes the operator's stated objective:

```
reward = realized_pnl
       - 0.02 * stake_used        # transaction cost penalty
       - 0.005 if action == HOLD  # inactivity penalty (rewards taking bets)
       - 0.10  if drawdown > 0.20 # bankroll preservation
```

The HOLD penalty is the one most likely to need re-tuning: too high and
the agent over-trades into noise; too low and it drifts to "do nothing"
(which always wins on win-rate but loses on the user's actual goal).

## Wiring into the arena (Phase C)

Once a model clears `audit:overfit`, the trained weights go into the
new `gpu_oracle` genome kind. See `src/lib/arena/sim.ts` after Phase C
ships — the genome calls a thin Node wrapper that runs ONNX inference
locally (no Python at runtime).
