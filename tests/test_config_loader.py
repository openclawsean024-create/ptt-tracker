"""
Tests for config loading behavior.

Two layers are exercised:

1. ``ptt_tracker.load_config()`` — the **real** Python
   implementation, parametrized with a ``tmp_path``-based config
   file.  This is the production code path; we monkeypatch
   ``os.chdir`` via the file's location and assert what it
   actually does.

2. ``tests._pure_mirrors.load_config_with_env`` — the Python
   mirror of ``tracker.js`` ``loadConfig``.  These tests pin the
   **env-variable contract** that the Node side must satisfy
   (secrets come only from env, never from the file).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from ptt_tracker import load_config as py_load_config
from tests._pure_mirrors import load_config_with_env


# ---------------------------------------------------------------------------
# Layer 1 — real ptt_tracker.load_config() (uses tmp_path for config.json)
# ---------------------------------------------------------------------------


@pytest.fixture
def cwd_in_tmp(monkeypatch, tmp_path):
    """Run the test with cwd set to a fresh temp dir so the real
    production ``load_config`` (which hardcodes ``"config.json"``
    relative to cwd) does not see the repo's own ``config.json``.
    """
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_py_load_config_returns_parsed_dict_when_file_exists(cwd_in_tmp, sample_config):
    """Happy path: a well-formed config.json is returned as-is."""
    cfg_path = cwd_in_tmp / "config.json"
    cfg_path.write_text(json.dumps(sample_config, ensure_ascii=False), encoding="utf-8")

    result = py_load_config()

    assert result["boards"] == sample_config["boards"]
    assert result["keywords"] == sample_config["keywords"]
    assert result["min_heat"] == sample_config["min_heat"]
    assert result["interval_minutes"] == sample_config["interval_minutes"]


def test_py_load_config_returns_empty_dict_when_file_missing(cwd_in_tmp):
    """Default value: no config.json → empty dict (no raise)."""
    # sanity: nothing in tmp_path
    assert not any(cwd_in_tmp.iterdir())

    result = py_load_config()

    assert result == {}


def test_py_load_config_returns_empty_dict_when_corrupt(cwd_in_tmp):
    """A corrupt JSON file does not crash — production silently
    falls back to ``{}`` (matches ``ptt_tracker.py`` bare ``except``).
    """
    cfg_path = cwd_in_tmp / "config.json"
    cfg_path.write_text("{ this is :: not json", encoding="utf-8")

    result = py_load_config()

    assert result == {}


def test_py_load_config_ignores_env_for_non_secret_fields(cwd_in_tmp, sample_config, monkeypatch):
    """``ptt_tracker.load_config`` is the *file* loader; it must
    not be influenced by ``PTT_TELEGRAM_*`` env vars (env-based
    secrets handling lives on the JS side / inside ``PTTTracker``
    constructor — out of scope for this loader).
    """
    monkeypatch.setenv("PTT_TELEGRAM_TOKEN", "should-not-leak-into-file-config")
    monkeypatch.setenv("PTT_TELEGRAM_CHAT_ID", "should-not-leak-into-file-config")

    cfg_path = cwd_in_tmp / "config.json"
    cfg_path.write_text(json.dumps(sample_config, ensure_ascii=False), encoding="utf-8")

    result = py_load_config()

    # file loader must not pull in env-derived values
    assert "telegram_token" not in result
    assert "telegram_chat_id" not in result
    # and non-secret values come from the file
    assert result["boards"] == sample_config["boards"]


# ---------------------------------------------------------------------------
# Layer 2 — mirror of tracker.js loadConfig()
# ---------------------------------------------------------------------------


def test_js_mirror_merges_file_config_with_env_secrets(sample_config):
    """When env vars are present, secrets come from env; non-secret
    fields come from the file.
    """
    env = {"PTT_TELEGRAM_TOKEN": "env-token-123", "PTT_TELEGRAM_CHAT_ID": "env-chat-456"}

    result = load_config_with_env(file_config=sample_config, env=env)

    # non-secret fields preserved
    assert result["boards"] == sample_config["boards"]
    assert result["keywords"] == sample_config["keywords"]
    assert result["min_heat"] == sample_config["min_heat"]
    # secrets sourced from env, NOT from file (post-M1 behavior)
    assert result["telegram_token"] == "env-token-123"
    assert result["telegram_chat_id"] == "env-chat-456"
    # file must NOT be allowed to override env secrets
    assert "telegram_token" not in sample_config  # sanity


def test_js_mirror_returns_none_when_env_missing(sample_config):
    """If env vars are unset, secrets are explicitly ``None`` (post-M1
    behavior: env-only, no file fallback).
    """
    result = load_config_with_env(file_config=sample_config, env={})

    assert result["telegram_token"] is None
    assert result["telegram_chat_id"] is None
    # non-secrets still present
    assert result["boards"] == sample_config["boards"]


def test_js_mirror_does_not_pick_up_secrets_from_file_config():
    """Post-M1 contract: file config NEVER provides Telegram secrets
    even if someone accidentally adds them there.
    """
    file_with_secrets = {
        "boards": ["Gossiping"],
        "keywords": [],
        "min_heat": 1,
        "telegram_token": "SHOULD-NOT-LEAK",
        "telegram_chat_id": "SHOULD-NOT-LEAK",
    }

    result = load_config_with_env(file_config=file_with_secrets, env={})

    assert result["telegram_token"] is None
    assert result["telegram_chat_id"] is None
    # non-secret fields still flow through
    assert result["boards"] == ["Gossiping"]


def test_js_mirror_handles_missing_file_config():
    """Missing config.json (or unreadable) → empty base, no raise,
    env still consulted for secrets.
    """
    env = {"PTT_TELEGRAM_TOKEN": "still-works"}

    result = load_config_with_env(
        file_config=None,
        env=env,
        config_path_exists=False,
    )

    # base was empty: non-secret fields are simply absent
    assert "boards" not in result
    assert "keywords" not in result
    assert "min_heat" not in result
    # secrets still resolved from env
    assert result["telegram_token"] == "still-works"


def test_js_mirror_empty_env_no_secrets_no_crash():
    """No file, no env → still returns a dict, no raise."""
    result = load_config_with_env(file_config=None, env={}, config_path_exists=False)

    assert isinstance(result, dict)
    assert result["telegram_token"] is None
    assert result["telegram_chat_id"] is None
