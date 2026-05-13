"""HTTP fetching: httpx primary, Jina Reader API as the rendered/anti-bot fallback.

Strategy:
    - `get(url)` uses httpx directly. Free, fast, works on most server-rendered pages.
    - `get_rendered(url)` calls Jina Reader (https://r.jina.ai/<url>) with the
      browser engine. Replaces Playwright — no Chromium install, handles JS-
      rendered pages and Cloudflare-style anti-bot uniformly across all shops.

Jina is invoked only when needed. To use it, set JINA_API_KEY in env or .env.

The fetcher can optionally archive every response body to disk under
data/snapshots/<date>/<sha256>.html for reproducibility. Toggle with the
EUPRICE_ARCHIVE_HTML env var (default: on).
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Optional

import httpx

# Side-effect import: loads .env into os.environ if present.
from . import env  # noqa: F401

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
SNAPSHOTS_DIR = REPO_ROOT / "data" / "snapshots"

DEFAULT_HEADERS = {
    "User-Agent": (
        "EUPRICE-research/0.1 "
        "(EU consumer price comparison; contact: euprice@example.org) "
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.7,de;q=0.6",
}

JINA_READER_BASE = "https://r.jina.ai/"


@dataclass
class FetchResult:
    url: str
    status_code: int
    html: str
    rendered: bool                # True if it went through Jina
    sha256: Optional[str] = None  # hex sha256 of the body, set when archived
    archive_path: Optional[str] = None  # relative path under data/snapshots, set when archived


def _archive_html(url: str, html: str) -> tuple[str, str]:
    """Write html to data/snapshots/<YYYY-MM-DD>/<sha256>.html. Returns (sha256, rel_path)."""
    digest = hashlib.sha256(html.encode("utf-8", errors="replace")).hexdigest()
    day_dir = SNAPSHOTS_DIR / date.today().isoformat()
    day_dir.mkdir(parents=True, exist_ok=True)
    target = day_dir / f"{digest}.html"
    if not target.exists():
        target.write_text(html, encoding="utf-8")
    rel = target.relative_to(REPO_ROOT).as_posix()
    return digest, rel


class JinaNotConfigured(RuntimeError):
    """Raised when get_rendered() is called but JINA_API_KEY is unset."""


class Fetcher:
    """Polite HTTP client with optional Jina-rendered fallback."""

    def __init__(
        self,
        min_delay_seconds: float = 1.5,
        timeout: float = 20.0,
        accept_language: Optional[str] = None,
        jina_api_key: Optional[str] = None,
        jina_timeout: float = 45.0,
        force_jina: Optional[bool] = None,
    ) -> None:
        self.min_delay = min_delay_seconds
        self._last_request_at: float = 0.0
        headers = dict(DEFAULT_HEADERS)
        if accept_language:
            headers["Accept-Language"] = accept_language
        self.client = httpx.Client(
            headers=headers, timeout=timeout, follow_redirects=True,
        )
        self.jina_api_key = jina_api_key or os.environ.get("JINA_API_KEY") or None
        self.jina_timeout = jina_timeout
        # If JINA_FORCE=1 in env, route every request through Jina.
        if force_jina is None:
            force_jina = os.environ.get("JINA_FORCE", "").strip() in ("1", "true", "yes")
        self.force_jina = bool(force_jina)
        if self.force_jina and not self.jina_api_key:
            log.warning("JINA_FORCE set but JINA_API_KEY missing — falling back to httpx")
            self.force_jina = False
        # Archive every fetched HTML to disk unless EUPRICE_ARCHIVE_HTML=0.
        self.archive_html = os.environ.get("EUPRICE_ARCHIVE_HTML", "1").strip() not in ("0", "false", "no")

    # ------------------------------------------------------------------ httpx
    def get(self, url: str) -> FetchResult:
        if self.force_jina:
            return self._get_via_jina(url, engine="direct")
        self._throttle()
        log.debug("GET %s", url)
        resp = self.client.get(url)
        return self._maybe_archive(FetchResult(
            url=str(resp.url), status_code=resp.status_code, html=resp.text, rendered=False,
        ))

    # ----------------------------------------------------------- jina-rendered
    def get_rendered(
        self,
        url: str,
        wait_selector: Optional[str] = None,
        wait_ms: int = 0,  # kept for backward compat; Jina uses wait_selector
    ) -> FetchResult:
        """JS-rendered / anti-bot-bypassing fetch via Jina Reader.

        Raises JinaNotConfigured if JINA_API_KEY is missing.
        """
        return self._get_via_jina(url, engine="browser", wait_selector=wait_selector)

    # --------------------------------------------------------------- internals
    def _get_via_jina(
        self,
        url: str,
        engine: str = "browser",          # "direct" or "browser"
        wait_selector: Optional[str] = None,
    ) -> FetchResult:
        if not self.jina_api_key:
            raise JinaNotConfigured(
                "JINA_API_KEY is not set. Add it to your .env file or environment "
                "to enable the Jina-rendered fallback."
            )
        self._throttle()
        headers = {
            "Authorization": f"Bearer {self.jina_api_key}",
            "Accept": "text/html",
            "X-Return-Format": "html",          # preserve <script type='application/ld+json'>
            "X-Engine": engine,
            "X-Timeout": str(int(self.jina_timeout)),
        }
        if wait_selector:
            headers["X-Wait-For-Selector"] = wait_selector

        # Jina expects the target URL as the path of the request.
        # httpx normally re-encodes path characters; we pass via httpx.URL to be explicit.
        target = JINA_READER_BASE + url
        log.debug("JINA %s %s", engine, url)
        resp = httpx.get(target, headers=headers, timeout=self.jina_timeout, follow_redirects=True)
        # Jina's status reflects its own success; underlying page status is in headers.
        upstream_status = int(resp.headers.get("X-Norm-Status", resp.status_code))
        if resp.status_code >= 400:
            log.warning("Jina returned %s for %s", resp.status_code, url)
        return self._maybe_archive(FetchResult(
            url=url, status_code=upstream_status, html=resp.text, rendered=True,
        ))

    def _maybe_archive(self, result: FetchResult) -> FetchResult:
        if not self.archive_html or not result.html or result.status_code >= 400:
            return result
        try:
            digest, rel_path = _archive_html(result.url, result.html)
            result.sha256 = digest
            result.archive_path = rel_path
        except OSError as e:
            log.warning("archive_html failed for %s: %s", result.url, e)
        return result

    # ---------------------------------------------------------------- utility
    def _throttle(self) -> None:
        if self.min_delay <= 0:
            return
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.min_delay:
            time.sleep(self.min_delay - elapsed)
        self._last_request_at = time.monotonic()

    def close(self) -> None:
        self.client.close()

    def __enter__(self) -> "Fetcher":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
