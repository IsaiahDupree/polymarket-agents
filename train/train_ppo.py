"""PPO trading policy on the cached trajectories.

Distinct from train_lstm.py — the LSTM predicts P(YES). This trains a
*policy* that chooses an action at every tick. Reward shape directly
encodes the operator's objective:

  reward = realized_pnl
           - 0.02 * stake_used      # transaction cost
           - 0.005 if action == HOLD # inactivity penalty
           - 0.10 if drawdown_pct > 0.20  # bankroll preservation

The policy sees only past + current-tick features (no leakage). Episode
horizon = one binary's lifecycle from first cached tick to settlement
(or to end of cache if unsettled — those episodes get truncated and
contribute no terminal reward).

Action space (discrete-3):
  0 = HOLD
  1 = BUY_YES at the current ask (stake = STAKE_USD)
  2 = BUY_NO  at the current ask

Observation space:
  - 10 prior YES prices
  - current YES price, NO price
  - volume, liquidity, min_to_resolution
  - total_bid_depth, total_ask_depth, spread
  - position state (-1 NO held, 0 flat, +1 YES held)

USAGE (after train/build_dataset.py has produced binary_outcomes.parquet)
  train/.venv/Scripts/python train/train_ppo.py --steps 200_000
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = REPO_ROOT / "train" / "datasets" / "binary_outcomes.parquet"
DEFAULT_OUT = REPO_ROOT / "train" / "checkpoints" / "ppo_v0.zip"

STAKE_USD = 2.0
COST_FRAC = 0.02
HOLD_PENALTY = 0.005
DD_BANK_PENALTY = 0.10
DD_THRESHOLD = 0.20


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(DEFAULT_DATA))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--steps", type=int, default=200_000)
    ap.add_argument("--n-envs", type=int, default=8)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    try:
        import numpy as np
        import pandas as pd
        import gymnasium as gym
        from gymnasium import spaces
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import SubprocVecEnv
    except ImportError as e:
        print(f"missing dep: {e}\nrun: train/.venv/Scripts/python -m pip install -r train/requirements.txt", flush=True)
        return 1

    df = pd.read_parquet(args.data)
    if len(df) < 1000:
        print(f"FAIL: only {len(df)} rows — wait for more cache to accumulate before PPO training.", flush=True)
        return 1
    # Group by slug → list of per-tick rows in chronological order.
    df = df.sort_values(["slug", "decision_ts"]).reset_index(drop=True)
    slugs = df["slug"].unique().tolist()
    print(f"loaded {len(df)} ticks across {len(slugs)} slugs", flush=True)

    class BinaryEnv(gym.Env):
        """One binary slug lifecycle = one episode."""

        metadata = {"render_modes": []}

        def __init__(self, slug_pool: list[str], rng_seed: int = 0):
            super().__init__()
            self.slug_pool = slug_pool
            self.rng = np.random.default_rng(rng_seed)
            self.action_space = spaces.Discrete(3)
            obs_dim = 10 + 2 + 3 + 3 + 1  # window + (yes,no) + (vol,liq,t2r) + (bd,ad,spr) + position
            self.observation_space = spaces.Box(low=-10, high=10, shape=(obs_dim,), dtype=np.float32)
            self._ticks: list[pd.Series] = []
            self._t = 0
            self._position = 0  # -1, 0, +1
            self._entry_price = 0.0
            self._cash = 0.0
            self._peak = 0.0
            self._terminal_label: Optional[int] = None

        def _features(self, row) -> "np.ndarray":
            win = [row[f"price_window_{i}"] for i in range(-10, 0)]
            scalars = [
                row.get("yes_price", 0.0), row.get("no_price", 0.0),
                (row.get("volume_usd") or 0.0) / 1000.0,
                (row.get("liquidity_usd") or 0.0) / 1000.0,
                (row.get("min_to_resolution") or 0.0) / 60.0,
                (row.get("total_bid_depth") or 0.0) / 1000.0,
                (row.get("total_ask_depth") or 0.0) / 1000.0,
                row.get("spread") or 0.0,
                float(self._position),
            ]
            return np.asarray(win + scalars, dtype=np.float32)

        def reset(self, *, seed=None, options=None):
            super().reset(seed=seed)
            slug = self.rng.choice(self.slug_pool)
            self._ticks = df[df["slug"] == slug].to_dict("records")
            self._t = 0
            self._position = 0
            self._entry_price = 0.0
            self._cash = 0.0
            self._peak = 0.0
            self._terminal_label = (
                int(self._ticks[0]["label_resolved_yes"])
                if self._ticks and self._ticks[0]["label_resolved_yes"] is not None
                else None
            )
            return self._features(self._ticks[self._t]), {}

        def step(self, action: int):
            row = self._ticks[self._t]
            reward = 0.0
            # Transaction logic.
            if action == 1 and self._position == 0:
                self._position = 1
                self._entry_price = float(row["yes_price"])
                reward -= COST_FRAC * STAKE_USD
            elif action == 2 and self._position == 0:
                self._position = -1
                self._entry_price = float(row.get("no_price") or (1 - row["yes_price"]))
                reward -= COST_FRAC * STAKE_USD
            elif action == 0:
                reward -= HOLD_PENALTY
            # Advance time.
            self._t += 1
            terminated = self._t >= len(self._ticks)
            truncated = False
            if terminated:
                if self._position != 0 and self._terminal_label is not None:
                    won = (self._position == 1 and self._terminal_label == 1) or (
                        self._position == -1 and self._terminal_label == 0
                    )
                    payoff = 1.0 if won else 0.0
                    pnl = (STAKE_USD / max(0.01, self._entry_price)) * payoff - STAKE_USD
                    reward += pnl
                    self._cash += pnl
                # Bankroll-preservation penalty
                self._peak = max(self._peak, self._cash)
                dd = (self._peak - self._cash) / max(1.0, self._peak)
                if dd > DD_THRESHOLD:
                    reward -= DD_BANK_PENALTY
                obs = self._features(self._ticks[-1])
            else:
                obs = self._features(self._ticks[self._t])
            return obs, reward, terminated, truncated, {}

    def make_env(rank: int):
        def _init():
            env = BinaryEnv(slugs, rng_seed=args.seed + rank)
            return env
        return _init

    vec = SubprocVecEnv([make_env(i) for i in range(args.n_envs)])
    model = PPO(
        "MlpPolicy", vec,
        learning_rate=args.lr,
        n_steps=2048, batch_size=256, n_epochs=10,
        gamma=0.99, gae_lambda=0.95, clip_range=0.2, ent_coef=0.01,
        device="cuda" if __import__("torch").cuda.is_available() else "cpu",
        verbose=1,
    )
    model.learn(total_timesteps=args.steps)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    model.save(args.out)
    print(f"saved policy → {args.out}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
