-- Seed countries (where DM operates) and the DM shop with its country base URLs.
-- VAT rates are the standard rate as of early 2026; reduced food rate where applicable.
-- Verify periodically — VAT laws change.

INSERT OR IGNORE INTO country
    (code, name, currency_code, vat_standard_rate, vat_food_rate,
     median_hourly_wage_eur, wage_source, wage_year)
VALUES
    -- Wage values: rough placeholders based on Eurostat earn_ses_hourly 2022 release.
    -- TODO: refresh via the Eurostat fetcher (step 12) for precise values.
    ('DE', 'Germany',  'EUR', 0.19,  0.07,  22.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('AT', 'Austria',  'EUR', 0.20,  0.10,  20.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('SK', 'Slovakia', 'EUR', 0.23,  0.19,   9.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('CZ', 'Czechia',  'CZK', 0.21,  0.12,  11.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('HU', 'Hungary',  'HUF', 0.27,  0.18,   8.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('PL', 'Poland',   'PLN', 0.23,  0.05,  10.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('SI', 'Slovenia', 'EUR', 0.22,  0.095, 13.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('HR', 'Croatia',  'EUR', 0.25,  0.13,  10.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('RO', 'Romania',  'RON', 0.19,  0.09,   8.0, 'Eurostat earn_ses_hourly (approx)', 2022),
    ('BG', 'Bulgaria', 'BGN', 0.20,  0.09,   6.0, 'Eurostat earn_ses_hourly (approx)', 2022);

INSERT OR IGNORE INTO shop (code, name) VALUES
    ('dm', 'DM Drogerie Markt');

INSERT OR IGNORE INTO shop_country (shop_id, country_code, base_url, active) VALUES
    ((SELECT id FROM shop WHERE code='dm'), 'DE', 'https://www.dm.de',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'AT', 'https://www.dm.at',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'SK', 'https://mojadm.sk',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'CZ', 'https://www.dm.cz',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'HU', 'https://www.dm.hu',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'PL', 'https://www.dm.pl',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'SI', 'https://www.dm.si',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'HR', 'https://www.dm.hr',               1),
    ((SELECT id FROM shop WHERE code='dm'), 'RO', 'https://www.dm-drogeriemarkt.ro', 1),
    ((SELECT id FROM shop WHERE code='dm'), 'BG', 'https://www.dm-drogeriemarkt.bg', 1);
