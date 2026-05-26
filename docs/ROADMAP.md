# EUPRICE — Roadmap

> See also: [README](../README.md) · [Methodology](METHODOLOGY.md) · [Architecture](ARCHITECTURE.md) · [Changelog](../CHANGELOG.md)

What's done, what's next, and the rationale for the sequencing. This document is the long-term work queue; the [CHANGELOG](../CHANGELOG.md) records what has already shipped.

---

## Phase 0 — Foundation (✅ done)

Single retailer (DM), strict identity matching, audited dataset, fairness-focused web app.

| Item | Status |
|---|---|
| Strict EAN-or-DM-SKU matcher in the spider | ✅ |
| Pack-guard (multi-pack / unit-category / size ±15 %) | ✅ |
| `price.scraped_ean` audit trail (migration 003) | ✅ |
| 5-class audit pipeline (`audit_pack_quality.py`) | ✅ |
| `init-db` migration tracker via `PRAGMA user_version` | ✅ |
| 29 cross-EU products, 236 verified rows, 10 EU countries | ✅ |
| Open Graph dynamic cards (default, per-product, per-basket) | ✅ |
| "Cite this finding" block + social-share buttons | ✅ |
| Universal + pairwise basket aggregates with apples-to-apples rigor | ✅ |
| Mission-framed homepage with sortable unfairness ranking | ✅ |
| External EAN reconciliation against Open Beauty Facts (Phase B.1) | ✅ |
| `data_quality_log` table (migration 004) | ✅ |

**Current data quality bar held since this phase:** zero EAN_DIFF / CATEGORY / MULTI / SIZE flags on every audit since the strict matcher landed. Every EAN that OBF has data for agrees with our DB (0 disagreements on 4 confirmed; remaining 25 are not catalogued by OBF — see /about).

---

## Phase A — Cross-retailer verification (next, highest priority)

**Why this is the next phase, not "add 100 more products."** Right now the dataset's identity claim depends on DM's own JSON-LD `gtin13`. If DM mis-labels a barcode in one country (it happens — retailers reuse SKU IDs and recycle EANs), no automated check would catch it. A second pan-EU drugstore observing the same EAN at similar prices in a shared country (DE, AT, HU, CZ, PL) is the cleanest possible verification — and it doubles cross-country coverage for free.

### A.1 — Müller spider

- **Coverage**: DE, AT, CH, HU, SI, HR, CZ, **IT** (8 countries). The IT addition is the originally-motivating case-study angle.
- **Switzerland** is a high-wage non-EU comparator that strengthens the wage-time framing.
- Müller's product detail pages expose JSON-LD with `gtin13` and use a stable cross-country `/c/<id>/p` URL pattern — same playbook as DM.
- Expected to bot-defend more aggressively than DM. Mitigation: 3 s throttle per domain, polite UA, fall back to Jina Reader on a per-country basis (`Fetcher` already wires both backends).
- Acceptance check after build: every product in our catalog observed at both DM-DE and Müller-DE must have a matching EAN. If they ever disagree, that's a finding worth investigating.

### A.2 — Rossmann spider

- **Coverage**: DE, PL, HU, CZ, AT (5 countries). Strongest add for Poland depth.
- Same pattern as DM / Müller.
- After Rossmann lands, DE/AT/HU/CZ/PL have three independent retailer witnesses → within-country chain spread becomes a separate research question (does product X cost more at Rossmann-PL than at DM-PL?).

### A.3 — Tigotà spider (Italy)

- Already scaffolded in `scraper/spiders/tigota.py`. Finish the implementation.
- IT-only, but pairs with Müller-IT to give two independent IT data sources for the IT↔SK case-study angle.

**Deliverable for Phase A:** 4 retailers, ≥12 EU countries (10 DM + IT via Müller/Tigotà + CH via Müller), each product eligible for up to ~18 country-retailer cells.

---

## Phase B — External identity verification (≥1 month)

Today: every row is identity-verified by **the retailer's own claim**. Adding an external check turns "very confident" into "audit-proof."

### B.1 — Open Beauty Facts EAN reconciliation (✅ done)

- `scripts/verify_eans_against_obf.py` queries the OBF API for every `product.ean` in our DB; writes results to `data_quality_log` (migration 004).
- Surface on `/about`: 4 confirmed (brand + size agree) · 4 stubs (EAN known, no metadata) · 21 not in OBF · **0 disagreements**.
- Per-product OBF status pill on `/product/[id]` links to the methodology block.
- Honest disclosure on the page: OBF's coverage of private-label drugstore SKUs (Balea / Babylove / Dontodent / Ebelin) is thin; the cross-retailer check (Phase A.1) is the broader verification path.
- **Re-run schedule:** weekly cron (Phase C.2) will rerun and surface drift in `data_quality_log`.

### B.2 — GS1 GTIN verification (stretch goal)

- GS1's own GEPIR (Global Electronic Party Information Register) is the authoritative source for EAN-13 assignments.
- Free for a small number of lookups; would let us verify the *brand owner* matches the producer we expect.
- Requires GS1 account and likely some manual lookups.

---

## Phase C — Coverage hardening (≥2 weeks)

### C.1 — Manual EAN lookup for failed bootstraps

A handful of essential SKUs failed the text-search bootstrap on DM Germany because DM's search returns multi-pack variants first (which the pack-guard correctly rejects). Today these are simply absent from the dataset:

- Pampers Premium Protection (various sizes)
- Pampers Baby-Dry (various sizes)
- Pampers Sensitive Wipes
- Soft & Sicher Toilettenpapier 4-lagig
- Soft & Sicher Küchentücher (paper towels)
- Profissimo Spülmittel (dish soap)
- Zewa Plus Toilettenpapier
- HiPP Combiotik 2 Folgemilch (DACH-only — actually a real finding)

Workflow: query OBF or GS1 for the EAN by brand/product-name, paste it into `data/products.csv` directly, then re-scrape. This unlocks the categories the bootstrap couldn't reach (especially paper goods and Pampers — both heavily covered in EU consumer-price policy debates).

### C.2 — Scheduled weekly scrape + drift detection

- GitHub Actions cron: one shop per night across 5 nights.
- New `scripts/diff_scrape_runs.py`: compare the last two `scrape_run` records, flag rows where:
  - the URL changed (SKU rotation)
  - the EAN changed (identity drift)
  - the price moved more than 20 % week-on-week (potential mis-match)
- Drift report goes to a `data_quality_log` table and a weekly digest is pushed to the README's "Status" section automatically.

### C.3 — Wage and VAT refresh automation

- Eurostat publishes `earn_ses_hourly` every ~4 years and `prc_ppp_ind` annually.
- New `scripts/refresh_eurostat.py`: pull the latest available values quarterly, update the `country` table.
- VAT rates: store the publication date alongside each rate so we can detect when a country changes its rate.

---

## Phase D — Web app polish (≥1 week)

### D.1 — Eurostat PLI overlay on `/map`

- The `eurostat_pli` table is populated but not yet rendered.
- Add a fourth metric option ("Price Level Index, EU27 = 100") to the map's metric picker.
- Lets visitors triangulate our scraped findings against official Eurostat numbers.

### D.2 — Per-row `match_method` enum

- New column on `price`: `match_method TEXT NOT NULL` with values `ean`, `sku`, `name`, `manual`.
- Lets published statistics filter by acceptance criterion: a stricter view that excludes `sku`-only matches, for example.
- Today, the criterion is inferrable by comparing `price.scraped_ean` to `product.ean`, but explicit is better.

### D.3 — Multilingual UI

- DE / SK / IT — the three markets that show up most often in the headline findings.
- Next.js App Router supports `i18n` natively.
- The product names already have English (`product_name_en`); we'd add German, Slovak, and Italian.

### D.4 — "Press kit" page

- Pre-rendered downloadable PDF with the top 10 findings, sample citations, and infographics.
- Two-page format suitable for journalist quick reference.

---

## Phase E — Beyond drugstores (long-term, only after A–D)

EUPRICE's strict-matching playbook generalizes to any category where:

1. Same retailer operates across multiple EU countries with a unified online catalog.
2. Product pages expose JSON-LD with `gtin13`.
3. Identical SKUs are stocked widely (i.e. branded, not private-label-only).

Candidate categories:

- **Branded supermarket groceries** (Kaufland operates in 8 EU countries with a unified catalog; Coca-Cola, Barilla, Lavazza are pan-EU SKUs).
- **Pet food** (Royal Canin, Whiskas — pan-EU brands with stable EANs).
- **OTC medicines in countries that permit drugstore sales** (Germany, Austria).

These would be **separate sub-projects with their own retailer set and quality bar** — not bolted onto the drugstore dataset. The drugstore project's value is its narrow, defensible scope.

---

## Hard "no" list

To preserve the methodological bar, certain expansions stay deliberately off the roadmap:

- **No Amazon / marketplace prices** — sellers and prices vary by region; not the retailer's price.
- **No private-label cross-retailer comparison** — DM's `Balea` ≠ Müller's `Aveo`. Different SKUs entirely. Only within-retailer cross-country for private labels.
- **No fuzzy EAN matching** — JSON-LD `gtin13` is the source of truth. The retailer-internal SKU equivalence is a DM-specific structural feature, not a substitute for EAN equality.
- **No Mercadona / Lidl / Aldi until they unblock their online catalogs.** Mercadona doesn't publish online prices in most regions; Lidl's online catalog is a marketing leaflet. Engineering effort better spent elsewhere.
- **No imputation of missing prices.** If a country lacks an SKU, the cell stays empty in both the per-product view and the basket aggregate.
