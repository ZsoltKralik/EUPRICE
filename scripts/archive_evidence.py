"""Archive every observed product URL to the Internet Archive (Wayback Machine).

Purpose: independent, third-party, dated evidence that "on this date, this
retailer page showed this content". Complements the local SHA-256-fingerprinted
HTML archive (parse-time evidence) with snapshots held by an organisation we
cannot edit.

Usage:
    python scripts/archive_evidence.py            # archive all latest-price URLs
    python scripts/archive_evidence.py --limit 5  # smoke test
    python scripts/archive_evidence.py --delay 15 # seconds between requests

Wayback's Save Page Now (SPN) endpoint is rate-limited for anonymous use, so we
pace requests (default 12 s) and tolerate failures: a failed save is recorded
with status 'error: ...' and simply retried on a future run. URLs that already
have a snapshot newer than --max-age-days (default 30) are skipped, so re-runs
are cheap and idempotent.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sqlite3
import sys
import time
from pathlib import Path

import requests

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "eu_prices.db"
SAVE_URL = "https://web.archive.org/save/{url}"
UA = "EUPRICE-evidence-archiver/1.0 (+https://github.com/ZsoltKralik/EUPRICE)"

# /web/20260612120000/https://... — capture timestamp in the redirect target
WAYBACK_TS_RE = re.compile(r"web\.archive\.org/web/(\d{14})")


def latest_urls(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("SELECT DISTINCT url FROM v_latest_prices WHERE url IS NOT NULL ORDER BY url")
    return [r[0] for r in rows]


def newest_snapshot_age_days(conn: sqlite3.Connection, url: str) -> float | None:
    row = conn.execute(
        "SELECT MAX(snapshot_ts) FROM evidence_archive WHERE url = ? AND status = 'ok'",
        (url,),
    ).fetchone()
    if not row or not row[0]:
        return None
    ts = dt.datetime.strptime(row[0], "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)
    return (dt.datetime.now(dt.timezone.utc) - ts).total_seconds() / 86400.0


def save_one(url: str, timeout: float = 90.0) -> tuple[str | None, str | None, str]:
    """Submit one URL to SPN. Returns (archive_url, snapshot_ts, status)."""
    try:
        res = requests.get(
            SAVE_URL.format(url=url),
            headers={"User-Agent": UA},
            timeout=timeout,
            allow_redirects=True,
        )
    except requests.RequestException as e:
        return None, None, f"error: {type(e).__name__}: {e}"

    # SPN ends on the snapshot URL itself, or exposes it via Content-Location.
    final = res.url or ""
    content_loc = res.headers.get("Content-Location", "")
    for cand in (final, f"https://web.archive.org{content_loc}" if content_loc else ""):
        m = WAYBACK_TS_RE.search(cand)
        if m:
            return cand, m.group(1), "ok"
    if res.status_code == 200:
        return None, None, "error: 200 but no snapshot URL in response"
    return None, None, f"error: HTTP {res.status_code}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--limit", type=int, default=None, help="Only archive first N URLs")
    ap.add_argument("--delay", type=float, default=12.0, help="Seconds between SPN requests")
    ap.add_argument("--max-age-days", type=float, default=30.0,
                    help="Skip URLs with an ok snapshot newer than this")
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB_PATH)
    urls = latest_urls(conn)
    if args.limit:
        urls = urls[: args.limit]

    print(f"{len(urls)} distinct product URLs in latest prices.")
    counts = {"ok": 0, "skip": 0, "error": 0}
    for i, url in enumerate(urls, 1):
        age = newest_snapshot_age_days(conn, url)
        if age is not None and age <= args.max_age_days:
            counts["skip"] += 1
            print(f"[{i}/{len(urls)}] SKIP (snapshot {age:.0f}d old) {url}")
            continue

        archive_url, snapshot_ts, status = save_one(url)
        requested_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        conn.execute(
            """INSERT OR IGNORE INTO evidence_archive
               (url, archive_url, snapshot_ts, requested_at, status)
               VALUES (?, ?, ?, ?, ?)""",
            (url, archive_url, snapshot_ts, requested_at, status),
        )
        conn.commit()
        if status == "ok":
            counts["ok"] += 1
            print(f"[{i}/{len(urls)}] OK   {snapshot_ts} {url}")
        else:
            counts["error"] += 1
            print(f"[{i}/{len(urls)}] FAIL {status[:80]} {url}")
        time.sleep(args.delay)

    print(f"\nDone: {counts['ok']} archived, {counts['skip']} skipped (fresh), {counts['error']} failed.")
    return 0 if counts["error"] < max(len(urls), 1) else 1


if __name__ == "__main__":
    sys.exit(main())
