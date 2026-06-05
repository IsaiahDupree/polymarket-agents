"""Tests for the structured logger used across the pipeline."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import pytest

from logging_utils import get_logger


@pytest.fixture(autouse=True)
def reset_logging():
    """Each test gets a clean logging state."""
    # Wipe any handlers a prior test installed
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    import logging_utils
    logging_utils._CONFIGURED = False
    yield
    for h in list(root.handlers):
        root.removeHandler(h)
    logging_utils._CONFIGURED = False


def test_get_logger_returns_a_logger(monkeypatch):
    monkeypatch.delenv("TRAIN_LOG_JSON", raising=False)
    log = get_logger("test_x")
    assert isinstance(log, logging.Logger)
    assert log.name == "test_x"


def test_logger_writes_to_file_when_requested(tmp_path, monkeypatch):
    monkeypatch.delenv("TRAIN_LOG_JSON", raising=False)
    log_file = tmp_path / "logs" / "out.log"
    log = get_logger("test_y", log_file=log_file)
    log.info("hello world")
    # Flush handlers
    for h in logging.getLogger().handlers:
        h.flush()
    assert log_file.exists()
    content = log_file.read_text(encoding="utf-8")
    assert "hello world" in content
    assert "INFO" in content
    assert "test_y" in content


def test_json_mode_emits_valid_json(tmp_path, monkeypatch):
    monkeypatch.setenv("TRAIN_LOG_JSON", "1")
    log_file = tmp_path / "out.jsonl"
    log = get_logger("json_test", log_file=log_file)
    log.info("structured event", extra={"slug": "btc-updown-5m-1", "rows": 16})
    for h in logging.getLogger().handlers:
        h.flush()
    line = log_file.read_text(encoding="utf-8").strip()
    parsed = json.loads(line)
    assert parsed["msg"] == "structured event"
    assert parsed["slug"] == "btc-updown-5m-1"
    assert parsed["rows"] == 16
    assert parsed["level"] == "INFO"
    assert "ts" in parsed


def test_respects_TRAIN_LOG_LEVEL(monkeypatch, tmp_path):
    monkeypatch.setenv("TRAIN_LOG_LEVEL", "WARNING")
    log_file = tmp_path / "out.log"
    log = get_logger("level_test", log_file=log_file)
    log.info("info line — should be filtered")
    log.warning("warn line — should appear")
    for h in logging.getLogger().handlers:
        h.flush()
    content = log_file.read_text(encoding="utf-8")
    assert "warn line" in content
    assert "info line" not in content


def test_exception_captures_traceback(tmp_path, monkeypatch):
    monkeypatch.delenv("TRAIN_LOG_JSON", raising=False)
    log_file = tmp_path / "out.log"
    log = get_logger("exc_test", log_file=log_file)
    try:
        raise ValueError("synthetic failure")
    except ValueError:
        log.exception("caught error")
    for h in logging.getLogger().handlers:
        h.flush()
    content = log_file.read_text(encoding="utf-8")
    assert "synthetic failure" in content
    assert "Traceback" in content
