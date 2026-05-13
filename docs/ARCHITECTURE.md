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
       raw_html_sha256, raw_html_path)

eurostat_pli (country_code PK, year PK, category_code PK, category_label, value)

scrape_run (id PK, started_at, finished_at, shop_code, countries,
            products_total, products_ok, products_promo, products_no_match,
            products_error)
scrape_attempt (id PK, run_id, product_id, country_code, started_at,
                status, error_class, error_msg, price_id)

v_latest_prices (view) — latest price per (product, shop, country)
                         with derived ex_VAT, minutes_of_work, discount_pct
```

The `price` table is append-only: every scrape adds rows. History accumulates automatically. The `v_latest_prices` view returns the most recent row per (product, shop, country).

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
| `/` | server | Hero + product grid with images, prices, spreads |
| `/map` | server + `MapClient` (client) | Interactive choropleth with product + metric pickers |
| `/compare` | server | Leaderboard sorted by EUR spread with inline bars |
| `/product/[id]` | server | Full breakdown: stats, bar charts, sources table |
| `/about` | server | Methodology summary, links to docs |
| `/api/products` | server route | JSON API mirror of `v_latest_prices` |

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
3. `python -m scraper.refresh run --shop dm --countries DE` — capture EAN via DM Germany.
4. `python -m scraper.refresh run --shop dm` — scrape across all countries by EAN.
5. `python scripts/export_for_web.py` — refresh the web JSON.

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

## Future work

- Add Tigotà spider proper (Italy) — main missing piece for IT↔SK case study.
- Render Eurostat PLI on the map as a fourth metric (triangulation overlay).
- Per-row `match_method` enum (`ean | sku | name | manual`) for confidence filtering in published statistics.
- robots.txt automation — store an `allowed` flag per `shop_country`.
- Per-snapshot read-through cache — re-use archived HTML for development scrapes instead of re-fetching.
