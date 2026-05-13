# EUPRICE

Web app and case study comparing prices of everyday consumer items (drugstore, food, household) across EU countries. Real prices, real product URLs, scraped from retailer websites.

**Motivation.** Identical SKUs can be 40 %+ more expensive in lower-income EU countries than in higher-income ones — a real burden that aggregated indices (HICP, PLIs) don't surface at product level. EUPRICE collects the granular data that lets you point at one specific bottle of micellar water and ask: *why does this cost €2.45 in Vienna and €3.40 in Bratislava?*

## What you maintain

One file: [`data/products.csv`](data/products.csv).

| column | example | required |
|---|---|---|
| `producer` | Balea | yes |
| `name` | Mizellenwasser sensitive | yes |
| `size_value` | 400 | yes |
| `size_unit` | ml | yes — one of `ml`, `l`, `g`, `kg`, `piece` |
| `category` | drugstore | yes |
| `subcategory` | micellar_water | optional, free-form |
| `search_hint` | balea mizellenwasser sensitive | yes — query string for the shop's site search |
| `ean` | 4010355532688 | optional — scraper fills this in on first successful scrape |
| `notes` |  | optional |

Add a row → re-run the scraper → it appears in the database. Countries and shops are seeded in DB migrations; you don't need to touch them.

## Architecture

```
EUPRICE/
├── data/
│   └── products.csv               source of truth for what to track
├── db/
│   ├── schema.sql                 5 tables + 1 view
│   ├── migrations/                seed countries + shops
│   └── eu_prices.db               (gitignored)
├── scraper/                       Python
│   ├── core/                      fetch, db, fx, normalize, models
│   ├── spiders/                   one module per shop (currently: dm)
│   ├── refresh.py                 CLI entry
│   └── pyproject.toml
└── web/                           Next.js (deferred — backend-first)
```

### Data model

```
country       (code PK, name, currency_code, vat_standard_rate, vat_food_rate)
producer      (id PK, name)
shop          (id PK, code, name)
shop_country  (shop_id, country_code, base_url)        -- "DM operates here"
product       (id PK, ean, producer_id, name, size_value, size_unit,
               category, subcategory, search_hint)
price         (id PK, product_id, shop_id, country_code, parsed_at, url,
               product_name_local, price_local, currency_code,
               price_eur, fx_rate)
v_latest_prices                                        -- view: latest snapshot per (product, shop, country)
```

`price` is append-only: every scrape adds rows, history accumulates automatically. Ex-VAT prices are derived in the view, not stored.

### Coverage

DM Drogerie Markt across 10 countries: DE, AT, SK, CZ, HU, PL, SI, HR, RO, BG. See [`db/migrations/001_seed_countries_and_shops.sql`](db/migrations/001_seed_countries_and_shops.sql).

> ⚠️ DM does not operate in Italy. The original IT↔SK comparison from the motivating anecdote will require a second spider for an Italian retailer (Tigotà, Lloyds Farmacia, etc.) matched by EAN.

## Setup

### 1. Python scraper

```powershell
cd C:\CLAUDE\EUPRICE
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e scraper
```

### 1b. Choose a rendering backend

`httpx` handles plain server-rendered pages directly. For SPAs like DM that hydrate via JavaScript, the scraper falls back to one of two backends. Pick at runtime via `EUPRICE_RENDER` in your `.env`:

| Value | Cost | Setup | When to use |
|---|---|---|---|
| **`playwright`** (default) | free | one-time Chromium install | recommended for research/case-study work |
| **`jina`** | ~$5/mo at our scale | API key only, no local install | when Playwright gets fingerprinted or you can't install Chromium |
| **`disabled`** | free | nothing | static-HTML retailers only (skips JS-rendered pages) |

**Playwright path (recommended)**:

```powershell
python -m playwright install chromium      # ~500 MB, one-time
# in .env:  EUPRICE_RENDER=playwright
```

**Jina path** (no local browser):

```powershell
cp .env.example .env
# edit .env:  EUPRICE_RENDER=jina
#             JINA_API_KEY=<your key from https://jina.ai/?sui=apikey>
```

Sanity-check Jina specifically:

```powershell
python -m scraper.refresh test-jina https://www.dm.at
# expected: "Jina OK  status=200  bytes=...."
```

You can switch backends without restarting anything else — the spiders are backend-agnostic.

### 2. Initialize the DB

```powershell
python -m scraper.refresh init-db
```

Applies the schema + the migration that seeds 10 countries and the DM shop, then loads `data/products.csv` into the `product` table.

To verify without installing anything (stdlib only):

```powershell
python scripts/verify_schema.py
```

### 3. Run the scraper

```powershell
# Slovakia + Austria + Germany, all products in the CSV
python -m scraper.refresh run --shop dm --countries SK,AT,DE

# Everywhere DM operates
python -m scraper.refresh run --shop dm

# Smoke test
python -m scraper.refresh run --shop dm --countries SK,AT --limit 2
```

Each run prints a per-(country × product) result table and appends rows to `price`. FX rates are fetched once per run from the ECB daily feed.

## Adding a new shop

1. Add a SQL migration in `db/migrations/` inserting into `shop` and `shop_country`.
2. Create `scraper/spiders/<shop>.py` subclassing `Spider`, implementing `scrape(product, sc) -> ScrapedPrice | None`.
3. Register it in `SPIDER_REGISTRY` in `scraper/refresh.py`.

All EUR conversion, VAT stripping, and DB writes are handled by the orchestrator — spiders are pure scrapers.

## Methodology notes (for the case study)

- **Shelf price vs ex-VAT.** Every snapshot stores the shelf price (incl. VAT, what consumers pay); the view derives the ex-VAT price. The case-study headline chart should show both — the gap between them is the VAT-policy contribution; the ex-VAT spread is the genuine territorial-pricing question.
- **Triangulation.** Cross-check directional findings against Eurostat Price Level Indices (HICP) so the methodology is defensible at EU level.
- **Caveat.** Online catalog prices ≠ in-store prices in some chains. Document this in the case study.

## Note on the web app

There is a Next.js scaffold under `web/`, written before this backend redesign. Its `lib/db.ts` references the old schema (`v_latest_prices` columns named `brand`, `retailer_*`, cent-based prices). It needs an update to match the new view shape — deferred until the scraper is verified end-to-end.
