r"""Operator health CLI — checks every piece of the training pipeline.

Run as the first thing you do when sitting down at the box. Reports:
  - GPU detection + VRAM
  - SQLite DB exists + has expected tables + has data
  - api_call_cache: row count, freshness, per-source breakdown
  - poly_binaries: label coverage (settled + outcome_yes set)
  - Mirror destination: exists, recent, size
  - Disk space: laptop SSD + external (E:\)
  - Backfill DB (historical-candles.db): present + tables

Exit code 0 = all checks pass. Non-zero = something needs attention,
return code = bitmask of which subsystem failed (so CI / cron can
react). The actual error is logged via the structured logger.

USAGE
  train/.venv/Scripts/python train/sanity_check.py
  train/.venv/Scripts/python train/sanity_check.py --json
  train/.venv/Scripts/python train/sanity_check.py --tabular
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO_ROOT / "data" / "polymarket.db"
DEFAULT_HIST_DB = REPO_ROOT / "data" / "historical-candles.db"
DEFAULT_HIST_DB_E = Path("E:/Coding/datasets/historical-candles.db")
DEFAULT_MIRROR = Path("E:/Coding/datasets/polymarket-archive.db")

# Bit positions for the exit-code bitmask
BIT_GPU = 0
BIT_DB = 1
BIT_CACHE = 2
BIT_LABELS = 3
BIT_MIRROR = 4
BIT_BACKFILL = 5
BIT_DISK = 6


@dataclass
class Check:
    name: str
    ok: bool
    details: dict[str, Any] = field(default_factory=dict)
    issue: str | None = None


def check_gpu() -> Check:
    try:
        import torch  # noqa
    except ImportError:
        return Check("gpu", False, issue="torch not installed in this venv")
    try:
        avail = torch.cuda.is_available()
        if not avail:
            return Check("gpu", False, issue="torch reports no CUDA device")
        n = torch.cuda.device_count()
        devices = []
        for i in range(n):
            p = torch.cuda.get_device_properties(i)
            devices.append({
                "id": i, "name": p.name,
                "vram_gib": round(p.total_memory / 1024**3, 2),
                "compute_capability": f"{p.major}.{p.minor}",
            })
        return Check("gpu", True, details={"devices": devices, "cuda_built": torch.version.cuda})
    except Exception as e:
        return Check("gpu", False, issue=f"torch error: {e}")


def check_db(db_path: Path) -> Check:
    if not db_path.exists():
        return Check("db", False, issue=f"missing: {db_path}")
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA query_only=ON")
        tables_required = ["api_call_cache", "poly_binaries", "book_snapshots"]
        present = set(r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"))
        missing = [t for t in tables_required if t not in present]
        if missing:
            return Check("db", False, issue=f"missing tables: {missing}",
                         details={"present": sorted(present)})
        size_mb = db_path.stat().st_size / 1024**2
        return Check("db", True, details={
            "path": str(db_path), "size_mb": round(size_mb, 1),
            "tables_required_present": tables_required,
        })
    except Exception as e:
        return Check("db", False, issue=f"DB error: {e}")
    finally:
        try: conn.close()
        except: pass


def check_cache(db_path: Path) -> Check:
    if not db_path.exists():
        return Check("cache", False, issue="db missing")
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA query_only=ON")
        total = conn.execute("SELECT COUNT(*) FROM api_call_cache").fetchone()[0]
        if total == 0:
            return Check("cache", False, issue="api_call_cache is empty")
        last = conn.execute(
            "SELECT MAX(fetched_at) FROM api_call_cache").fetchone()[0]
        sources = {}
        for src, n in conn.execute(
                "SELECT source, COUNT(*) FROM api_call_cache GROUP BY source"):
            sources[src] = n
        # Freshness: anything cached in the last 5 min?
        recent = conn.execute(
            "SELECT COUNT(*) FROM api_call_cache "
            "WHERE fetched_at >= datetime('now','-5 minutes')").fetchone()[0]
        ok = recent > 0
        return Check("cache",
                     ok,
                     issue=None if ok else "no rows written in last 5 minutes — recorder may be down",
                     details={"total_rows": total, "last_fetched_at": last,
                              "recent_5min": recent, "by_source": sources})
    except Exception as e:
        return Check("cache", False, issue=f"cache check error: {e}")
    finally:
        try: conn.close()
        except: pass


def check_labels(db_path: Path) -> Check:
    if not db_path.exists():
        return Check("labels", False, issue="db missing")
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA query_only=ON")
        total = conn.execute("SELECT COUNT(*) FROM poly_binaries").fetchone()[0]
        settled = conn.execute(
            "SELECT COUNT(*) FROM poly_binaries WHERE settled=1").fetchone()[0]
        with_outcome = conn.execute(
            "SELECT COUNT(*) FROM poly_binaries WHERE outcome_yes IS NOT NULL").fetchone()[0]
        with_event_slug = conn.execute(
            "SELECT COUNT(*) FROM poly_binaries WHERE event_slug IS NOT NULL").fetchone()[0]
        unsettled_past_expiry = conn.execute(
            "SELECT COUNT(*) FROM poly_binaries "
            "WHERE settled=0 AND expiry_iso < datetime('now')").fetchone()[0]
        ok = total > 0 and with_outcome / max(1, total) > 0.5
        return Check(
            "labels", ok,
            issue=None if ok else f"insufficient labeled binaries (total={total} settled={settled})",
            details={"total": total, "settled": settled,
                     "with_outcome": with_outcome,
                     "with_event_slug": with_event_slug,
                     "unsettled_past_expiry": unsettled_past_expiry,
                     "label_coverage_pct": round(100 * with_outcome / max(1, total), 1)})
    except Exception as e:
        return Check("labels", False, issue=f"labels check error: {e}")
    finally:
        try: conn.close()
        except: pass


def check_mirror(path: Path) -> Check:
    if not path.exists():
        return Check("mirror", False, issue=f"mirror file missing: {path}")
    try:
        size_gb = path.stat().st_size / 1024**3
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        age = datetime.now(tz=timezone.utc) - mtime
        # Mirror counts as "fresh" if updated in the last 24 h.
        ok = age < timedelta(hours=24)
        return Check("mirror", ok,
                     issue=None if ok else f"mirror stale: last updated {mtime.isoformat()} ({age} ago)",
                     details={"path": str(path), "size_gb": round(size_gb, 2),
                              "last_updated": mtime.isoformat(),
                              "age_minutes": round(age.total_seconds() / 60, 1)})
    except Exception as e:
        return Check("mirror", False, issue=f"mirror check error: {e}")


def check_backfill(local_path: Path, ext_path: Path) -> Check:
    r"""Look for historical-candles.db at either the default local path
    or the E:\ override."""
    found = None
    for p in (ext_path, local_path):
        if p.exists():
            found = p
            break
    if found is None:
        return Check("backfill", False,
                     issue=f"historical-candles.db not found at {local_path} or {ext_path}")
    try:
        conn = sqlite3.connect(found)
        conn.execute("PRAGMA query_only=ON")
        tables = sorted(r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"))
        size_mb = found.stat().st_size / 1024**2
        # Best-effort: count rows in candles table if present
        row_count = None
        if "historical_candles" in tables:
            row_count = conn.execute(
                "SELECT COUNT(*) FROM historical_candles").fetchone()[0]
        ok = "historical_candles" in tables or "candles" in tables
        return Check("backfill", ok,
                     issue=None if ok else "expected `historical_candles` table not present",
                     details={"path": str(found), "size_mb": round(size_mb, 1),
                              "tables": tables, "row_count": row_count})
    except Exception as e:
        return Check("backfill", False, issue=f"backfill check error: {e}")
    finally:
        try: conn.close()
        except: pass


def check_disk(*paths: Path) -> Check:
    out = {}
    ok = True
    for p in paths:
        try:
            # Use the path's drive root for disk stats.
            anchor = Path(p.anchor) if p.anchor else p
            total, used, free = shutil.disk_usage(str(anchor))
            free_gb = free / 1024**3
            out[str(anchor)] = {"free_gb": round(free_gb, 1),
                                 "total_gb": round(total / 1024**3, 1),
                                 "used_pct": round(100 * used / total, 1)}
            if free_gb < 10:  # less than 10 GiB free is a yellow flag
                ok = False
        except Exception as e:
            out[str(p)] = {"error": str(e)}
            ok = False
    return Check("disk", ok,
                 issue=None if ok else "low disk space (<10 GiB)",
                 details=out)


def run_all(db_path: Path, mirror_path: Path,
            hist_local: Path, hist_ext: Path) -> tuple[list[Check], int]:
    checks = [
        check_gpu(),
        check_db(db_path),
        check_cache(db_path),
        check_labels(db_path),
        check_mirror(mirror_path),
        check_backfill(hist_local, hist_ext),
        check_disk(Path("C:/"), Path("E:/")),
    ]
    bitmap = 0
    for i, c in enumerate(checks):
        if not c.ok:
            bitmap |= (1 << i)
    return checks, bitmap


def render_text(checks: list[Check]) -> str:
    width_name = 12
    out_lines = ["=" * 70, "  Training pipeline sanity check", "=" * 70]
    for c in checks:
        status = "PASS" if c.ok else "FAIL"
        line = f"  {c.name.ljust(width_name)}  [{status}]"
        if c.issue:
            line += f"  -- {c.issue}"
        out_lines.append(line)
        if c.details:
            for k, v in c.details.items():
                if isinstance(v, (dict, list)) and len(str(v)) > 80:
                    out_lines.append(f"      {k}: " + json.dumps(v, default=str)[:120] + "...")
                else:
                    out_lines.append(f"      {k}: {v}")
    out_lines.append("=" * 70)
    return "\n".join(out_lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--mirror", default=str(DEFAULT_MIRROR))
    ap.add_argument("--hist-local", default=str(DEFAULT_HIST_DB))
    ap.add_argument("--hist-ext", default=str(DEFAULT_HIST_DB_E))
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    checks, bitmap = run_all(
        Path(args.db), Path(args.mirror),
        Path(args.hist_local), Path(args.hist_ext),
    )
    if args.json:
        print(json.dumps(
            {"checks": [{"name": c.name, "ok": c.ok, "issue": c.issue,
                         "details": c.details} for c in checks],
             "exit_bitmap": bitmap, "exit_ok": bitmap == 0}, indent=2, default=str))
    else:
        print(render_text(checks))
        if bitmap != 0:
            print(f"\n!! Some checks failed (bitmap=0b{bitmap:07b}).")
    return bitmap


if __name__ == "__main__":
    raise SystemExit(main())
