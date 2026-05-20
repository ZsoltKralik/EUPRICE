# EUPRICE — Architecture

> See also: [README](../README.md) · [Methodology](METHODOLOGY.md)

How the system is built. Audience: contributors and the future-you trying to add a shop six months from now.

For the methodological side (data sources, normalization rules), see [METHODOLOGY.md](METHODOLOGY.md).

---

## High-level

Two independent processes with a SQLite file between them:

```
   ┌──────────────────────┐
   │  scraper (Python)    │     scraper writes
   │                      │ ──────────────────────►  db/eu_prices.db  (SQLite, WAL)
   │  data/products.csv   │                                 │
   │       (you edit)     │                                 │ scripts/export_for_web.py
   └──────────────────────┘                                 ▼
                                                    web/data/*.json
                                                            │
                                                            ▼
                                                ┌──────────────────────┐
                                                │   web (Next.js)      │
                                                │   reads JSON only    │
                                                └──────────────────────┘
```

This decoupling matters:
- The web side has **zero native dependencies** (avoids the painful `better-sqlite3` build on Windows that needs VS Build Tools).
- Static JSON snapshots are trivially deployable to Vercel or any static host.
- The web process never touches the scraper's runtime.

## Repository layout

```
EUPRICE/
├── data/
│   ├── products.csv              # what to track (you maintain)
│   └── snapshots/<date>/*.html   # archived scraped pages, gitignored
├── db/
│   ├── schema.sql                # canonical schema
│   ├── migrations/*.sql          # seed data + future migrations
│   └── eu_prices.db              # the file, gitignored
├── docs/
│   ├── METHODOLOGY.md
│   └── ARCHITECTURE.md           # this file
├── pyproject.toml
├── scraper/
│   ├── core/                     # shared infrastructure
│   │   ├── fetch.py              # httpx + pluggable render backends
│   │   ├── db.py                 # SQLite operations
│   │   ├── fx.py                 # ECB euro reference rates
│   │   ├── normalize.py          # EUR conversion, VAT, per-unit
│   │   ├── eurostat.py           # Eurostat JSON-stat API
│   │   ├── env.py                # tiny .env loader (no deps)
│   │   └── models.py             # pydantic types
│   ├── spiders/                  # one module per retailer
│   │   ├── base.py               # abstract Spider
│   │   ├── dm.py                 # DM Drogerie Markt
│   │   └── tigota.py             # Tigotà (Italy, scaffold)
│   └── refresh.py                # typer CLI: init-db, run, test-jina
├── scripts/                      # one-off operations
│   ├── verify_schema.py
│   ├── seed_sample_prices.py     # populate demo data without scraping
│   ├── enrich_images.py          # Open Beauty Facts → /public/images
│   ├── capture_missing_eans.py   # Playwright → DM Germany → EANs
│   ├── localize_images.py        # download remote image URLs to /public
│   ├── find_eans.py              # OBF/OFF EAN lookup
│   └── export_for_web.py         # SQLite → web/data/*.json
└── web/
    ├── app/                      # Next.js App Router routes
    ├── components/               # React components
    ├── lib/                      # data access + utilities
    ├── public/
    │   ├── images/<id>.jpg       # product images
    │   └── world-110m.json       # topojson for the map
    └── data/*.json               # generated from SQLite
```

## Schema

Five dimension tables + one fact table + supporting:

```
country (code PK, name, currency_code, vat_standard_rate, vat_food_rate,
         median_hourly_wage_eur, wage_source, wage_year)
producer (id PK, name UNIQUE)
shop (id PK, code UNIQUE, name)
shop_country (shop_id, country_code, base_url, active)
product (id PK, ean UNIQUE, producer_id, name, size_value, size_unit,
         category, subcategory, search_hint, image_url)

price (id PK, product_id, shop_id, country_code, parsed_at, url,
       product_name_local, price_local, currency_code, price_eur, fx_rate,
       is_promo, regular_price_local, regular_price_eur,
       raw_html_sha256, raw_html_path,
       scraped_ean, is_sample)

eurostat_pli (country_code PK, year PK, category_code PK, category_label, value)

scrape_run (id PK, started_at, finished_at, shop_code, countries,
            products_total, products_ok, products_promo, products_no_match,
            products_error)
scrape_attempt (id PK, run_id, product_id, country_code, started_at,
                status, error_class, error_msg, price_id)

v_latest_prices (view) — latest price per (product, shop, country)
                         with derived ex_VAT, minutes_of_work, discount_pct,
                         plus product_name_en and product_canonical_url for
                         the web UI
```

### Product columns explained

| Column | Source | Notes |
|---|---|---|
| `name` | curated CSV (often German) | Canonical name; defaults to anchor-country language |
| `name_en` | curated CSV | English translation for the international audience; preferred in the web UI when set |
| `search_hint` | curated CSV | Query string used against the shop's site search; can be tuned per shop catalog quirks (e.g. "elvital" for DM DE, "elseve" elsewhere) |
| `ean` | scraper (JSON-LD `gtin13`) | Canonical product identity once captured; never overwritten by name-based matching |
| `image_url` | scraper (JSON-LD `image`) → localized to `/images/<id>.jpg` | Falls back to Open Beauty Facts when JSON-LD has none |
| `canonical_url` | scraper (the URL it landed on) | Anchor-country product page; the web app uses this for "View at retailer" links |

The `price` table is append-only: every scrape adds rows. History accumulates automatically. The `v_latest_prices` view returns the most recent row per (product, shop, country).

### Strict matcher in the DM spider

The DM spider applies a strict two-tier acceptance rule, in order from strongest to weakest:

1. **EAN equality.** Candidate page's JSON-LD `gtin13` equals seed `product.ean`. Pack-guard still runs as a safety net.
2. **Retailer-SKU equality.** Candidate URL contains the same `/p/d/<NNNN>/` id as `product.canonical_url`. Pack-guard still runs.

If neither fires, the spider returns `None` and the country gets no observation. There is no silent text-match fallback. This is the contract that makes cross-country claims defensible.

The captured `scraped_ean` is persisted on the `price` row so the audit script (`scripts/audit_pack_quality.py`) can independently re-verify identity claims at any time. See [METHODOLOGY § 4](METHODOLOGY.md#4-product-identity--strict-ean-or-retailer-sku) for the rationale.

## Scraper

### Layered responsibilities

| Layer | Knows about | Doesn't know about |
|---|---|---|
| `spiders/*.py` | The site's HTML structure | EUR conversion, VAT, DB schema |
| `core/fetch.py` | httpx, Playwright, Jina | The site, business logic |
| `core/normalize.py` | Math | Currencies (just rates), VAT (just numbers) |
| `core/db.py` | SQLite | Site structure, business logic |
| `core/fx.py` | ECB feed | Anything else |
| `refresh.py` | Orchestration, parallelism | Site internals |

Spiders return `ScrapedPrice` pydantic objects; the orchestrator handles all conversion, persistence, logging.

### Rendering backends

`Fetcher.get_rendered(url)` dispatches to one of three implementations, chosen at startup via `EUPRICE_RENDER`:

| Backend | Cost | Behavior |
|---|---|---|
| `playwright` (default) | $0 | Local Chromium via the Playwright sync API. Lazy-loaded — only starts when first used. ~300 MB RAM per Fetcher instance. |
| `jina` | API call | Jina Reader (`r.jina.ai`) with browser engine + HTML format. Zero local install but paid. |
| `disabled` | $0 | Falls through to httpx. For static-HTML-only retailers. |

Spiders never know which backend ran them. Backend choice is a deploy-time decision.

### Polite scraping

- 1.5 s minimum delay between requests within a Fetcher instance.
- `User-Agent` identifies the project + contact email (currently a placeholder; update before any serious scraping).
- Parallelism is across countries (different domains), never within (one domain at a time).
- All scraped HTML is archived locally for reproducibility.

### Parallelism model

`scraper.refresh run --parallel N` (default 5):

```
main thread:
  fetch ECB rates once
  start scrape_run row
  spawn N worker threads via ThreadPoolExecutor
  each worker: one country, sequential products
  main collects results, prints final table
```

Each worker owns its own:
- SQLite connection (writes serialized by WAL mode)
- `Fetcher` (and therefore its own Playwright Chromium)
- Spider instance

This respects per-domain rate limits naturally — DM Germany and DM Slovakia are different servers, so concurrent hits across countries are spread across infrastructure.

### Sample data

For demo and development without burning Jina credits or running real scrapes, `scripts/seed_sample_prices.py` inserts 76 plausible price rows across the 10 sample products. Sample rows have `url LIKE 'sample://%'` so they're trivial to filter or delete:

```sql
DELETE FROM price WHERE url LIKE 'sample://%';
```

## Web app

### Stack

- **Next.js 15** with App Router
- **React 19** (server components by default)
- **Tailwind CSS 3** for styling
- **Inter** font via `next/font/google`
- **react-simple-maps** + `d3-scale-chromatic` for the EU choropleth
- **Recharts** for bar/line charts

### Data access

`web/lib/db.ts` reads JSON from `web/data/` and caches per-file by mtime. When `scripts/export_for_web.py` rewrites a JSON file, the next request picks up the change automatically (no dev-server restart).

### Routes

| Route | Component | Description |
|---|---|---|
| `/` | server | Hero + headline-finding card (top labor-time gap) + **basket-aggregate callout** + product grid sorted by `unfairness_score` |
| `/basket` | server | **Universal basket** (intersection of products in every country) + **pairwise basket** picker. Per-country bars, composition grid, construction-rules recap. |
| `/compare` | server | Wage-time-gap leaderboard ranked by `minutes_ratio` |
| `/map` | server + `MapClient` (client) | Interactive choropleth with product + metric pickers (nominal EUR / ex-VAT / minutes-of-work) |
| `/product/[id]` | server | Wage-time gap panel, EUR/minutes-of-work charts, sources table, **"Cite this finding"** block + social-share buttons |
| `/about` | server | Mission, methodology summary, fair-comparison bullets, press kit, sample citation |
| `/api/products` | server route | JSON API mirror of `v_latest_prices` |

Each `page.tsx` route has a co-located `opengraph-image.tsx` that renders a dynamic 1200×630 PNG via Next.js `next/og` (Satori). Sharing a product or basket URL on social previews with the wage-time number, not a generic logo.

### Pure-function library

`web/lib/findings.ts` holds the shared aggregation logic — used by `/`, `/basket`, `/compare`, and `/product/[id]`:

| Function | Returns | Purpose |
|---|---|---|
| `buildFindings(rows)` | `Finding[]` | One per product with cheapest/dearest in both EUR + minutes, `unfairness_score`, sorted worst-first |
| `headlineSentence(finding)` | `string \| null` | "14 min in SK vs 5 min in DE — 2.8× the labor time" |
| `buildUniversalBasket(rows, version="v1")` | `Basket \| null` | Intersection of products observed in every country; identical SKU set everywhere |
| `buildPairwiseBasket(rows, a, b)` | `Basket \| null` | Intersection of products observed in both A and B; bigger sample, single-pair scope |
| `basketHeadlineSentence(basket)` | `string \| null` | "The 6-item universal basket costs 17 min of work in DE vs 89 min in BG — 5.2× the labor time" |

All pure: take `LatestPriceRow[]`, return computed objects. No DB access, no side effects. The same data feeds the homepage, the basket page, and the per-product OG card.

### Components

| Component | Type | Purpose |
|---|---|---|
| `EuropeMap` | client | Choropleth with hover tooltip + click-to-pin |
| `MapClient` | client | Picker + map state owner |
| `NavLink` | client | Nav pill with active-route state |
| `PriceBarChart` | client | EUR (incl + ex-VAT) per country |
| `MinutesOfWorkChart` | client | Labor-time bars colored by value |
| `PriceHistoryChart` | client | Time series, multi-line by country |

## Adding things

### A new product

1. Append a row to `data/products.csv`.
2. `python -m scraper.refresh init-db` — sync into the `product` table.
3. `python scripts/capture_missing_eans.py` — bootstrap EAN + image + canonical_url from DM Germany. Products that fail to match here are dropped (no EAN = no entry).
4. `python -m scraper.refresh run --shop dm` — scrape across all countries under the strict EAN-or-SKU matcher.
5. `python scripts/audit_pack_quality.py` — confirm 0 CATEGORY / MULTI / SIZE / EAN_DIFF flags.
6. `python scripts/localize_images.py` — pull any new remote image URLs to `web/public/images/`.
7. `python scripts/export_for_web.py` — refresh the web JSON.

### A new shop

1. Write a SQL migration in `db/migrations/` that inserts into `shop` and `shop_country`.
2. Create `scraper/spiders/<name>.py` subclassing `Spider`.
3. Implement `scrape(spec, sc) -> ScrapedPrice | None`. Look at `dm.py` for a reference.
4. Register the class in `SPIDER_REGISTRY` in `scraper/refresh.py`.
5. `python -m scraper.refresh init-db` to apply the migration.

The orchestrator handles FX, VAT, persistence, logging — spiders just observe.

### A new country (for an existing shop)

One-line migration:

```sql
INSERT INTO shop_country (shop_id, country_code, base_url, active)
VALUES ((SELECT id FROM shop WHERE code='dm'), 'XY', 'https://...', 1);
```

Make sure the country row already exists in `country` (with VAT and currency).

## Migrations

Migrations live under `db/migrations/NNN_description.sql` and run after `db/schema.sql` in `init_db()`. SQLite's `PRAGMA user_version` is used as the cursor — each filename's `NNN` prefix becomes the version number, and migrations with version > current are applied in order. This makes non-idempotent DDL (e.g. `ALTER TABLE ADD COLUMN`) safe across repeated `init-db` runs.

Current migrations:

| # | File | Purpose |
|---|---|---|
| 001 | `001_seed_countries_and_shops.sql` | Initial country/VAT/wage/shop_country seeds |
| 002 | `002_seed_italy_tigota.sql` | Adds Tigotà and Italy row |
| 003 | `003_price_scraped_ean.sql` | Adds `price.scraped_ean` + refreshes `v_latest_prices` view |

## Future work

See [docs/ROADMAP.md](ROADMAP.md) for the full prioritized list with sequencing rationale. Headlines:

- **Müller** as a second pan-EU drugstore (Italy + Switzerland coverage) — unlocks cross-retailer EAN verification (the single biggest gap remaining in the methodology).
- **Open Beauty Facts EAN reconciliation** — external check on retailer-claimed `gtin13` values.
- **Tigotà** proper spider (Italy) — independent IT data alongside Müller-IT.
- **Scheduled weekly scrape + drift detection** — catch SKU rotations and EAN mismatches automatically.
- **Eurostat PLI overlay on `/map`** — fourth metric for triangulation against official price-level data.
- **Per-row `match_method` enum** (`ean | sku | name | manual`) for explicit per-row filtering in published statistics.
- **Multilingual UI** (DE/SK/IT) — let the case study reach non-English audiences in the affected markets.

Done:
- ✅ Strict EAN-or-DM-SKU matcher.
- ✅ `scraped_ean` audit trail per row + 5-class audit pipeline.
- ✅ Bidirectional pack-guard (multi-pack / unit-category / ±15 % size).
- ✅ Migration tracker (`PRAGMA user_version`).
- ✅ Open Graph cards (default, per-product, per-basket).
- ✅ Universal + pairwise basket aggregates.
- ✅ "Cite this finding" + social-share buttons on each product.
