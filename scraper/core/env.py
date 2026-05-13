"""Tiny .env loader — no python-dotenv dependency.

Reads a top-level .env file at the repo root into os.environ if present.
Each line is `KEY=VALUE`; comments and blank lines are ignored. Quotes around
the value (single or double) are stripped. Existing env vars take precedence.
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path = REPO_ROOT / ".env") -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        os.environ.setdefault(key, value)


# Load on import. Safe — only sets unset vars.
load_dotenv()
