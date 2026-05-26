-- 004: data_quality_log table — record external-verification results.
--
-- The strict EAN-or-DM-SKU matcher already keeps the dataset internally
-- consistent against DM's own JSON-LD. But every identity claim in the
-- dataset today rests on a single source: DM. To turn "very confident" into
-- "audit-proof", we add a log of *external* checks: every time a script
-- queries an outside source (Open Beauty Facts, GS1, a second retailer like
-- Müller), it appends a row here.
--
-- The web app exposes the latest rollup so visitors can see at a glance how
-- many EANs have been independently verified.
--
-- Severity convention:
--   info     — confirmation / informational (OBF doesn't carry this EAN; fine)
--   warning  — a discrepancy that may or may not indicate a real problem
--   error    — hard contradiction (two independent sources disagree on identity)
--
-- Append-only; never DELETE. Drift over time is itself a signal.

CREATE TABLE IF NOT EXISTS data_quality_log (
    id          INTEGER PRIMARY KEY,
    run_at      TEXT NOT NULL DEFAULT (datetime('now')),
    source      TEXT NOT NULL,        -- 'obf' | 'gs1' | 'cross_retailer'
    severity    TEXT NOT NULL,        -- 'info' | 'warning' | 'error'
    ean         TEXT,                 -- nullable: cross-retailer entries reference a product
    product_id  INTEGER REFERENCES product(id) ON DELETE SET NULL,
    message     TEXT NOT NULL,        -- short human-readable
    details_json TEXT                 -- structured payload (the external source's response, etc.)
);

CREATE INDEX IF NOT EXISTS idx_dql_when     ON data_quality_log(run_at);
CREATE INDEX IF NOT EXISTS idx_dql_source   ON data_quality_log(source, severity);
CREATE INDEX IF NOT EXISTS idx_dql_product  ON data_quality_log(product_id);

-- Convenience view: the latest verification status per product/source pair.
-- A product's "current" OBF status is the most recent OBF row about it.
CREATE VIEW IF NOT EXISTS v_data_quality_latest AS
SELECT
    dql.id,
    dql.run_at,
    dql.source,
    dql.severity,
    dql.ean,
    dql.product_id,
    dql.message,
    dql.details_json
FROM data_quality_log dql
WHERE dql.id = (
    SELECT id FROM data_quality_log
    WHERE source     = dql.source
      AND product_id IS dql.product_id
    ORDER BY run_at DESC, id DESC
    LIMIT 1
);
