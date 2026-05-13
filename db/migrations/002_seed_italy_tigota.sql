-- Add Italy + Tigotà, the IT drugstore chain needed for the SK<->IT
-- comparison that motivated EUPRICE in the first place.
-- (DM doesn't operate in Italy, so we need a different shop.)

INSERT OR IGNORE INTO country
    (code, name, currency_code, vat_standard_rate, vat_food_rate,
     median_hourly_wage_eur, wage_source, wage_year)
VALUES
    ('IT', 'Italy', 'EUR', 0.22, 0.10, 16.0,
     'Eurostat earn_ses_hourly (approx)', 2022);

INSERT OR IGNORE INTO shop (code, name) VALUES
    ('tigota', 'Tigotà');

INSERT OR IGNORE INTO shop_country (shop_id, country_code, base_url, active) VALUES
    ((SELECT id FROM shop WHERE code='tigota'), 'IT', 'https://www.tigotaonline.it', 1);
