-- 005: Add Switzerland (CH) and the Müller retail chain — the second
-- pan-EU drugstore witness for cross-retailer EAN verification.
--
-- Why this matters
-- ----------------
-- Today every identity claim rests on DM's own JSON-LD gtin13. If DM
-- mis-labels a barcode in one country (recycling SKU IDs, recycled EANs),
-- nothing in the pipeline can catch it. Adding Müller as a second pan-EU
-- drugstore gives every shared country (DE, AT) two independent retailer
-- witnesses on every EAN — the single biggest methodology upgrade available.
--
-- Switzerland is the bonus: a high-wage non-EU comparator. Including CH in
-- the wage-time framing demonstrates the gap is a wage-distribution
-- phenomenon, not an EU-single-market artefact.
--
-- Other Müller countries (HU, SI, CZ, IT) exist but are gated behind bot
-- defenses or client-side rendering that needs Jina Reader; deferred to a
-- later iteration once the DE/AT/CH path is proven.
-- HR has no Müller online shop (DNS doesn't resolve).

INSERT OR IGNORE INTO country
    (code, name, currency_code, vat_standard_rate, vat_food_rate,
     median_hourly_wage_eur, wage_source, wage_year)
VALUES
    -- Swiss median hourly wage from BFS Lohnstrukturerhebung 2022, converted at
    -- 1 CHF ≈ 1.03 EUR (ECB late-2022 average). Standard VAT raised to 8.1 % in
    -- 2024; reduced rate 2.6 % on food/personal care doesn't apply to most
    -- drugstore items so we keep VAT_food at the 8.1 % bracket value.
    ('CH', 'Switzerland', 'CHF', 0.081, 0.026, 33.0,
     'BFS Lohnstrukturerhebung 2022 (median, all sectors)', 2022);

INSERT OR IGNORE INTO shop (code, name) VALUES
    ('mueller', 'Müller');

-- DE/AT/CH active by default — confirmed alive with EAN-search returning real
-- product pages. HU/SI/CZ/IT seeded but disabled (active=0) so they can be
-- toggled on once the spider proves it can render their pages.
INSERT OR IGNORE INTO shop_country (shop_id, country_code, base_url, active) VALUES
    ((SELECT id FROM shop WHERE code='mueller'), 'DE', 'https://www.mueller.de', 1),
    ((SELECT id FROM shop WHERE code='mueller'), 'AT', 'https://www.mueller.at', 1),
    ((SELECT id FROM shop WHERE code='mueller'), 'CH', 'https://www.mueller.ch', 1),
    ((SELECT id FROM shop WHERE code='mueller'), 'HU', 'https://www.mueller.hu', 0),
    ((SELECT id FROM shop WHERE code='mueller'), 'SI', 'https://www.mueller.si', 0),
    ((SELECT id FROM shop WHERE code='mueller'), 'CZ', 'https://www.mueller.cz', 0),
    ((SELECT id FROM shop WHERE code='mueller'), 'IT', 'https://www.mueller.it', 0);
