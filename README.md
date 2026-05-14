# EUPRICE

> Cross-EU consumer price comparison, anchored on the *minutes-of-median-wage* metric.

EUPRICE collects real shelf prices for identical SKUs (verified by EAN-13 barcode) across EU countries and reports the consumer cost in three forms: nominal EUR, VAT-exclusive EUR, and minutes of work at the country's median hourly wage. The last metric is the project's case-study headline: it converts an abstract price spread into the labor reality consumers in low-wage countries actually face.

**Why this exists.** During EU travel, the project's originator noticed that identical drugstore products can cost 40 %+ more in lower-income countries than in their higher-income neighbours. EUPRICE turns that anecdote into a defensible dataset suitable for case-study work on territorial supply constraints (TSCs) at the EU policy level.

## Status

- **29 products tracked**, all with verified EAN-13 codes, all with canonical retailer URLs, all with product images
- **239 real cross-EU price observations** captured via Playwright scrapes of DM's 10 country sites — zero sample data, every row links to the actual retailer product page
- Per-country coverage (real product pages scraped, of 29):
  DE 29 · AT 28 · SI 25 · BG 24 · HR 24 · HU 24 · SK 24 · CZ 22 · RO 22 · PL 17
- Country median wages and VAT rates seeded for all 10 countries
- Italian retailer (Tigotà) scaffolded for IT↔SK comparison
- Both rendering backends wired: Playwright (default, free) and Jina Reader (paid alt)

**EAN is the prerequisite**: products without a verified EAN-13 don't enter the database. This is enforced by the scraper pipeline — every product passes through an EAN-capture step on DM Germany before cross-country scraping begins. Cross-country matching is then EAN-keyed, making it immune to local-language naming variants ("Mizellenwasser" → "Micelárna voda" → "Micelarni voda" etc., all the same EAN, all linked to their real country-specific product page).

The web app at `http://localhost:3000` renders a product grid, an interactive EU choropleth, a spread leaderboard, and per-product breakdowns with the minutes-of-work chart.

## Documentation

For the rigorous version of how this works:

- **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)** — research question, data sources, normalization, citation guidance. Read this first if you intend to publish findings.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — codebase tour, data model, scraper layering, how to add a shop or country.

External references used in this project:

- [European Central Bank — daily euro reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)
- [Eurostat `earn_ses_hourly`](https://ec.europa.eu/eurostat/databrowser/view/earn_ses_hourly/) — Structure of Earnings Survey (median hourly earnings)
- [Eurostat `prc_ppp_ind`](https://ec.europa.eu/eurostat/databrowser/view/prc_ppp_ind/) — Price Level Indices
- [GS1 EAN-13](https://www.gs1.org/standards/barcodes/ean-upc) — canonical product-barcode standard
- [Open Beauty Facts](https://world.openbeautyfacts.org) — community product database (CC BY-SA), used for image enrichment
- [Playwright](https://playwright.dev/python/) — rendering backend (default)
- [Jina Reader](https://jina.ai/reader/) — optional alternative rendering backend

## Quick start

### Prerequisites

- Python 3.11 or newer
- Node.js 20 or newer
- ~500 MB free disk for the bundled Chromium

### 1. Python scraper

```powershell
cd C:\CLAUDE\EUPRICE
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e .
python -m playwright install chromium
```

### 2. Initialize the database

```powershell
python -m scraper.refresh init-db
```

Applies `db/schema.sql`, seeds 10 countries (with VAT + median wage) and the DM shop, then loads `data/products.csv` into the `product` table.

### 3. Rendering backend (optional config)

By default the scraper uses local Chromium via Playwright (free). If you prefer Jina:

```powershell
Copy-Item .env.example .env
# edit .env:
#   EUPRICE_RENDER=jina
#   JINA_API_KEY=<your key from https://jina.ai/?sui=apikey>
```

Verify with `python -m scraper.refresh test-jina https://www.dm.at`. Stick with the default Playwright unless you have a reason.

### 4. Run a scrape

```powershell
# all 10 DM countries, 5 in parallel (default)
python -m scraper.refresh run --shop dm

# a subset
python -m scraper.refresh run --shop dm --countries DE,AT,SK

# smoke test
python -m scraper.refresh run --shop dm --countries DE --limit 2
```

Each run takes ~3-4 minutes for the full 10×10 matrix in parallel mode. Strict sequential is available via `--parallel 1`.

### 5. Refresh the web data and start the dev server

```powershell
python scripts/export_for_web.py
cd web
npm install
npm run dev
```

Open <http://localhost:3000>.

## Without scraping — load demo data instead

If you want to see the web app immediately without spending any time scraping:

```powershell
python -m scraper.refresh init-db
python scripts/seed_sample_prices.py     # 76 plausible rows, marked with sample:// URLs
python scripts/enrich_images.py          # download product images from Open Beauty Facts
python scripts/export_for_web.py
cd web && npm install && npm run dev
```

This produces a fully populated UI in a few minutes, with no retailer scraping. Sample rows are clearly flagged in the source table and can be deleted with `DELETE FROM price WHERE url LIKE 'sample://%';`.

## Project layout

```
data/products.csv           — what you maintain (10-row CSV)
db/                          — schema + migrations + SQLite file
docs/                        — METHODOLOGY + ARCHITECTURE
scraper/                     — Python: spiders, fetcher, CLI
scripts/                     — one-off tools (seed, enrich, export)
web/                         — Next.js app
```

## Adding a product

Append a row to [data/products.csv](data/products.csv):

| column | example | required |
|---|---|---|
| `producer` | Balea | yes |
| `name` | Mizellenwasser 3in1 Rose | yes — canonical (often anchor-country / German) name |
| `name_en` | Micellar Water 3-in-1 Rose | optional — English name; preferred in the web UI when set |
| `size_value` | 400 | yes |
| `size_unit` | ml | yes (`ml`, `l`, `g`, `kg`, `piece`) |
| `category` | drugstore | yes |
| `subcategory` | micellar_water | optional |
| `search_hint` | balea mizellenwasser rose | yes (query for shop search) |
| `ean` |  | optional — scraper fills this in from JSON-LD |
| `canonical_url` |  | optional — scraper fills this in from the matched product page |
| `notes` |  | optional |

Then re-run `python -m scraper.refresh init-db` followed by `run` and `export_for_web.py`.

## Adding a shop

See the [Architecture guide](docs/ARCHITECTURE.md#adding-things). Briefly: add a SQL migration that inserts into `shop` and `shop_country`, create a new file under `scraper/spiders/`, register it in `SPIDER_REGISTRY` in `scraper/refresh.py`.

## What you don't need

- Visual Studio Build Tools — the web side avoids native modules.
- A Jina API key — Playwright covers the same ground for free.
- A separate database server — SQLite is the storage, in one file.

## Notes

- `.env.example` is held out of git when it contains a real API key. Re-add it as a template (empty values) if you publish.
- `data/snapshots/` (archived scraped HTML) and `db/eu_prices.db` are gitignored. The DB is regenerable from migrations + scrape runs; snapshots are nice-to-have for reproducibility but recoverable on next scrape.
- Online catalog prices ≠ in-store prices in some chains. The METHODOLOGY document elaborates.

## License

Code: MIT (see [LICENSE](LICENSE) once added).
Data scraped from retailers is theirs; redistribute thoughtfully.
Eurostat data is CC BY 4.0; cite as `Source: Eurostat (<dataset_code>)`.
