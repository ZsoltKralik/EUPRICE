"""HTTP fetching for the EUPRICE scraper.

Two-layer design:

    Static layer — `Fetcher.get(url)` uses httpx. Free, fast, works on any
    server-rendered page. The bulk of cheap retailer pages live here.

    Rendered layer — `Fetcher.get_rendered(url)` runs a real browser. Required
    for SPAs like DM that ship a thin HTML shell and hydrate via JavaScript.
    Two interchangeable backends, chosen at runtime via env var:

        EUPRICE_RENDER=playwright  (default) — local Chromium, free, recommended
        EUPRICE_RENDER=jina               — Jina Reader API, paid but no install
        EUPRICE_RENDER=disabled           — fall through to static (httpx only)

    Backends share a common interface (return FetchResult) so spiders never
    care which one is in use. The choice is a deploy-time decision, not a
    code change.

Side effects:
    - Loads `.env` from the repo root via `core.env` on import.
    - Optionally archives every fetched HTML to data/snapshots/<date>/<hash>.html
      for reproducibility. Toggle with EUPRICE_ARCHIVE_HTML=0 to disable.

Resource handling:
    The Playwright browser and Jina HTTP client are lazy-loaded — they only
    start up when actually used. Call `Fetcher.close()` (or use as a context
    manager) to release them cleanly.
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
VALID_BACKENDS = {"playwright", "jina", "disabled"}


@dataclass
class FetchResult:
    url: str
    status_code: int
    html: str
    rendered: bool                       # True if a browser engine was used
    backend: str = "httpx"               # "httpx" | "playwright" | "jina"
    sha256: Optional[str] = None
    archive_path: Optional[str] = None


class JinaNotConfigured(RuntimeError):
    """Raised when the Jina backend is selected but JINA_API_KEY is unset."""


class PlaywrightNotInstalled(RuntimeError):
    """Raised when the Playwright backend is selected but the package is missing."""


def _archive_html(url: str, html: str) -> tuple[str, str]:
    """Write html to data/snapshots/<YYYY-MM-DD>/<sha256>.html; return (digest, rel_path)."""
    digest = hashlib.sha256(html.encode("utf-8", errors="replace")).hexdigest()
    day_dir = SNAPSHOTS_DIR / date.today().isoformat()
    day_dir.mkdir(parents=True, exist_ok=True)
    target = day_dir / f"{digest}.html"
    if not target.exists():
        target.write_text(html, encoding="utf-8")
    rel = target.relative_to(REPO_ROOT).as_posix()
    return digest, rel


class Fetcher:
    """Polite HTTP client with a pluggable rendering backend.

    Parameters
    ----------
    min_delay_seconds : float
        Minimum gap between any two outbound requests. Default 1.5 s.
    timeout : float
        httpx timeout (seconds).
    accept_language : str | None
        Override for the Accept-Language header.
    render_backend : str | None
        Force a backend. If None, read EUPRICE_RENDER env var (default "playwright").
    jina_api_key : str | None
        Override the JINA_API_KEY env var.
    jina_timeout : float
        Jina HTTP timeout (seconds).
    playwright_timeout : int
        Playwright page-load timeout (milliseconds).
    """

    def __init__(
        self,
        min_delay_seconds: float = 1.5,
        timeout: float = 20.0,
        accept_language: Optional[str] = None,
        render_backend: Optional[str] = None,
        jina_api_key: Optional[str] = None,
        jina_timeout: float = 45.0,
        playwright_timeout: int = 30_000,
    ) -> None:
        self.min_delay = min_delay_seconds
        self._last_request_at: float = 0.0

        headers = dict(DEFAULT_HEADERS)
        if accept_language:
            headers["Accept-Language"] = accept_language
        self.client = httpx.Client(
            headers=headers, timeout=timeout, follow_redirects=True,
        )

        # Choose backend
        chosen = (render_backend or os.environ.get("EUPRICE_RENDER", "playwright")).strip().lower()
        if chosen not in VALID_BACKENDS:
            log.warning("Unknown EUPRICE_RENDER=%r — defaulting to playwright", chosen)
            chosen = "playwright"
        self.render_backend = chosen

        # Jina state (lazy)
        self.jina_api_key = jina_api_key or os.environ.get("JINA_API_KEY") or None
        self.jina_timeout = jina_timeout

        # Playwright state (lazy)
        self.playwright_timeout = playwright_timeout
        self._pw = None
        self._pw_browser = None
        self._pw_context = None

        # Snapshot archiving
        self.archive_html = (
            os.environ.get("EUPRICE_ARCHIVE_HTML", "1").strip().lower()
            not in ("0", "false", "no")
        )

    # ===================================================================
    # Public API — what spiders use
    # ===================================================================

    def get(self, url: str) -> FetchResult:
        """Plain httpx GET. Free, fast, no JS execution."""
        self._throttle()
        log.debug("GET %s", url)
        resp = self.client.get(url)
        return self._maybe_archive(FetchResult(
            url=str(resp.url),
            status_code=resp.status_code,
            html=resp.text,
            rendered=False,
            backend="httpx",
        ))

    def get_rendered(self, url: str, wait_selector: Optional[str] = None) -> FetchResult:
        """Fetch with a browser-rendering backend. Backend is chosen by EUPRICE_RENDER.

        wait_selector
            Optional CSS selector to wait for before snapshotting. Useful when
            you need a specific element (e.g. JSON-LD script) to be in the DOM.
            Only respected by the Playwright backend; Jina has had reliability
            issues with this parameter, so it's ignored there.
        """
        if self.render_backend == "playwright":
            return self._get_via_playwright(url, wait_selector=wait_selector)
        if self.render_backend == "jina":
            return self._get_via_jina(url)
        if self.render_backend == "disabled":
            log.debug("EUPRICE_RENDER=disabled — falling back to static GET for %s", url)
            return self.get(url)
        raise RuntimeError(f"Unknown render backend: {self.render_backend!r}")

    # ===================================================================
    # Playwright backend (local Chromium, free)
    # ===================================================================

    def _ensure_playwright(self) -> None:
        if self._pw_context is not None:
            return
        try:
            from playwright.sync_api import sync_playwright  # type: ignore
        except ImportError as e:
            raise PlaywrightNotInstalled(
                "playwright is not installed. Run: pip install playwright "
                "&& python -m playwright install chromium"
            ) from e
        log.info("Starting Playwright Chromium…")
        self._pw = sync_playwright().start()
        # `chromium` selects either the full bundled Chromium or the headless-
        # shell variant — Playwright picks whichever is installed.
        self._pw_browser = self._pw.chromium.launch(headless=True)
        self._pw_context = self._pw_browser.new_context(
            user_agent=DEFAULT_HEADERS["User-Agent"],
            locale="en-US",
            viewport={"width": 1280, "height": 800},
        )

    def _get_via_playwright(
        self, url: str, wait_selector: Optional[str] = None,
    ) -> FetchResult:
        self._ensure_playwright()
        self._throttle()
        page = self._pw_context.new_page()
        try:
            log.debug("PLAYWRIGHT %s", url)
            response = page.goto(url, wait_until="domcontentloaded", timeout=self.playwright_timeout)
            # Wait for either the specific selector or a generic settle.
            if wait_selector:
                try:
                    page.wait_for_selector(wait_selector, timeout=8_000)
                except Exception:  # noqa: BLE001
                    pass  # snapshot what we have; spider may still parse
            else:
                # Give late-loading JSON-LD (often hydrated client-side) a moment.
                page.wait_for_timeout(1_500)
            html = page.content()
            status = response.status if response else 200
            return self._maybe_archive(FetchResult(
                url=page.url,
                status_code=status,
                html=html,
                rendered=True,
                backend="playwright",
            ))
        finally:
            page.close()

    # ===================================================================
    # Jina backend (hosted API, paid)
    # ===================================================================

    def _get_via_jina(
        self, url: str, engine: str = "browser", wait_selector: Optional[str] = None,
    ) -> FetchResult:
        if not self.jina_api_key:
            raise JinaNotConfigured(
                "JINA_API_KEY is not set. Either set it (and EUPRICE_RENDER=jina), "
                "or switch to EUPRICE_RENDER=playwright."
            )
        self._throttle()
        headers = {
            "Authorization": f"Bearer {self.jina_api_key}",
            "Accept": "text/html",
            "X-Return-Format": "html",
            "X-Engine": engine,
            "X-Timeout": str(int(self.jina_timeout)),
        }
        # Note: X-Wait-For-Selector caused Jina to return truncated HTML in our
        # testing (~24 KB instead of ~470 KB). We intentionally do not send it.
        target = JINA_READER_BASE + url
        log.debug("JINA %s %s", engine, url)
        resp = httpx.get(
            target, headers=headers, timeout=self.jina_timeout, follow_redirects=True,
        )
        upstream_status = int(resp.headers.get("X-Norm-Status", resp.status_code))
        if resp.status_code >= 400:
            log.warning("Jina returned %s for %s", resp.status_code, url)
        return self._maybe_archive(FetchResult(
            url=url,
            status_code=upstream_status,
            html=resp.text,
            rendered=True,
            backend="jina",
        ))

    # ===================================================================
    # Shared utilities
    # ===================================================================

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

    def _throttle(self) -> None:
        if self.min_delay <= 0:
            return
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self.min_delay:
            time.sleep(self.min_delay - elapsed)
        self._last_request_at = time.monotonic()

    def close(self) -> None:
        """Release the httpx client and the Playwright browser, if started."""
        self.client.close()
        if self._pw_context is not None:
            self._pw_context.close()
        if self._pw_browser is not None:
            self._pw_browser.close()
        if self._pw is not None:
            self._pw.stop()
        self._pw_context = self._pw_browser = self._pw = None

    def __enter__(self) -> "Fetcher":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
