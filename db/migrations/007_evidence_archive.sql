-- 007: Independent third-party evidence archive (Internet Archive snapshots).
--
-- Why this matters
-- ----------------
-- The project's claim must survive "you could have typed any number into a
-- database". Two layers of evidence answer that:
--
--   1. LOCAL, parse-time: every scraped HTML page is stored on disk and its
--      SHA-256 lives on the price row (price.raw_html_sha256). Proves what WE
--      parsed, but a sceptic must trust our archive.
--   2. INDEPENDENT, point-in-time: a Wayback Machine snapshot of the same
--      product URL, held by the Internet Archive — a third party we cannot
--      edit. Anyone can open the snapshot and see the price the retailer
--      displayed on the snapshot date.
--
-- A snapshot documents the page ON ITS OWN DATE, which is not necessarily the
-- parse date of a given price row; the UI must label the two dates honestly.
-- From this migration on, the intended workflow is: scrape wave -> archive
-- wave, so the two dates stay close.

CREATE TABLE IF NOT EXISTS evidence_archive (
    id           INTEGER PRIMARY KEY,
    url          TEXT NOT NULL,        -- the live retailer product URL
    archive_url  TEXT,                 -- https://web.archive.org/web/<ts>/<url>
    snapshot_ts  TEXT,                 -- Wayback timestamp (YYYYMMDDhhmmss) of the capture
    requested_at TEXT NOT NULL,        -- when we submitted the save request (ISO, UTC)
    status       TEXT NOT NULL,        -- 'ok' | 'error: <reason>'
    UNIQUE(url, snapshot_ts)
);

CREATE INDEX IF NOT EXISTS idx_evidence_archive_url ON evidence_archive(url);
