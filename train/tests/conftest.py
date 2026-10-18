"""Shared pytest fixtures for the training pipeline test suite.

Most tests need a populated in-memory SQLite with the exact schema
shape of `data/polymarket.db` — api_call_cache + poly_binaries +
book_snapshots — and realistic fixture rows. These fixtures keep that
setup out of the individual tests.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Optional

import pytest

# Make the `train/` package importable from anywhere in the test tree.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ----------------------------------------------------------------------------
# Fixture data — mirrors a real Gamma /markets response. Locked to the schema
# the api_call_cache recorder writes (see src/lib/api-cache/recorder.ts).

def make_body(*, slug: str, p_yes: float, end_iso: str,
              start_iso: str = "2026-05-31T07:30:00Z",
              id_: str = "1", question: str = "BTC Up or Down",
              tok_yes: str = "tok-yes-1", tok_no: str = "tok-no-1",
              volume: float = 12.34, liquidity: float = 2456.7) -> str:
    """Build a Gamma /markets response body matching what the recorder writes.

    Constructed as a dict to avoid .format() colliding with JSON braces.
    `outcomePrices` and `clobTokenIds` are stringified arrays — matching
    Gamma's actual quirk where these two fields ship as JSON-encoded
    strings inside a JSON object.
    """
    obj = {
        "id": id_,
        "question": question,
        "conditionId": f"0xabcdef{id_}",
        "slug": slug,
        "outcomes": ["Up", "Down"],
        "outcomePrices": json.dumps([str(p_yes), str(round(1 - p_yes, 4))]),
        "clobTokenIds": json.dumps([tok_yes, tok_no]),
        "volume": str(volume),
        "volumeNum": volume,
        "liquidity": liquidity,
        "startDate": start_iso,
        "endDate": end_iso,
        "closed": False,
    }
    return json.dumps([obj])


@pytest.fixture
def empty_db() -> sqlite3.Connection:
    """Fresh in-memory SQLite with the schema the dataset builder expects."""
    conn = sqlite3.connect(":memory:")
    conn.executescript("""
        CREATE TABLE api_call_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            query_string TEXT,
            request_method TEXT NOT NULL DEFAULT 'GET',
            response_status INTEGER NOT NULL,
            response_size_bytes INTEGER NOT NULL,
            response_body TEXT NOT NULL,
            fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_apicache_query
            ON api_call_cache(endpoint, query_string)
            WHERE query_string IS NOT NULL;

        CREATE TABLE poly_binaries (
            token_id TEXT PRIMARY KEY,
            condition_id TEXT NOT NULL,
            no_token_id TEXT,
            question TEXT NOT NULL,
            asset TEXT NOT NULL,
            duration_kind TEXT NOT NULL DEFAULT '5M',
            start_iso TEXT,
            expiry_iso TEXT NOT NULL,
            reference_price REAL,
            settled INTEGER NOT NULL DEFAULT 0,
            outcome_yes INTEGER,
            resolved_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            event_slug TEXT
        );

        CREATE TABLE book_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id TEXT NOT NULL,
            ts_unix_ms INTEGER NOT NULL,
            bid_price REAL, bid_size REAL,
            ask_price REAL, ask_size REAL,
            midpoint REAL, spread REAL,
            total_bid_depth REAL, total_ask_depth REAL,
            n_bid_levels INTEGER, n_ask_levels INTEGER
        );
    """)
    return conn


def insert_cache_row(conn: sqlite3.Connection, *, slug: str, body: str,
                     fetched_at: str) -> None:
    """SQLite-default fetched_at is 'YYYY-MM-DD HH:MM:SS' (no tz). Tests
    pass either that or 'YYYY-MM-DDTHH:MM:SSZ' — both must work."""
    conn.execute(
        """INSERT INTO api_call_cache
           (source, endpoint, query_string, response_status, response_size_bytes,
            response_body, fetched_at)
           VALUES ('polymarket-gamma', '/markets', ?, 200, ?, ?, ?)""",
        (f"slug={slug}", len(body), body, fetched_at),
    )


def insert_binary(conn: sqlite3.Connection, *, slug: str, expiry_iso: str,
                  outcome_yes: int = 1, settled: int = 1,
                  question: str = "BTC Up or Down", asset: str = "BTC",
                  duration_kind: str = "5M",
                  yes_token: Optional[str] = None,
                  no_token: Optional[str] = None) -> None:
    conn.execute(
        """INSERT INTO poly_binaries
           (token_id, no_token_id, condition_id, question, asset, duration_kind, expiry_iso,
            settled, outcome_yes, event_slug)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (yes_token or f"tok-yes-{slug}", no_token or f"tok-no-{slug}",
         f"0xcond-{slug}", question, asset, duration_kind,
         expiry_iso, settled, outcome_yes, slug),
    )


def insert_book_snapshot(conn: sqlite3.Connection, *, token_id: str,
                          ts_unix_ms: int, bid_price: float, bid_size: float,
                          ask_price: float, ask_size: float,
                          total_bid_depth: float = 0.0,
                          total_ask_depth: float = 0.0) -> None:
    """Add a book_snapshots row for OFI / book-feature tests."""
    midpoint = (bid_price + ask_price) / 2
    spread = ask_price - bid_price
    conn.execute(
        """INSERT INTO book_snapshots
           (token_id, ts_unix_ms, bid_price, bid_size, ask_price, ask_size,
            midpoint, spread, total_bid_depth, total_ask_depth, n_bid_levels, n_ask_levels)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)""",
        (token_id, ts_unix_ms, bid_price, bid_size, ask_price, ask_size,
         midpoint, spread, total_bid_depth, total_ask_depth),
    )


@pytest.fixture
def populated_db(empty_db: sqlite3.Connection) -> sqlite3.Connection:
    """20 pre-expiry decision ticks + 5 post-expiry ticks for one BTC slug,
    plus the matching settled poly_binaries row."""
    SLUG = "btc-updown-5m-1780212600"
    EXPIRY = "2026-05-31T07:35:00Z"
    START = "2026-05-31T07:30:00Z"

    # 20 pre-expiry ticks at 15s cadence (07:30:00 → 07:34:45)
    for i in range(20):
        # Walking the YES price from 0.50 → 0.65
        p = round(0.50 + 0.0075 * i, 4)
        body = make_body(slug=SLUG, p_yes=p, end_iso=EXPIRY, start_iso=START,
                         id_="2392", question="Bitcoin Up or Down")
        # SQLite-default no-tz format — matches what the recorder writes.
        ts = f"2026-05-31 07:30:{i * 15:02d}".replace(":60", ":00")
        if (i * 15) >= 60:
            ts = f"2026-05-31 07:{30 + (i * 15) // 60:02d}:{(i * 15) % 60:02d}"
        insert_cache_row(empty_db, slug=SLUG, body=body, fetched_at=ts)

    # 5 post-expiry ticks (07:36 onwards)
    for i in range(5):
        p = 0.95 if i == 0 else 1.0
        body = make_body(slug=SLUG, p_yes=p, end_iso=EXPIRY, start_iso=START)
        ts = f"2026-05-31 07:{36 + i:02d}:00"
        insert_cache_row(empty_db, slug=SLUG, body=body, fetched_at=ts)

    insert_binary(empty_db, slug=SLUG, expiry_iso=EXPIRY, outcome_yes=1)
    empty_db.commit()
    return empty_db
