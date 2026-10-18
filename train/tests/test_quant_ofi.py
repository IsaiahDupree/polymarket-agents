"""Tests for the Python OFI port.

The math here MUST match src/lib/quant/ofi.ts byte-for-byte because the
arena's live decide functions consume the TS version and the dataset
builder consumes this Python one — a trained model would see different
features at train vs decide time if they diverge.

The TS-side tests in tests/unit/ofi.test.ts pin the same behaviors.
"""
from __future__ import annotations

import pytest

from quant_ofi import (
    OFICalculator,
    TopOfBookSample,
    run_ofi_over_history,
    normalize_ofi,
)


class TestOFICalculator:
    def test_first_update_primes_state_returns_zero(self):
        c = OFICalculator(window_sec=10)
        assert c.update(0, 0.50, 100, 0.51, 100) == 0.0

    def test_bid_improved_adds_size(self):
        """Bid price rises → buy pressure of +new_size."""
        c = OFICalculator(window_sec=10)
        c.update(0, 0.50, 100, 0.55, 100)  # prime
        # Bid moves 0.50 → 0.51, ask stays
        ofi = c.update(1, 0.51, 80, 0.55, 100)
        # e_bid = +80, e_ask = -(100-100) = 0 → +80
        assert ofi == pytest.approx(80)

    def test_bid_worsened_removes_prev_depth(self):
        """Bid price falls → -prev_bid_size (those liquidity providers vanished)."""
        c = OFICalculator(window_sec=10)
        c.update(0, 0.50, 100, 0.55, 100)
        ofi = c.update(1, 0.49, 200, 0.55, 100)
        # e_bid = -100 (prev size), e_ask = 0 → -100
        assert ofi == pytest.approx(-100)

    def test_bid_same_price_uses_size_delta(self):
        """Same bid price → net refresh = size_now - size_prev."""
        c = OFICalculator(window_sec=10)
        c.update(0, 0.50, 100, 0.55, 100)
        ofi = c.update(1, 0.50, 130, 0.55, 100)
        # e_bid = +30, e_ask = 0 → +30
        assert ofi == pytest.approx(30)

    def test_ask_improved_subtracts_size(self):
        """Ask falls → sellers stepping in → -new_ask_size."""
        c = OFICalculator(window_sec=10)
        c.update(0, 0.50, 100, 0.55, 100)
        ofi = c.update(1, 0.50, 100, 0.54, 50)
        # e_bid = 0, e_ask = -50 → -50
        assert ofi == pytest.approx(-50)

    def test_ask_worsened_adds_prev_size(self):
        """Ask rises → sellers pulled back → +prev_ask_size."""
        c = OFICalculator(window_sec=10)
        c.update(0, 0.50, 100, 0.55, 100)
        ofi = c.update(1, 0.50, 100, 0.56, 80)
        # e_bid = 0, e_ask = +100 (prev) → +100
        assert ofi == pytest.approx(100)

    def test_ask_same_price_negated_delta(self):
        """Same ask price → -(size_now - size_prev)."""
        c = OFICalculator(window_sec=10)
        c.update(0, 0.50, 100, 0.55, 100)
        ofi = c.update(1, 0.50, 100, 0.55, 120)
        # e_bid = 0, e_ask = -(120-100) = -20
        assert ofi == pytest.approx(-20)

    def test_rolling_window_drops_old_events(self):
        c = OFICalculator(window_sec=2)
        c.update(0, 0.50, 100, 0.55, 100)  # prime
        c.update(1, 0.51, 100, 0.55, 100)  # +100 at t=1
        c.update(2, 0.51, 100, 0.55, 100)  # 0 (same)
        ofi_at_3 = c.update(4, 0.51, 100, 0.55, 100)
        # The t=1 event has age=3, exceeds window=2 → dropped.
        # Only the t=2 (=0) and t=4 (=0) survive.
        assert ofi_at_3 == pytest.approx(0)

    def test_event_count_grows_with_events(self):
        c = OFICalculator(window_sec=10)
        assert c.event_count() == 0
        c.update(0, 0.5, 100, 0.55, 100)
        assert c.event_count() == 0  # priming doesn't add event
        c.update(1, 0.51, 100, 0.55, 100)
        assert c.event_count() == 1


class TestRunOfiOverHistory:
    def test_empty_returns_zero(self):
        assert run_ofi_over_history([]) == 0.0

    def test_single_sample_returns_zero(self):
        s = [TopOfBookSample(ts=0, bid_px=0.5, bid_sz=100, ask_px=0.55, ask_sz=100)]
        assert run_ofi_over_history(s) == 0.0

    def test_matches_stateful_calculator(self):
        """The functional helper should yield the same value as feeding the
        same samples through a stateful calculator."""
        samples = [
            TopOfBookSample(ts=i, bid_px=0.50 + 0.001 * i,
                             bid_sz=100, ask_px=0.55 - 0.001 * i, ask_sz=100)
            for i in range(5)
        ]
        c = OFICalculator(window_sec=10)
        for s in samples:
            c.update(s.ts, s.bid_px, s.bid_sz, s.ask_px, s.ask_sz)
        assert run_ofi_over_history(samples, window_sec=10) == pytest.approx(c.value())

    def test_buy_pressure_positive_ofi(self):
        """Steady bid uptick + ask uptick → strong buy pressure."""
        samples = [
            TopOfBookSample(ts=0, bid_px=0.50, bid_sz=100, ask_px=0.55, ask_sz=100),
            TopOfBookSample(ts=1, bid_px=0.51, bid_sz=100, ask_px=0.56, ask_sz=100),
            TopOfBookSample(ts=2, bid_px=0.52, bid_sz=100, ask_px=0.57, ask_sz=100),
        ]
        ofi = run_ofi_over_history(samples, window_sec=10)
        assert ofi > 0

    def test_sell_pressure_negative_ofi(self):
        """Bid downtick + ask downtick → strong sell pressure."""
        samples = [
            TopOfBookSample(ts=0, bid_px=0.50, bid_sz=100, ask_px=0.55, ask_sz=100),
            TopOfBookSample(ts=1, bid_px=0.49, bid_sz=100, ask_px=0.54, ask_sz=100),
            TopOfBookSample(ts=2, bid_px=0.48, bid_sz=100, ask_px=0.53, ask_sz=100),
        ]
        ofi = run_ofi_over_history(samples, window_sec=10)
        assert ofi < 0


class TestNormalizeOfi:
    def test_zero_scale_returns_zero(self):
        assert normalize_ofi(100, 0) == 0.0
        assert normalize_ofi(100, -1) == 0.0

    def test_within_range(self):
        assert normalize_ofi(50, 100) == pytest.approx(0.5)
        assert normalize_ofi(-25, 100) == pytest.approx(-0.25)

    def test_saturates_above_one(self):
        assert normalize_ofi(500, 100) == 1.0

    def test_saturates_below_minus_one(self):
        assert normalize_ofi(-500, 100) == -1.0
