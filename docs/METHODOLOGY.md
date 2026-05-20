# EUPRICE — Methodology

> See also: [README](../README.md) · [Architecture](ARCHITECTURE.md)

This document describes how EUPRICE collects, normalizes, and reports cross-EU consumer prices. It is intended for two audiences: researchers and policy analysts who want to assess the validity of findings, and contributors who want to add data sources without breaking the methodology.

If you cite an EUPRICE figure in published work, please follow the [citation guidance](#10-citation) at the end.

---

## 0. Why this is a fair comparison

The site is built to support a policy claim — *"EU consumers in lower-wage countries pay more, in real labor time, for identical drugstore SKUs"* — and that claim is only as strong as the identity guarantees underneath every row. This is the 60-second methodological case for trusting the numbers:

1. **Same physical SKU.** Every price row's source page has been verified to expose the seed EAN-13 in its JSON-LD `gtin13`. The scraped EAN is preserved per row (`price.scraped_ean`) so the audit can re-verify identity at any time.
2. **Same retailer group.** Currently DM Drogerie Markt only. No cross-retailer averaging that would mix supply-chain effects with retail-margin effects.
3. **Same retailer-internal SKU id.** When EAN-13 codes diverge between countries (regionally re-labeled SKUs), we accept a row only when DM's own `/p/d/<NNNN>/` id matches between the anchor country's URL and the scraped country's URL.
4. **Pack-guard validation.** Multi-pack markers, unit-category mismatches (200 ml seed vs 100 g scrape), and size deviations greater than ±15 % are rejected automatically. Catches the wrong-product-line failures common to text-search matchers.
5. **Minimum coverage threshold.** Every product on the public site has observations in at least 5 EU countries. Two German-speaking neighbors aren't a cross-EU finding, so DACH-only products are excluded.
6. **Append-only history with reproducible snapshots.** Every scraped HTML page is archived locally with a SHA-256 fingerprint on the row, so any specific finding can be re-verified against the exact bytes that were parsed.

If any of these break — e.g. a future spider regression silently re-introduces wrong-product matches — `scripts/audit_pack_quality.py` will surface it on the next audit run.

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

## 4. Product identity — strict EAN-or-retailer-SKU

[EAN-13 barcodes](https://www.gs1.org/standards/barcodes/ean-upc) are the canonical product identity. They are:
- **Globally unique** (assigned by [GS1](https://www.gs1.org) manufacturer registries)
- **Language-independent** (a barcode means the same thing in Helsinki and Athens)
- **Stable** (the same physical SKU keeps its EAN through pack-design refreshes)

Two prices are considered comparable only when one of two strict identity criteria is met. Without that constraint, "the same product" is ambiguous (different sizes, variants, formulations, multi-packs, sometimes outright different products).

### 4.1 The two acceptance criteria

For every cross-country scrape, the spider applies these criteria in order, from strongest to weakest. **A row is inserted only if one of them is satisfied** — there is no silent "fuzzy" fallback.

**(a) EAN-13 equality (strongest).** The candidate page's JSON-LD `gtin13` value equals the canonical EAN captured from the anchor country. This is the gold standard of product identity. Pack-guard (see §4.4) still applies as a safety net against multi-pack variants that occasionally share an EAN with the single-unit SKU.

**(b) Retailer-internal SKU equality (strong, retailer-specific).** Some retailers, including DM, use the same numeric SKU id in their URL pattern (`/p/d/<NNNN>/`) across all their country domains, even when the displayed JSON-LD EAN happens to differ between countries (retailer-assigned regional EANs for the same physical product). When the candidate URL carries the same SKU id as the anchor country's product URL, that is the retailer's own "same product" claim and is accepted. Pack-guard still applies.

If neither criterion is met, the country has no observation for this product. This deliberate gap is preferable to inserting a row with weaker identity guarantees: a missing cell is honest; a wrong row is misleading.

### 4.2 Pre-strict-matcher problems this prevents

The strict matcher replaced an earlier text-scoring approach that produced silent product-mixing across countries. Concrete examples surfaced and fixed during the audit:

- **Nivea Soft Creme 200 ml jar** was matched in CZ and HU to a 100 g Nivea Creme Soft *soap bar* — different product line, different EAN, but related name.
- **Denkmit liquid floor cleaner** was matched in AT/DE to "WC Duftstein" *toilet stones* (different category entirely).
- **alverde lip balm 4.8 g** was matched in HU/PL/SI to nail polish and cream blusher (because they shared the "rose" colour).
- **Gillette Fusion5 4-pack blades** was matched in HR/HU to a single whole razor (different SKU, "1 db" / "1 kom").

Every row in the current dataset has been re-validated under the strict criteria.

### 4.3 Bootstrap

For each tracked product:
1. The "anchor" country (DM Germany) is scraped first using a name-based search hint (Phase 2 of the spider — text-scored matching with pack-guard).
2. The product detail page's JSON-LD block exposes `gtin13` and the spider records both the EAN and the canonical URL (which contains the DM internal SKU id).
3. Every other country is then searched by EAN directly — far more reliable than text search, and immune to cross-language naming differences. The DM-SKU fallback catches the remaining cases where the local DM site indexes a different EAN for the same SKU.

**EAN as prerequisite.** Products that fail to acquire an EAN at the anchor step are excluded from the database entirely. The pipeline enforces this by deleting any post-capture row where `ean IS NULL` before the cross-country scrape begins.

### 4.4 Pack-guard (size and category integrity)

Even when EAN or SKU equality is satisfied, the candidate's local product name is checked against the seed's `size_value` and `size_unit`:

| Check | Rejects |
|---|---|
| **Multi-pack markers** | `2x4,8 g`, `12x80 St`, `Duopack`, `Doppelpack`, `Tripack`, `Jumbopack`, `Reisegröße`, `Travel size`, `Mini-pack`, etc. — including multi-digit prefixes (`12x80`, `30x19,25`) |
| **Unit-category mismatch** | Seed is volume (ml/l) but scrape units are only weight (g/kg) or piece-count, and vice versa. Catches the 200 ml cream → 100 g soap bar class of error. |
| **Same-category size deviation > 15 %** | A 40-pack seed cannot match a 30-pack scrape; a 200 ml seed cannot match a 175 ml scrape. |

This guard runs on every candidate, regardless of which acceptance criterion fired.

### 4.5 Audit trail per row

Every `price` row stores the actual EAN that the JSON-LD on the scraped page exposed, in a `scraped_ean` column added by migration 003. This persists the matcher's evidence so the audit (`scripts/audit_pack_quality.py`) can independently re-verify that every row's identity claim still holds, weeks or months after the row was inserted.

The audit classifies suspect rows into:

| Class | Meaning |
|---|---|
| **EAN_DIFF** | Scraped EAN differs from canonical EAN AND the DM-SKU also differs. Hard fail. |
| **CATEGORY** | Seed unit category and scrape unit category disagree (volume↔weight↔piece). Hard fail. |
| **MULTI** | Multi-pack indicator in the scraped name. Hard fail. |
| **SIZE** | Same-category size deviates > 15 %. Hard fail. |
| **TOKEN_MISS** | Seed name tokens missing from scrape. Soft warning — typically a cross-language naming difference (Mizellenwasser → Micelárna voda). Informational, not a quality failure. |

A clean dataset has zero EAN_DIFF / CATEGORY / MULTI / SIZE flags.

### 4.2 Local naming

Each scrape stores the local-language product name (`product_name_local` on the `price` row). This both:
- Documents what the consumer actually sees on the shelf
- Builds a multilingual product dictionary as a side-effect, useful for later linguistic analyses

### 4.3 Display names

Each `product` row has two name fields:
- `name` — the canonical name in the anchor country's language (typically German for DM products).
- `name_en` — the English equivalent for the international audience.

The web app prefers `name_en` when set, otherwise falls back to `name`. The per-scrape `product_name_local` is shown separately on the product detail page when it differs (e.g. "Local name: Elvital Color Glanz Shampoo" under the English title "Elvital / Elseve Color Vive Shampoo"). This makes the cross-language story visible rather than hidden.

### 4.4 Canonical URL

Each `product` row also stores a `canonical_url` — the URL of the actual retailer product page on the anchor country (DM Germany by default). This is captured automatically by the scraper from the URL it lands on after the search-and-score step. The web app uses it for "View at retailer" links, so case-study readers can verify any finding by clicking through to the source.

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

## 6a. The basket aggregate

Per-product findings answer "*how much does this one item cost in worktime across the EU?*" The basket aggregate answers a different and equally important question: "*how much of someone's working day does a representative bundle of everyday essentials cost in each country?*"

Aggregating prices across products is methodologically dangerous, because if each country's basket contains a *different* set of products, the resulting sums are not comparable. EUPRICE defines two strict basket views to preserve apples-to-apples integrity.

### 6a.1 Universal basket (primary)

The universal basket contains only products that have been observed in **every** EU country in the dataset. The basket is the intersection across all observed countries.

- Today's universal basket: 6 products (Balea Deo Roll-On Sensitive, Ebelin Wattepads, Ebelin Wattestäbchen Recycling, dontodent PRO+ Zahnpasta, dontodent Zahnbürste Soft Protect, dontodent Mundspülung Total Power). Every one of the 10 DM EU countries (DE/AT/CZ/SK/HU/PL/SI/HR/RO/BG) has all 6.
- Aggregate per country = sum of the 6 EUR prices (and the 6 worktime values).
- Every country's total uses the same 6 SKUs. This is the apples-to-apples guarantee.

### 6a.2 Pairwise basket (secondary)

For any two specific countries A and B, the pairwise basket contains products observed in **both** A and B. Different country pairs yield different baskets, but each pair is still apples-to-apples *within itself*.

- DE↔BG pairwise basket (today): ~22 products observed in both
- DE↔PL pairwise basket (today): ~14 products
- Pairwise totals are valid for that specific pair only — **cross-pair ratios are non-transitive** and the UI says so explicitly.

### 6a.3 Hard rules

| Rule | Reason |
|---|---|
| **Never impute missing prices.** | If a country lacks an SKU, that SKU is excluded — for the universal basket entirely, for the pairwise basket only from the pairs that lack it. No fabricated data. |
| **Version the basket.** | The universal basket is named (`v1`, `v2`, …) and its composition + snapshot date are stored alongside any published total. When new SKUs are added and the basket grows, the prior version stays citable. |
| **Display N alongside the total.** | Every basket total is shown as "€X / Y min (n products)" so sample size is never hidden. |
| **VAT-inclusive primary, ex-VAT secondary.** | Consumer perspective leads; ex-VAT isolates retailer/manufacturer pricing. |
| **Promo rows flagged in the aggregate.** | If any product in a country's basket is on promo at scrape time, the country's total is badged; a "non-promo total" is also computable. |
| **FX snapshot per row.** | Each `price` row stores its own `fx_rate`; basket sums use those stored values, so the aggregate is reproducible against the ECB feed on the scrape date. |
| **No cross-pair transitive claims.** | If DE↔BG is 7×, DE↔PL is 3×, the UI does not multiply, divide, or compose these into a BG↔PL claim. |

### 6a.4 What the basket adds to the case study

A per-product finding ("micellar water costs 9× more worktime in BG") is striking but easy to dismiss as a single anomaly. The basket aggregate makes the same claim *cumulatively*:

> *The universal basket of 6 daily essentials costs an Austrian buyer ~50 minutes of work, but a Bulgarian buyer ~250 minutes — 5× the labor time, for the identical six SKUs at the identical retailer, no exceptions, no fuzzy matching.*

That number is harder to attribute to a single negotiating quirk; it is evidence of a systematic pattern.

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
- Per-row `match_method` enum (`ean | sku | name | manual`) would let published statistics filter by acceptance criterion. Currently inferrable by comparing `price.scraped_ean` vs `product.ean` and DM SKU equality, but not a stored field.
- Adding Tigotà (Italy) to enable the IT↔SK comparison that motivates the project. Scaffold exists; spider implementation pending.
- Adding Müller (DE, AT, CH, HU, SI, HR, CZ, IT) as a second pan-EU drugstore for cross-retailer validation.
- 9 of 18 tracked products currently only have AT+DE observations (anchor pair). Either expand DM coverage to non-DACH or accept the limitation as a property of which SKUs DM stocks where.
