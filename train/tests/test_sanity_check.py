"""Tests for sanity_check.py — verifies each Check function returns the
right shape, the right pass/fail decision, and the right details payload.

These run against synthetic SQLite + tmp_path stubs — no live system
required. The point is to lock the check semantics so the operator can
trust "PASS" actually means PASS.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from sanity_check import (
    Check,
    check_db, check_cache, check_labels, check_mirror,
    check_backfill, check_disk, run_all, render_text,
)


def _make_db_with_tables(path: Path, *, has_cache: bool = True,
                          has_binaries: bool = True,
                          has_book_snapshots: bool = True) -> None:
    conn = sqlite3.connect(path)
    if has_cache:
        conn.execute("""
            CREATE TABLE api_call_cache (
                id INTEGER PRIMARY KEY,
                source TEXT NOT NULL, endpoint TEXT NOT NULL,
                query_string TEXT,
                response_status INTEGER NOT NULL,
                response_size_bytes INTEGER NOT NULL,
                response_body TEXT NOT NULL,
                fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
    if has_binaries:
        conn.execute("""
            CREATE TABLE poly_binaries (
                token_id TEXT PRIMARY KEY, condition_id TEXT NOT NULL,
                question TEXT NOT NULL, asset TEXT NOT NULL,
                duration_kind TEXT NOT NULL DEFAULT '5M',
                expiry_iso TEXT NOT NULL,
                settled INTEGER NOT NULL DEFAULT 0,
                outcome_yes INTEGER,
                event_slug TEXT
            )
        """)
    if has_book_snapshots:
        conn.execute("""
            CREATE TABLE book_snapshots (
                id INTEGER PRIMARY KEY, token_id TEXT NOT NULL,
                ts_unix_ms INTEGER NOT NULL,
                bid_price REAL, ask_price REAL
            )
        """)
    conn.commit()
    conn.close()


# ============================================================================
# check_db
# ============================================================================

class TestCheckDB:
    def test_missing_file_fails(self, tmp_path):
        c = check_db(tmp_path / "nope.db")
        assert c.ok is False
        assert "missing" in (c.issue or "")

    def test_missing_tables_fails(self, tmp_path):
        p = tmp_path / "x.db"
        _make_db_with_tables(p, has_book_snapshots=False)
        c = check_db(p)
        assert c.ok is False
        assert "book_snapshots" in (c.issue or "")

    def test_all_tables_present_passes(self, tmp_path):
        p = tmp_path / "ok.db"
        _make_db_with_tables(p)
        c = check_db(p)
        assert c.ok is True
        assert c.details["size_mb"] >= 0


# ============================================================================
# check_cache
# ============================================================================

class TestCheckCache:
    def test_empty_cache_fails(self, tmp_path):
        p = tmp_path / "x.db"
        _make_db_with_tables(p)
        c = check_cache(p)
        assert c.ok is False
        assert "empty" in (c.issue or "")

    def test_no_recent_rows_fails(self, tmp_path):
        p = tmp_path / "x.db"
        _make_db_with_tables(p)
        conn = sqlite3.connect(p)
        conn.execute(
            """INSERT INTO api_call_cache
               (source, endpoint, response_status, response_size_bytes, response_body, fetched_at)
               VALUES ('polymarket-gamma', '/markets', 200, 100, '[]', datetime('now','-1 hour'))""")
        conn.commit(); conn.close()
        c = check_cache(p)
        # Has data but no rows in last 5 min → fails freshness check.
        assert c.ok is False
        assert c.details["total_rows"] == 1
        assert c.details["recent_5min"] == 0

    def test_recent_rows_pass(self, tmp_path):
        p = tmp_path / "x.db"
        _make_db_with_tables(p)
        conn = sqlite3.connect(p)
        conn.execute(
            """INSERT INTO api_call_cache
               (source, endpoint, response_status, response_size_bytes, response_body)
               VALUES ('polymarket-gamma', '/markets', 200, 100, '[]')""")
        conn.commit(); conn.close()
        c = check_cache(p)
        assert c.ok is True
        assert c.details["by_source"]["polymarket-gamma"] == 1


# ============================================================================
# check_labels
# ============================================================================

class TestCheckLabels:
    def test_empty_binaries_fails(self, tmp_path):
        p = tmp_path / "x.db"
        _make_db_with_tables(p)
        c = check_labels(p)
        assert c.ok is False

    def test_low_coverage_fails(self, tmp_path):
        p = tmp_path / "x.db"
        _make_db_with_tables(p)
        conn = sqlite3.connect(p)
        # 10 rows, only 2 with outcome → 20% coverage → fail
        for i in range(10):
            outcome = 1 if i < 2 else None
            conn.execute(
                """INSERT INTO poly_binaries
                   (token_id, condition_id, question, asset, expiry_iso, outcome_yes)
                   VALUES (?, ?, 'Q', 'BTC', '2026-12-31T00:00:00Z', ?)""",
                (f"t{i}", f"0xc{i}", outcome))
        conn.commit(); conn.close()
        c = check_labels(p)
        assert c.ok is False
        assert c.details["label_coverage_pct"] == 20.0

    def test_high_coverage_passes(self, tmp_path):
        p = tmp_path / "x.db"
        _make_db_with_tables(p)
        conn = sqlite3.connect(p)
        for i in range(10):
            outcome = i % 2  # 50% with outcome 0, 50% with 1 → all labeled
            conn.execute(
                """INSERT INTO poly_binaries
                   (token_id, condition_id, question, asset, expiry_iso, outcome_yes)
                   VALUES (?, ?, 'Q', 'BTC', '2026-12-31T00:00:00Z', ?)""",
                (f"t{i}", f"0xc{i}", outcome))
        conn.commit(); conn.close()
        c = check_labels(p)
        assert c.ok is True
        assert c.details["label_coverage_pct"] == 100.0


# ============================================================================
# check_mirror — file age + size
# ============================================================================

class TestCheckMirror:
    def test_missing_mirror_fails(self, tmp_path):
        c = check_mirror(tmp_path / "nope.db")
        assert c.ok is False
        assert "missing" in (c.issue or "")

    def test_fresh_mirror_passes(self, tmp_path):
        p = tmp_path / "ok.db"
        p.write_bytes(b"x")
        c = check_mirror(p)
        assert c.ok is True
        assert c.details["age_minutes"] < 1

    def test_stale_mirror_fails(self, tmp_path):
        import os, time
        p = tmp_path / "stale.db"
        p.write_bytes(b"x")
        # Set mtime to 48 h ago
        two_days_ago = time.time() - 48 * 3600
        os.utime(p, (two_days_ago, two_days_ago))
        c = check_mirror(p)
        assert c.ok is False
        assert "stale" in (c.issue or "")


# ============================================================================
# check_backfill
# ============================================================================

class TestCheckBackfill:
    def test_neither_path_exists_fails(self, tmp_path):
        c = check_backfill(tmp_path / "a.db", tmp_path / "b.db")
        assert c.ok is False

    def test_table_missing_fails(self, tmp_path):
        p = tmp_path / "hist.db"
        conn = sqlite3.connect(p)
        conn.execute("CREATE TABLE other (x INT)")
        conn.commit(); conn.close()
        c = check_backfill(p, tmp_path / "ext.db")
        assert c.ok is False
        assert "historical_candles" in (c.issue or "")

    def test_table_present_passes(self, tmp_path):
        p = tmp_path / "hist.db"
        conn = sqlite3.connect(p)
        conn.execute("CREATE TABLE historical_candles (ts INTEGER)")
        for i in range(5):
            conn.execute("INSERT INTO historical_candles VALUES (?)", (i,))
        conn.commit(); conn.close()
        c = check_backfill(p, tmp_path / "ext.db")
        assert c.ok is True
        assert c.details["row_count"] == 5

    def test_prefers_external_path_when_both_exist(self, tmp_path):
        local = tmp_path / "local.db"
        ext = tmp_path / "ext.db"
        for p in (local, ext):
            conn = sqlite3.connect(p)
            conn.execute("CREATE TABLE historical_candles (ts INTEGER)")
            conn.commit(); conn.close()
        c = check_backfill(local, ext)
        assert c.ok is True
        # External takes precedence (E:\ is the operator's archive)
        assert str(ext) in c.details["path"]


# ============================================================================
# check_disk
# ============================================================================

class TestCheckDisk:
    def test_returns_data_for_each_path(self, tmp_path):
        c = check_disk(tmp_path)
        # tmp_path's anchor is typically C:\ or /; either way we should get one entry.
        assert len(c.details) >= 1
        for d in c.details.values():
            if "error" not in d:
                assert "free_gb" in d
                assert "total_gb" in d


# ============================================================================
# Integration — run_all + render_text + bitmap exit code
# ============================================================================

class TestRunAll:
    def test_all_fail_when_nothing_exists(self, tmp_path):
        checks, bitmap = run_all(
            tmp_path / "no.db",
            tmp_path / "no-mirror.db",
            tmp_path / "no-hist-local.db",
            tmp_path / "no-hist-ext.db",
        )
        # GPU may or may not exist; everything else must fail.
        check_names = [c.name for c in checks]
        assert "db" in check_names
        assert "labels" in check_names
        # Bitmap should have bits set for DB, cache, labels, mirror, backfill.
        # Specific bits depend on the ordering; just verify nonzero.
        assert bitmap > 0

    def test_render_text_doesnt_crash(self, tmp_path):
        checks, _ = run_all(
            tmp_path / "no.db", tmp_path / "no.db",
            tmp_path / "no.db", tmp_path / "no.db",
        )
        text = render_text(checks)
        assert "PASS" in text or "FAIL" in text  # at least one verdict
        assert "Training pipeline sanity check" in text
