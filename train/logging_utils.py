"""Structured logging used across the training pipeline.

One config, used by build_dataset.py, train_lstm.py, train_ppo.py, and
sanity_check.py. Every log line is timestamped, level-tagged, and
prefixed with the originating script name so a tee'd run mixing stdout
from multiple commands stays readable.

Log level is controlled by env var TRAIN_LOG_LEVEL (default INFO).
Set TRAIN_LOG_JSON=1 to emit JSON lines for downstream aggregation.

USAGE
    from logging_utils import get_logger
    log = get_logger("build_dataset")
    log.info("scanned %d slugs", n_slugs)
    log.warning("slug %s skipped: %s", slug, reason)
    log.exception("DB query failed")          # auto-captures the traceback
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


class _JsonFormatter(logging.Formatter):
    """One JSON record per log line — fields the operator can grep / pipe to jq."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Surface any structured extras the caller attached via `extra={...}`.
        for k, v in record.__dict__.items():
            if k in ("args", "exc_info", "exc_text", "msg", "message", "stack_info",
                     "name", "msecs", "levelname", "levelno", "pathname", "filename",
                     "module", "lineno", "funcName", "created", "asctime", "relativeCreated",
                     "thread", "threadName", "processName", "process", "taskName"):
                continue
            payload[k] = v
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


_CONFIGURED = False


def get_logger(name: str, *, log_file: Optional[Path] = None) -> logging.Logger:
    """Return a configured logger. Idempotent."""
    global _CONFIGURED
    log_level = os.environ.get("TRAIN_LOG_LEVEL", "INFO").upper()
    use_json = os.environ.get("TRAIN_LOG_JSON", "0") == "1"

    root = logging.getLogger()
    if not _CONFIGURED:
        root.setLevel(log_level)
        # Always remove default stream handlers — pytest etc may have set up
        # their own, and we want one consistent format.
        for h in list(root.handlers):
            root.removeHandler(h)
        sh = logging.StreamHandler(sys.stderr)
        sh.setLevel(log_level)
        sh.setFormatter(
            _JsonFormatter() if use_json else logging.Formatter(
                "%(asctime)s  %(levelname)-7s  %(name)-16s  %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            ),
        )
        root.addHandler(sh)
        _CONFIGURED = True

    if log_file is not None:
        log_file = Path(log_file)
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setLevel(log_level)
        fh.setFormatter(
            _JsonFormatter() if use_json else logging.Formatter(
                "%(asctime)s  %(levelname)-7s  %(name)-16s  %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S",
            ),
        )
        root.addHandler(fh)

    return logging.getLogger(name)
