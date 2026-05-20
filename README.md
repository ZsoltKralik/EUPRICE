# EUPRICE

> Same product. Different price. Different worktime. — EU consumer price fairness, documented.

## Mission

EUPRICE documents EU consumer price unfairness in the drugstore category. We track the **same physical SKU** — identical EAN-13 barcode, identical pack size, identical retailer group — across EU member states and report the consumer cost in three forms: nominal EUR, VAT-exclusive EUR, and **minutes of median-wage work**. The labor-time view is the project's headline because that is what consumers in lower-wage member states actually experience: not "a few cents more," but a substantially larger share of their working day spent on the same household basics.

This is directly relevant to **European Commission policy on territorial supply constraints (TSCs)**: contractual or de-facto restrictions that allow manufacturers to price-discriminate across the single market. EUPRICE provides the kind of product-level, identity-verified evidence that case-study work and policy submissions need — and is built to be quotable: every finding has a stable URL, an Open Graph share card, an attached citation block, and a downloadable JSON record.

**Why this exists.** During EU travel, the project's originator noticed that identical drugstore products can cost 40 %+ more in lower-income countries than in their higher-income neighbours, and *much* more once you measure the price in the worktime of the consumer who actually pays it. EUPRICE turns that anecdote into a defensible dataset.

## Status

- **29 cross-EU products tracked** across drugstore essentials (22), baby essentials (3), and feminine hygiene (4). Every product has observations in **≥5 EU countries** (every product in the public set genuinely compares cross-EU); DACH-only products are excluded.
- All 29 have verified EAN-13 codes, real product images, and canonical retailer URLs
- **236 real cross-EU price observations** captured via Playwright scrapes of DM's 10 country sites — zero sample data, every row links to the actual retailer product page and stores the JSON-LD EAN that page exposed at scrape time
- **6 products with FULL 10-country coverage** (every DM country observed): Balea Deo Roll-On Sensitive, Ebelin Wattepads, Ebelin Wattestäbchen Recycling, dontodent PRO+ Zahnpasta, dontodent Zahnbürste Soft Protect, dontodent Mundspülung Total Power
- Per-country coverage (of 29 products):
  DE 28 · SK 28 · AT 27 · SI 26 · CZ 24 · HR 24 · HU 23 · BG 21 · RO 21 · PL 14

### Headline findings (current scrape — top 15 by labor-time ratio)

Same physical SKU, identical EAN-13, same retailer (DM). The "worktime" column is the price expressed as minutes of work at each country's median hourly wage (Eurostat `earn_ses_hourly`).

| Product | Cheapest worktime | Most worktime | Ratio | Countries |
|---|---|---|---|---|
| Balea Mizellenwasser 3-in-1 Rose (400 ml) | 4 min (DE) | 36 min (BG) | **9.0×** | 9 |
| dontodent Mundspülung Total Power (500 ml) | 2 min (DE) | 17 min (BG) | **7.2×** | 10 |
| alverde Feuchtigkeitsshampoo (200 ml) | 4 min (DE) | 25 min (BG) | **6.9×** | 9 |
| Ebelin Wattestäbchen Recycling (200 pcs cotton swabs) | 3 min (DE) | 18 min (BG) | **6.9×** | 10 |
| Balea Duschgel Glücksmoment (300 ml shower gel) | 2 min (DE) | 10 min (BG) | **6.5×** | 9 |
| Balea Cremedusche Sensitive (300 ml shower gel) | 2 min (DE) | 10 min (BG) | **6.5×** | 7 |
| Balea Deo Roll-On Sensitive (50 ml) | 2 min (DE) | 10 min (RO) | **6.1×** | 10 |
| alverde Naturkosmetik Duschgel (250 ml) | 3 min (DE) | 17 min (BG) | **6.0×** | 6 |
| Balea Bodybalsam Sensitive (400 ml body lotion) | 3 min (DE) | 20 min (BG) | **6.0×** | 8 |
| Jessa Tampons Cotton Super (16 pcs) | 5 min (DE) | 31 min (BG) | **5.8×** | 8 |
| Jessa Slipeinlagen Cotton Normal (40 panty liners) | 4 min (DE) | 20 min (BG) | **5.4×** | 8 |
| Balea Lippenpflege Lemon Cake (4.8 g lip balm) | 2 min (DE) | 9 min (BG) | **5.3×** | 7 |
| Ebelin Wattepads (70 pcs cotton pads) | 2 min (DE) | 9 min (BG) | **5.2×** | 10 |
| dontodent Zahnbürste Soft Protect (toothbrush) | 2 min (DE) | 12 min (BG) | **5.2×** | 10 |
| Nivea Creme (150 ml) | 8 min (DE) | 40 min (BG) | **5.2×** | 9 |

**Pattern.** Bulgaria dominates the most-worktime column with 13 of the 15 worst gaps; Germany dominates the cheapest-worktime column. The same physical bottle of mouthwash that a German buys in 2 minutes of work costs a Bulgarian 17 minutes — for an identical EAN-13 SKU at the same retailer (DM), no exception, no fuzzy matching.

**The babylove diaper case (#43) is the most consequential for ongoing household burden** — diapers are recurring (8–10 packs/month for an infant), so the 5.0× wage-time gap compounds into roughly 25 extra hours/year of work for a Bulgarian parent vs a German parent on identical product. With 9 countries observed, the diaper finding is robust to single-country anomalies.

**The Jessa feminine-hygiene findings (#67 Tampons Cotton Super: 5.8×, #66 Slipeinlagen: 5.4×)** introduce a parallel argument — essential, non-substitutable, recurring purchases punish women in lower-wage member states most heavily.

### The basket aggregate

Per-product findings can be dismissed as anecdotes; the basket aggregate cannot. The **universal basket** is the intersection of products observed in every EU country — currently 6 products (Balea Deo Roll-On Sensitive, Ebelin Wattepads, Ebelin Wattestäbchen Recycling, dontodent PRO+ Zahnpasta, dontodent Zahnbürste Soft Protect, dontodent Mundspülung Total Power). Every country pays for the **identical 6 SKUs**, no imputation, no fuzzy matching.

| Country | Basket EUR (incl VAT) | Basket worktime |
|---|---:|---:|
| 🇩🇪 Germany    | €6.35 | **17 min** |
| 🇦🇹 Austria    | €7.20 | 22 min |
| 🇸🇮 Slovenia   | €8.20 | 38 min |
| 🇨🇿 Czechia    | €8.33 | 45 min |
| 🇭🇷 Croatia    | €7.75 | 46 min |
| 🇵🇱 Poland     | €7.80 | 47 min |
| 🇭🇺 Hungary    | €6.87 | 51 min |
| 🇸🇰 Slovakia   | €8.00 | 53 min |
| 🇷🇴 Romania    | €7.40 | 56 min |
| 🇧🇬 Bulgaria   | €8.91 | **89 min** |

**The same 6 daily essentials cost a German buyer 17 minutes of work and a Bulgarian buyer 89 minutes — 5.2× the labor time for the identical SKUs at the identical retailer.** A pairwise basket picker on `/basket` lets any two countries be compared on their own intersection (typically 13-25 products).

### How we keep the comparison honest

**Strict EAN-or-retailer-SKU matching**: every inserted price row satisfies one of two identity criteria — either (a) the scraped page's JSON-LD `gtin13` equals the seed EAN, OR (b) the scraped URL contains the same DM internal SKU id as the anchor country's URL (DM uses the same `/p/d/<NNNN>/` id across all its country domains for the same physical product, even when local EANs differ). If neither holds, no row is inserted for that country. Missing cells are honest; wrong cells are not.

**Pack-guard rejects wrong-variant SKUs**: even after identity is confirmed, the spider refuses any candidate whose name contains multi-pack markers (`2x...`, `12x80`, `Duopack`, `Jumbopack`, `Big Pack`, `Reisegröße`, etc.), whose unit category disagrees with the seed (volume ↔ weight ↔ piece — catches "200 ml face cream" matched to "100 g soap bar"), or whose parsed total size differs from the seed by more than ±15 %. After a full audit and re-scrape, the dataset has zero residual pack-size, category, or wrong-variant contamination. See [`scripts/audit_pack_quality.py`](scripts/audit_pack_quality.py) — re-run it anytime to verify.

**Audit trail per row**: every `price` row stores the actual `scraped_ean` from the JSON-LD on the matched page (migration 003). The audit script independently re-verifies identity claims by comparing scraped vs canonical EAN per row — so any future regression in the matcher becomes detectable on the next audit run.

**Basket aggregation never imputes** missing prices. The universal basket excludes any SKU that lacks observations in some country; the pairwise basket uses only products observed in both countries of the pair. Sample size is shown next to every total.

### Other infrastructure

- Country median wages and VAT rates seeded for all 10 countries (Eurostat `earn_ses_hourly`, 2026 Q1 VAT publications)
- Italian retailer (Tigotà) scaffolded for IT↔SK comparison (spider implementation pending)
- Both rendering backends wired: Playwright (default, free) and Jina Reader (paid alt)

## The web app (live at `http://localhost:3000`)

| Route | What it shows |
|---|---|
| `/` | Product grid sorted by labor-time unfairness, with the single biggest finding as a hero card |
| `/basket` | **Universal basket** + **pairwise basket** views with apples-to-apples country totals |
| `/compare` | Wage-time-gap leaderboard ranked by `dearest_minutes / cheapest_minutes` |
| `/map` | Interactive EU choropleth; switch metric (nominal EUR / ex-VAT / minutes-of-work) and product |
| `/product/[id]` | Per-product breakdown — wage-time headline panel, per-country charts, sources table, **"Cite this finding"** block, social-share buttons |
| `/about` | Mission, methodology summary, press kit, sample citation, JSON dump link |

Each page has a dynamically-rendered Open Graph card (`/opengraph-image`, `/basket/opengraph-image`, `/product/[id]/opengraph-image`) so social previews display the wage-time number, not a generic logo.

## Documentation

For the rigorous version of how this works:

- **[docs/METHODOLOGY.md](docs/METHODOLOGY.md)** — research question, data sources, normalization, the strict EAN-or-SKU matching rules, the basket aggregate (universal + pairwise) construction rules, citation guidance. Read this first if you intend to publish findings.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — codebase tour, data model, scraper layering, web app structure, how to add a shop or country.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — what's next: Müller as a second retailer (cross-retailer EAN verification), Open Beauty Facts EAN reconciliation, scheduled weekly scrapes with drift detection, multilingual UI.
- **[CHANGELOG.md](CHANGELOG.md)** — public-facing history of dataset growth + matcher hardening + UI evolution.

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
data/products.csv            — canonical product list (29 rows currently); regenerated from DB after EAN bootstrap
data/snapshots/              — archived scraped HTML (SHA-256 keyed; gitignored)
db/schema.sql                — five-table SQLite schema + v_latest_prices view
db/migrations/               — 001 country/VAT/wage seed, 002 Italy/Tigotà, 003 price.scraped_ean
db/eu_prices.db              — the SQLite file (gitignored, regenerable from migrations)
docs/                        — METHODOLOGY, ARCHITECTURE, ROADMAP
scraper/                     — Python: spiders (dm.py), fetcher, FX, CLI orchestrator
scripts/                     — one-off tools:
                                 audit_pack_quality.py (5-class identity audit, CI-friendly)
                                 capture_missing_eans.py (EAN bootstrap on DM Germany)
                                 export_for_web.py (SQLite → web/data/*.json)
                                 localize_images.py (CDN images → /web/public/images/)
                                 rescrape_product.py (one-product targeted re-scrape)
web/app/                     — Next.js App Router pages (/, /basket, /compare, /map, /product/[id], /about)
                                 + dynamic Open Graph image routes
web/lib/findings.ts          — pure functions: buildFindings + buildUniversalBasket + buildPairwiseBasket
web/data/                    — JSON snapshots regenerated by export_for_web.py
web/public/images/<id>.jpg   — localized product images
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
