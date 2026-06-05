"""Python port of the Cont-Kukanov-Stoikov Order Flow Imbalance calculator.

Original implementation: src/lib/quant/ofi.ts (TypeScript, used by the
arena's decide-time gates). This module is a faithful port for offline
feature extraction in build_dataset.py — the math has to match exactly
so a feature trained on the offline OFI predicts the same number the
live decide function would compute.

The signal interprets every change in top-of-book as a positive or
negative event:

    bid event = + size                  if bid price IMPROVED (rose)
                − previous bid size     if bid price WORSENED (fell)
                size_now − size_prev    if bid price unchanged (refresh)

    ask event = − size                  if ask price IMPROVED (fell)
                + previous ask size     if ask price WORSENED (rose)
                − (size_now − size_prev)  if ask price unchanged

The running sum over a `window_sec` rolling window is the OFI signal.
Positive values mean buy pressure; negative values mean sell pressure.
Cont et al. found R² > 65% relating OFI to short-horizon price changes.

Distinction from snapshot-based imbalance (OBI = depth ratio):
    OBI is computable from any snapshot.
    OFI requires the EVENT STREAM — what is CHANGING in the book.

Pure / deterministic. The same input sequence ALWAYS yields the same
OFI value.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass
class TopOfBookSample:
    """One book snapshot — units must be CONSISTENT (ts in seconds, or
    all in ms; the window_sec param uses the same unit)."""
    ts: float
    bid_px: float
    bid_sz: float
    ask_px: float
    ask_sz: float


class OFICalculator:
    """Stateful calculator — feed update() per snapshot, query value() any time."""

    def __init__(self, window_sec: float = 1.0) -> None:
        self.window_sec = window_sec
        self._events: list[tuple[float, float]] = []  # (ts, event_value)
        self._prev_bid_px: float | None = None
        self._prev_bid_sz = 0.0
        self._prev_ask_px = 0.0
        self._prev_ask_sz = 0.0

    def update(self, ts: float, bid_px: float, bid_sz: float,
               ask_px: float, ask_sz: float) -> float:
        """Feed a top-of-book update. Returns the OFI value AFTER this update
        — sum of events in the trailing window_sec. The first update primes
        the prev-state and returns 0 (no event yet)."""
        if self._prev_bid_px is None:
            self._prev_bid_px = bid_px
            self._prev_bid_sz = bid_sz
            self._prev_ask_px = ask_px
            self._prev_ask_sz = ask_sz
            return 0.0

        # Bid contribution
        if bid_px > self._prev_bid_px:
            e_bid = bid_sz                            # bid improved → buy pressure +size
        elif bid_px < self._prev_bid_px:
            e_bid = -self._prev_bid_sz                # bid worsened → prev depth removed
        else:
            e_bid = bid_sz - self._prev_bid_sz        # same price → net refresh

        # Ask contribution (sign flipped vs bid per Cont et al.)
        if ask_px < self._prev_ask_px:
            e_ask = -ask_sz                           # ask improved (fell) → sell pressure
        elif ask_px > self._prev_ask_px:
            e_ask = self._prev_ask_sz                 # ask worsened → sellers pulled back
        else:
            e_ask = -(ask_sz - self._prev_ask_sz)     # same price → net change in sell depth

        self._events.append((ts, e_bid + e_ask))
        # Drop events older than the rolling window
        while self._events and ts - self._events[0][0] > self.window_sec:
            self._events.pop(0)

        self._prev_bid_px = bid_px
        self._prev_bid_sz = bid_sz
        self._prev_ask_px = ask_px
        self._prev_ask_sz = ask_sz
        return sum(e[1] for e in self._events)

    def value(self) -> float:
        return sum(e[1] for e in self._events)

    def event_count(self) -> int:
        return len(self._events)


def run_ofi_over_history(samples: Sequence[TopOfBookSample],
                          window_sec: float = 1.0) -> float:
    """Replay an array of top-of-book samples through a fresh OFICalculator
    and return the final OFI value. Decide functions and the dataset
    builder both use this — instead of holding the calculator's state in
    process memory (which doesn't survive worker restarts), they replay
    the last N samples on demand.

    Returns 0 when fewer than 2 samples are supplied (no event possible)."""
    if len(samples) < 2:
        return 0.0
    c = OFICalculator(window_sec)
    for s in samples:
        c.update(s.ts, s.bid_px, s.bid_sz, s.ask_px, s.ask_sz)
    return c.value()


def normalize_ofi(ofi: float, scale_size: float) -> float:
    """Normalize OFI to [-1, +1]. `scale_size` is the size-magnitude that
    maps to ±1. Useful for dashboard surfacing or for use as a
    confirmation signal alongside OBI."""
    if scale_size <= 0:
        return 0.0
    x = ofi / scale_size
    return max(-1.0, min(1.0, x))
