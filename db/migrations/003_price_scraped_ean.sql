-- 003: Add scraped_ean column to price + expose it in v_latest_prices.
--
-- Rationale: the EAN-first strategy in the spider only inserts rows whose
-- candidate page's JSON-LD gtin13 equals the seed EAN. Persisting that
-- scraped EAN per row gives a permanent audit trail — if a future change to
-- the matching logic ever introduces a regression, audit_pack_quality.py can
-- now flag any row where scraped_ean disagrees with the product's canonical
-- EAN.
--
-- SQLite limitation: views can't be ALTERed in place; drop + recreate.

ALTER TABLE price ADD COLUMN scraped_ean TEXT;

DROP VIEW IF EXISTS v_latest_prices;

CREATE VIEW v_latest_prices AS
SELECT
    pr.id                                       AS price_id,
    p.id                                        AS product_id,
    p.ean,
    pr.scraped_ean,
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
