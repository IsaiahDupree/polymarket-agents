"""Build a labeled dataset for GPU training from the live SQLite stores.

INPUT
  data/polymarket.db
      - api_call_cache    : raw Gamma /markets responses (price trajectories)
      - poly_binaries     : settled outcomes (label source)
      - book_snapshots    : 1Hz CLOB top-of-book (OFI features)

OUTPUT
  train/datasets/binary_outcomes.parquet
      One row per (binary slug, decision_tick) — the moment a strategy
      would have made a decision. Columns:
        slug, asset, recurrence, decision_ts, expiry_ts,
        min_to_resolution, yes_price, no_price, volume_usd, liquidity_usd,
        ofi_1s, ofi_5s, ofi_30s, total_bid_depth, total_ask_depth, spread,
        price_window_<n>  (n = -10..0 ticks of YES price),
        label_resolved_yes (1 / 0; nullable when still open)

Features that *cannot* be known at decision time (terminal price,
post-decision OFI) are excluded — this is the difference between a
classifier and a leak-prone fit.

USAGE
  train/.venv/Scripts/python train/build_dataset.py
  train/.venv/Scripts/python train/build_dataset.py --asset BTC --max-slugs 1000
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "polymarket.db"
OUT_DIR = REPO_ROOT / "train" / "datasets"
HISTORY_LOOKBACK = 10  # number of prior ticks used as the price-window feature


@dataclass
class CachedTick:
    """One point in a slug's YES-price trajectory."""

    fetched_at: str  # ISO
    yes_price: float
    no_price: Optional[float]
    volume_usd: Optional[float]
    liquidity_usd: Optional[float]
    end_iso: Optional[str]


def parse_gamma_body(body: str, fetched_at: str) -> Optional[CachedTick]:
    """Mirror of the TS parser in src/lib/backtest/cache-replay.ts."""
    if not body:
        return None
    try:
        parsed = json.loads(body)
    except Exception:
        return None
    if isinstance(parsed, list):
        if not parsed:
            return None
        first = parsed[0]
    else:
        first = parsed
    if not isinstance(first, dict):
        return None
    raw_prices = first.get("outcomePrices")
    prices: list[float] = []
    if isinstance(raw_prices, str):
        try:
            arr = json.loads(raw_prices)
            prices = [float(x) for x in arr if x is not None]
        except Exception:
            pass
    elif isinstance(raw_prices, list):
        prices = [float(x) for x in raw_prices if x is not None]
    if not prices:
        return None
    return CachedTick(
        fetched_at=fetched_at,
        yes_price=prices[0],
        no_price=prices[1] if len(prices) > 1 else None,
        volume_usd=first.get("volumeNum") or first.get("volume"),
        liquidity_usd=first.get("liquidity"),
        end_iso=first.get("endDate"),
    )


def slug_meta(slug: str) -> tuple[Optional[str], Optional[str]]:
    """Extract (asset, recurrence) from `<asset>-updown-<recurrence>-<ts>`."""
    parts = slug.split("-")
    if len(parts) < 4 or parts[1] != "updown":
        return (None, None)
    return (parts[0].upper(), parts[2].lower())


def iso_to_unix(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    try:
        # Tolerate trailing Z + microseconds.
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def iter_slugs(conn: sqlite3.Connection, asset: Optional[str], max_slugs: int) -> Iterator[str]:
    """Yield slugs ordered by trajectory length DESC — the deepest first so a
    small `--max-slugs` still gets the most useful examples instead of a
    random shallow sample."""
    sql = """
        SELECT query_string, COUNT(*) AS n
          FROM api_call_cache
         WHERE source = 'polymarket-gamma' AND endpoint = '/markets'
           AND query_string LIKE 'slug=%-updown-%'
    """
    params: list = []
    if asset:
        sql += " AND LOWER(query_string) LIKE ?"
        params.append(f"%{asset.lower()}-updown-%")
    sql += f" GROUP BY query_string ORDER BY n DESC LIMIT {int(max_slugs)}"
    for (qs, _n) in conn.execute(sql, params):
        if not qs.startswith("slug="):
            continue
        yield qs[len("slug=") :].split("&", 1)[0]


def load_trajectory(conn: sqlite3.Connection, slug: str) -> list[CachedTick]:
    rows = conn.execute(
        """
        SELECT response_body, fetched_at
          FROM api_call_cache
         WHERE source = 'polymarket-gamma'
           AND endpoint = '/markets'
           AND query_string = ?
         ORDER BY fetched_at ASC
        """,
        (f"slug={slug}",),
    ).fetchall()
    out: list[CachedTick] = []
    for body, fetched_at in rows:
        t = parse_gamma_body(body, fetched_at)
        if t is not None:
            out.append(t)
    return out


def label_for_slug(conn: sqlite3.Connection, slug: str) -> Optional[int]:
    """Resolved YES outcome from poly_binaries; None when still open."""
    row = conn.execute(
        """
        SELECT settled, outcome_yes
          FROM poly_binaries
         WHERE event_slug = ?
            OR question LIKE ?
         LIMIT 1
        """,
        (slug, f"%{slug}%"),
    ).fetchone()
    if row is None or not row[0] or row[1] is None:
        return None
    return int(row[1])


def book_features_at(
    conn: sqlite3.Connection, token_id: Optional[str], decision_ms: int
) -> dict:
    """Pull the most recent book snapshot ≤ decision_ms. Returns zeros when
    no book data is available (which is fine — pre-book-worker history)."""
    empty = {
        "ofi_1s": 0.0, "ofi_5s": 0.0, "ofi_30s": 0.0,
        "total_bid_depth": 0.0, "total_ask_depth": 0.0, "spread": 0.0,
    }
    if not token_id:
        return empty
    # Just return depths + spread for now; OFI computation requires the
    # rolling-event calculator which is a separate port. Punt to a Phase-B
    # feature add.
    row = conn.execute(
        """
        SELECT total_bid_depth, total_ask_depth, spread
          FROM book_snapshots
         WHERE token_id = ?
           AND ts_unix_ms <= ?
         ORDER BY ts_unix_ms DESC
         LIMIT 1
        """,
        (token_id, decision_ms),
    ).fetchone()
    if row is None:
        return empty
    out = dict(empty)
    out["total_bid_depth"] = float(row[0] or 0)
    out["total_ask_depth"] = float(row[1] or 0)
    out["spread"] = float(row[2] or 0)
    return out


def build_rows(
    conn: sqlite3.Connection, slug: str, history_lookback: int = HISTORY_LOOKBACK
) -> list[dict]:
    """One slug → N decision points (every tick after min history)."""
    traj = load_trajectory(conn, slug)
    if len(traj) <= history_lookback:
        return []
    asset, recurrence = slug_meta(slug)
    label = label_for_slug(conn, slug)
    out: list[dict] = []
    for i in range(history_lookback, len(traj)):
        cur = traj[i]
        end_unix = iso_to_unix(cur.end_iso)
        dec_unix = iso_to_unix(cur.fetched_at) or 0.0
        min_to_res = ((end_unix - dec_unix) / 60.0) if end_unix else None
        if min_to_res is not None and min_to_res < 0:
            continue  # decision-time later than expiry — skip
        window = [traj[j].yes_price for j in range(i - history_lookback, i)]
        row = {
            "slug": slug,
            "asset": asset,
            "recurrence": recurrence,
            "decision_ts": cur.fetched_at,
            "expiry_ts": cur.end_iso,
            "min_to_resolution": min_to_res,
            "yes_price": cur.yes_price,
            "no_price": cur.no_price,
            "volume_usd": cur.volume_usd,
            "liquidity_usd": cur.liquidity_usd,
            "label_resolved_yes": label,
        }
        # price_window_-10 .. price_window_-1
        for k, p in enumerate(window):
            row[f"price_window_{k - history_lookback}"] = p
        out.append(row)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--asset", default=None, help="Filter to one asset (BTC/ETH/SOL/XRP/DOGE).")
    ap.add_argument("--max-slugs", type=int, default=10_000)
    ap.add_argument("--out", default=str(OUT_DIR / "binary_outcomes.parquet"))
    ap.add_argument("--lookback", type=int, default=HISTORY_LOOKBACK)
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(args.db, isolation_level=None)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA query_only=ON")

    try:
        import pandas as pd
    except ImportError:
        print("pandas not installed; run train/.venv/Scripts/python -m pip install -r train/requirements.txt", file=sys.stderr)
        return 1

    rows: list[dict] = []
    n_slugs = 0
    n_with_label = 0
    for slug in iter_slugs(conn, args.asset, args.max_slugs):
        n_slugs += 1
        srows = build_rows(conn, slug, args.lookback)
        if not srows:
            continue
        if srows[0]["label_resolved_yes"] is not None:
            n_with_label += 1
        rows.extend(srows)
    df = pd.DataFrame(rows)
    print(f"slugs scanned : {n_slugs}")
    print(f"slugs labeled : {n_with_label}")
    print(f"rows total    : {len(df)}")
    print(f"rows labeled  : {df['label_resolved_yes'].notna().sum() if len(df) else 0}")
    if len(df):
        df.to_parquet(out_path, index=False)
        print(f"wrote         : {out_path}")
    else:
        print("no rows produced — wait for trajectories to deepen + more binaries to settle")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
