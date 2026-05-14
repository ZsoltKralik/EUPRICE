-- EUPRICE database schema (SQLite). Simple by design.
-- Five tables + one helper lookup + one convenience view.
--
-- Dimensions:  country, producer, shop, product
-- Lookup:      shop_country (where each shop operates, with its country-specific base URL)
-- Facts:       price (append-only, one row per scrape observation)

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- A country we track. Holds the currency and VAT rates that apply there.
CREATE TABLE IF NOT EXISTS country (
    code                   TEXT PRIMARY KEY,   -- ISO 3166-1 alpha-2: 'SK', 'AT', 'DE'
    name                   TEXT NOT NULL,
    currency_code          TEXT NOT NULL,      -- ISO 4217: 'EUR', 'CZK', 'HUF'
    vat_standard_rate      REAL NOT NULL,      -- 0.20 means 20 %
    vat_food_rate          REAL,               -- reduced rate (nullable)
    median_hourly_wage_eur REAL,               -- gross median hourly wage (EUR); see wage_source/year
    wage_source            TEXT,               -- e.g. 'Eurostat earn_ses_hourly'
    wage_year              INTEGER             -- the survey/reference year
);

-- A brand / manufacturer ("Balea", "Nivea", "Garnier").
CREATE TABLE IF NOT EXISTS producer (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

-- A retail chain ("DM", "Rossmann"). Country-specific data lives in shop_country.
CREATE TABLE IF NOT EXISTS shop (
    id   INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,                 -- 'dm', 'rossmann'
    name TEXT NOT NULL                         -- 'DM Drogerie Markt'
);

-- Where each shop operates, and the canonical base URL per country.
CREATE TABLE IF NOT EXISTS shop_country (
    shop_id      INTEGER NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
    country_code TEXT NOT NULL REFERENCES country(code),
    base_url     TEXT NOT NULL,                -- 'https://www.dm.at'
    active       INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (shop_id, country_code)
);

-- A product, keyed by EAN once we discover it. EAN is nullable so we can add a
-- row from a curated list before the first scrape has resolved it.
CREATE TABLE IF NOT EXISTS product (
    id            INTEGER PRIMARY KEY,
    ean           TEXT UNIQUE,
    producer_id   INTEGER NOT NULL REFERENCES producer(id),
    name          TEXT NOT NULL,                 -- canonical name (often anchor-country / German)
    name_en       TEXT,                          -- English name for international audiences
    size_value    REAL,
    size_unit     TEXT,                          -- 'ml','g','l','kg','piece'
    category      TEXT NOT NULL,
    subcategory   TEXT,
    search_hint   TEXT NOT NULL,                 -- query string for shop site search
    image_url     TEXT,                          -- best image URL discovered by the spider (JSON-LD)
    canonical_url TEXT,                          -- anchor-country product page URL (most often DM Germany)
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(producer_id, name, size_value, size_unit)
);

-- A price observation. Append-only — every scrape adds a new row.
-- Convention: `price_local` is ALWAYS the current shelf price (what a consumer pays today).
-- If the item is on promo, `is_promo = 1` and `regular_price_local` records the non-promo
-- reference price for context; the time-series stays clean and continuous.
CREATE TABLE IF NOT EXISTS price (
    id                  INTEGER PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    shop_id             INTEGER NOT NULL REFERENCES shop(id),
    country_code        TEXT NOT NULL REFERENCES country(code),
    parsed_at           TEXT NOT NULL DEFAULT (datetime('now')),
    url                 TEXT NOT NULL,        -- the page we scraped this from
    product_name_local  TEXT,                 -- name as displayed in that country
    price_local         REAL NOT NULL,        -- current shelf price (VAT-inclusive) in local currency
    currency_code       TEXT NOT NULL,
    price_eur           REAL NOT NULL,        -- price_local converted to EUR
    fx_rate             REAL,                 -- units of local currency per 1 EUR (NULL for EUR)
    is_promo            INTEGER NOT NULL DEFAULT 0,
    regular_price_local REAL,                 -- non-promo reference price in local currency (NULL if not on promo)
    regular_price_eur   REAL,                 -- non-promo reference price in EUR        (NULL if not on promo)
    raw_html_sha256     TEXT,                 -- hex sha256 of the scraped HTML, archived on disk
    raw_html_path       TEXT,                 -- relative path under data/snapshots/ (gitignored)
    is_sample           INTEGER NOT NULL DEFAULT 0  -- 1 = wage-scaled sample row, 0 = real scraped observation
);
CREATE INDEX IF NOT EXISTS idx_price_product ON price(product_id);
CREATE INDEX IF NOT EXISTS idx_price_when    ON price(parsed_at);
CREATE INDEX IF NOT EXISTS idx_price_country ON price(country_code);

-- One row per scrape run. Lets us answer "when did SK coverage break?".
CREATE TABLE IF NOT EXISTS scrape_run (
    id               INTEGER PRIMARY KEY,
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at      TEXT,
    shop_code        TEXT NOT NULL,
    countries        TEXT,                                 -- CSV of country codes scraped
    products_limit   INTEGER,
    products_total   INTEGER NOT NULL DEFAULT 0,
    products_ok      INTEGER NOT NULL DEFAULT 0,
    products_promo   INTEGER NOT NULL DEFAULT 0,
    products_no_match INTEGER NOT NULL DEFAULT 0,
    products_error   INTEGER NOT NULL DEFAULT 0
);

-- One row per (run × product × country) attempt.
CREATE TABLE IF NOT EXISTS scrape_attempt (
    id           INTEGER PRIMARY KEY,
    run_id       INTEGER NOT NULL REFERENCES scrape_run(id) ON DELETE CASCADE,
    product_id   INTEGER REFERENCES product(id),
    country_code TEXT NOT NULL REFERENCES country(code),
    started_at   TEXT NOT NULL DEFAULT (datetime('now')),
    status       TEXT NOT NULL,                            -- 'ok' | 'promo' | 'no_match' | 'no_fx' | 'error'
    error_class  TEXT,
    error_msg    TEXT,
    price_id     INTEGER REFERENCES price(id)              -- set when status in ('ok','promo')
);
CREATE INDEX IF NOT EXISTS idx_attempt_run ON scrape_attempt(run_id);

-- Eurostat Price Level Indices (dataset prc_ppp_ind, na_item=PLI_EU27_2020).
-- 100 = EU27 average. Used to triangulate our scraped prices vs. official data
-- in the case study (cross-check that direction + magnitude of spreads are sane).
CREATE TABLE IF NOT EXISTS eurostat_pli (
    country_code   TEXT NOT NULL REFERENCES country(code),
    year           INTEGER NOT NULL,
    category_code  TEXT NOT NULL,            -- e.g. 'CP00' (total), 'CP01' (food), 'CP12' (misc incl. personal care)
    category_label TEXT,
    value          REAL NOT NULL,            -- index value, EU27=100
    fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (country_code, year, category_code)
);

-- Convenience view: the latest price per (product, shop, country).
-- Includes derived ex-VAT price for cross-country comparison.
CREATE VIEW IF NOT EXISTS v_latest_prices AS
SELECT
    pr.id                                       AS price_id,
    p.id                                        AS product_id,
    p.ean,
    pd.name                                     AS producer,
    p.name                                      AS product_name,
    p.name_en                                   AS product_name_en,
    p.canonical_url                             AS product_canonical_url,
    p.size_value,
    p.size_unit,
    p.category,
    p.subcategory,
    s.code                                      AS shop_code,
    s.name                                      AS shop_name,
    c.code                                      AS country_code,
    c.name                                      AS country_name,
    pr.parsed_at,
    pr.url,
    pr.product_name_local,
    pr.price_local,
    pr.currency_code,
    pr.price_eur,
    pr.fx_rate,
    pr.is_promo,
    pr.is_sample,
    pr.regular_price_local,
    pr.regular_price_eur,
    CASE
        WHEN pr.is_promo = 1 AND pr.regular_price_eur > 0
        THEN (pr.regular_price_eur - pr.price_eur) / pr.regular_price_eur
        ELSE NULL
    END                                         AS discount_pct,
    c.vat_standard_rate,
    pr.price_eur / (1.0 + c.vat_standard_rate)  AS price_eur_ex_vat,
    c.median_hourly_wage_eur,
    CASE
        WHEN c.median_hourly_wage_eur > 0
        THEN pr.price_eur / c.median_hourly_wage_eur * 60.0
        ELSE NULL
    END                                         AS minutes_of_work
FROM price pr
JOIN product  p  ON p.id  = pr.product_id
JOIN producer pd ON pd.id = p.producer_id
JOIN shop     s  ON s.id  = pr.shop_id
JOIN country  c  ON c.code = pr.country_code
WHERE pr.id = (
    SELECT id FROM price
    WHERE product_id   = pr.product_id
      AND shop_id      = pr.shop_id
      AND country_code = pr.country_code
    ORDER BY parsed_at DESC
    LIMIT 1
);
