-- 006: Precision pass on the country reference table.
--
-- Why this matters
-- ----------------
-- Every headline number on the site is price × (1/VAT) × (1/wage). The prices
-- are directly observed and identity-verified; the multipliers in this table
-- are therefore the project's single biggest attack surface for a sceptical
-- reviewer (the intended audience includes EU-institution readers). This
-- migration replaces approximations with exact official values and corrects
-- two facts that changed by law in 2025/2026.
--
-- 1. WAGES — exact Eurostat SES 2022 medians replace "(approx)" integers.
--    Source: Eurostat dataset earn_ses_pub2s ("Median hourly earnings, all
--    employees (excluding apprentices) by sex"), sex=T, sizeclas=GE10,
--    unit=EUR, time=2022. Dataset last updated 2026-02-09; retrieved via the
--    Eurostat dissemination API on 2026-06-12. SES is quadrennial; 2022 is the
--    latest wave. Direction-of-bias note for the methodology: CEE nominal
--    wages have grown faster than DACH wages since 2022, so 2022 denominators
--    slightly OVERSTATE today's minutes-of-work in low-wage countries; the
--    qualitative conclusion is unaffected, and the bias is documented openly.
--    Switzerland now uses the same Eurostat series (37.64 EUR) instead of the
--    previous BFS estimate (33.0), so all countries share one source.
--
-- 2. ROMANIA VAT — standard rate 19% -> 21%, reduced consolidated to 11%
--    (Law no. 141/2025, Official Gazette 2025-07-25, effective 2025-08-01).
--    All price rows in the DB postdate 2025-08-01, so applying the current
--    rate to every row is correct.
--
-- 3. BULGARIA EURO — Bulgaria adopted the euro on 2026-01-01 (21st euro-area
--    member; fixed conversion 1 EUR = 1.95583 BGN). Scraped BG rows already
--    carry EUR prices (dm-drogeriemarkt.bg switched display); only this
--    reference label was stale.

-- 1. Exact SES 2022 median gross hourly earnings (EUR)
UPDATE country SET median_hourly_wage_eur = 19.39,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'DE';
UPDATE country SET median_hourly_wage_eur = 17.65,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'AT';
UPDATE country SET median_hourly_wage_eur = 10.47,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'SI';
UPDATE country SET median_hourly_wage_eur = 8.23,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'CZ';
UPDATE country SET median_hourly_wage_eur = 6.82,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'HR';
UPDATE country SET median_hourly_wage_eur = 5.73,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'HU';
UPDATE country SET median_hourly_wage_eur = 6.90,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'PL';
UPDATE country SET median_hourly_wage_eur = 7.72,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'SK';
UPDATE country SET median_hourly_wage_eur = 5.55,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'RO';
UPDATE country SET median_hourly_wage_eur = 4.05,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'BG';
UPDATE country SET median_hourly_wage_eur = 13.05,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'IT';
UPDATE country SET median_hourly_wage_eur = 37.64,
    wage_source = 'Eurostat earn_ses_pub2s (SES 2022 median gross hourly earnings, EUR), retrieved 2026-06-12',
    wage_year = 2022 WHERE code = 'CH';

-- 2. Romania: standard 21%, reduced 11% (Law 141/2025, effective 2025-08-01)
UPDATE country SET vat_standard_rate = 0.21, vat_food_rate = 0.11 WHERE code = 'RO';

-- 3. Bulgaria: euro since 2026-01-01 (fixed conversion 1 EUR = 1.95583 BGN)
UPDATE country SET currency_code = 'EUR' WHERE code = 'BG';
