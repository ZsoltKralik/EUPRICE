# EUPRICE — Methodology

> See also: [README](../README.md) · [Architecture](ARCHITECTURE.md)

This document describes how EUPRICE collects, normalizes, and reports cross-EU consumer prices. It is intended for two audiences: researchers and policy analysts who want to assess the validity of findings, and contributors who want to add data sources without breaking the methodology.

If you cite an EUPRICE figure in published work, please follow the [citation guidance](#10-citation) at the end.

---

## 1. Research question

When the *same physical product* (verified by EAN-13 barcode) is sold in multiple EU countries by the same retailer or retail chain, how does its consumer-facing price vary across borders — both in nominal EUR and in equivalent labor time at the country's median hourly wage?

This question is directly relevant to **European Commission policy on territorial supply constraints** (TSCs): contractual or de-facto restrictions manufacturers place on cross-border retail flows that allow them to price-discriminate across the single market.

## 2. Unit of observation

The atomic record is a `price` row:

> *On `<date>`, retailer `<shop>` listed product `<EAN>` in country `<country>` at shelf price `<price_local>` `<currency>`, equivalent to `<price_eur>` after applying the ECB reference rate of that date.*

Each `price` row also records:
- The exact URL that was scraped
- The local-language product name as displayed
- The promotion status and (if applicable) the non-promo reference price
- A SHA-256 of the scraped HTML, with the snapshot archived on disk

## 3. Data sources

### 3.1 Retailer catalogs (primary)

Online product pages from retailers operating in multiple EU countries.

| Shop | Countries | Status |
|---|---|---|
| **[DM Drogerie Markt](https://www.dm.de)** | DE, AT, SK, CZ, HU, PL, SI, HR, RO, BG | implemented |
| **[Tigotà](https://www.tigota.it)** | IT | scaffold; needed for IT↔SK comparisons |

Retailers are chosen because they (a) operate cross-border with comparable catalogs and (b) expose structured product data (JSON-LD with `gtin13`) on detail pages, which makes EAN-based matching reliable.

**Online vs in-store**: prices reported here are from online catalogs. Some chains price differently in-store, especially for promotions. This is a known limitation.

### 3.2 Eurostat reference datasets

| Dataset | Use | Update cycle |
|---|---|---|
| [`earn_ses_hourly`](https://ec.europa.eu/eurostat/databrowser/view/earn_ses_hourly/) (Structure of Earnings Survey, hourly earnings) | Country median hourly wage, used in the minutes-of-work metric | Every 4 years (latest 2022) |
| [`prc_ppp_ind`](https://ec.europa.eu/eurostat/databrowser/view/prc_ppp_ind/) (Price Level Indices) | Triangulation: do our scraped spreads agree with Eurostat's published indices? | Annual |

Eurostat data is pulled via the public [Eurostat JSON-stat API](https://wikis.ec.europa.eu/display/EUROSTATHELP/API+-+Getting+started) in `scraper/core/eurostat.py` and stored in the `eurostat_pli` and `country` tables.

### 3.3 Currency conversion

Daily euro reference rates from the **[European Central Bank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)**, fetched at scrape time from <https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml>. The specific rate used for each conversion is stored on the `price` row (`fx_rate` column) for full audit. For non-EUR countries (CZ, HU, PL, RO, BG), the displayed EUR price reflects the rate active on the scrape date.

BGN is pegged to EUR at the convergence rate of 1.95583; this is hard-coded as a fallback when ECB omits the lev.

### 3.4 VAT rates

Standard and reduced (food) VAT rates per country are seeded in `db/migrations/001_seed_countries_and_shops.sql` from each country's tax-authority publications, current as of 2026 Q1. Drugstore items use the standard rate; food items use the reduced rate. VAT rates change; review periodically.

## 4. Product identity — EAN-first

[EAN-13 barcodes](https://www.gs1.org/standards/barcodes/ean-upc) are the canonical product identity. They are:
- **Globally unique** (assigned by [GS1](https://www.gs1.org) manufacturer registries)
- **Language-independent** (a barcode means the same thing in Helsinki and Athens)
- **Stable** (the same physical SKU keeps its EAN through pack-design refreshes)

Two prices are considered comparable only when they share an EAN. Without that constraint, "the same product" is ambiguous (different sizes, variants, formulations, multi-packs).

### 4.1 Bootstrap

For each tracked product:
1. The "anchor" country (DM Germany) is scraped first using a name-based search hint.
2. The product detail page's JSON-LD block exposes `gtin13`. This becomes the canonical EAN.
3. Every other country is then searched by EAN directly — far more reliable than text search, and immune to cross-language naming differences ("Elseve" in IT, "Elvital" in DE, "Elseve" in NL — same EAN).

### 4.2 Local naming

Each scrape stores the local-language product name (`product_name_local` on the `price` row). This both:
- Documents what the consumer actually sees on the shelf
- Builds a multilingual product dictionary as a side-effect, useful for later linguistic analyses

## 5. Price normalization

For each scraped price, the system derives three views:

| View | Formula | Meaning |
|---|---|---|
| **Shelf price (EUR, incl. VAT)** | `price_local / fx_rate_per_eur` | What the consumer pays today |
| **Shelf price (EUR, ex-VAT)** | `price_eur / (1 + vat_standard_rate)` | Strips national tax — isolates retailer/manufacturer pricing |
| **Minutes of median wage** | `(price_eur / median_hourly_wage_eur) × 60` | Real cost in labor time |

The first is the consumer-facing fact. The second isolates the policy-relevant pricing decision. The third is the most defensible cross-country comparison because it accounts for income differences.

## 6. The minutes-of-work metric

> *A €3 micellar water in Vienna (median wage ~€20/h) costs ~9 minutes of work. The same product at €3.40 in Bratislava (median wage ~€9/h) costs ~23 minutes — 2.5× the labor for nearly the same nominal price.*

This is the headline metric of EUPRICE and the case study's central finding. The arithmetic is trivial; the analytical move is choosing to express price in labor time rather than nominal EUR.

Justifications:
- **Better than EUR for cross-country comparison**: nominal EUR ignores purchasing power.
- **Better than PPP-adjusted EUR for consumer narrative**: PPP indices are abstract; "minutes of work" is concrete and quotable.
- **Aligns with the policy framing**: the harm from territorial supply constraints is felt unequally — it falls hardest on consumers in low-wage countries.

## 7. Promotions

Promos distort point-in-time comparisons. Each `price` row carries an `is_promo` flag and, when known, the regular (non-promo) reference price. Behavior:
- The `price_local` field always reflects what the consumer pays today (promo price if on promo).
- The time-series stays continuous (no gaps when a promo starts/ends).
- The web UI marks promo rows distinctly and shows the discount percentage.
- For headline statistics, promos can be filtered out in queries.

## 8. Reproducibility

Every scraped HTML page is archived to `data/snapshots/<YYYY-MM-DD>/<sha256>.html`. The hash is stored on the `price` row (`raw_html_sha256`), so any specific finding can be re-verified by reading the exact page that was parsed. This is in addition to the live URL, which may change or 404 over time.

To reproduce a specific finding:

1. Run `python -m scraper.refresh init-db` to apply the schema.
2. The scraper is deterministic given the same target URLs; re-running fetches fresh prices but the historical archive is untouched.
3. The web JSON snapshots are regenerated by `python scripts/export_for_web.py`.

## 9. Limitations

| Limitation | Mitigation |
|---|---|
| Online prices ≠ in-store prices in some chains | Documented; users should treat findings as "online catalog evidence" |
| Promo dynamics distort comparisons | `is_promo` flag exposed; can be filtered |
| Eurostat wage data has multi-year lag (latest SES is 2022) | Acceptable for stable comparisons; cite the survey year |
| Pack-size variants (3-pack vs single) have different EANs | EAN-keyed identity prevents accidental comparisons across pack sizes |
| Curated product list is not representative of all consumer spending | EUPRICE is a case-study tool, not a general price index |
| Sample data may be present until first full real scrape | Sample rows have `url` starting with `sample://` — easy to filter |

## 10. Citation

When citing EUPRICE findings in published work, please include:

- The specific scrape date (`parsed_at` field, ISO-8601)
- The Eurostat dataset version used for wages and PLI
- The retailer code, country code, and EAN
- The raw HTML SHA-256 if pointing to a specific finding

Sample citation:

> Bratislava (SK) shelf price of €3.39 for Balea Mizellenwasser 3in1 Rose 400 ml (EAN 4066447365962), scraped from mojadm.sk on 2026-05-13. Source: EUPRICE (`price_id=42`, `raw_html_sha256=…`). Slovak median hourly wage of €9.00 from Eurostat `earn_ses_hourly` (2022 release).

## 11. Open issues

- The `eurostat_pli` table is populated but not yet rendered in the web UI (planned).
- Per-shop confidence scoring (`match_method` enum) would help filter EAN-verified vs name-matched rows in published statistics; not yet implemented.
- Adding Tigotà (Italy) to enable the IT↔SK comparison that motivates the project.
