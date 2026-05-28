# EUPRICE — Changelog

Public-facing history of substantive changes. For day-to-day commits see [git log](https://github.com/ZsoltKralik/EUPRICE/commits/main); this file records the milestones a methodology-conscious reader (researcher, journalist, EU-policy analyst) would care about. Newest first.

The project follows a loose pattern: features are commits; methodology promises are entries here.

---

## 2026-05 — ≥4-country comparison floor + household category

Sharpened what counts as a publishable comparison and grew the catalog with everyday household essentials.

- **≥4 distinct-country floor.** `web/lib/findings.ts` now requires a product to be observed in at least **4 distinct countries** (counting countries, not rows) before it appears in any ranking, the homepage grid, or the compare leaderboard. A product DM only stocks in Germany + Austria (e.g. the Oral-B Pro-Expert toothpaste) is no longer presented as a cross-EU comparison — two-country spreads aren't an EU-fairness story. Below-floor products still render at their own `/product/[id]` URL with an honest amber "limited coverage — not a cross-EU finding" notice.
- **40-SKU catalog, 33 in comparisons.** The 7 branded SKUs DM only sells in DACH stay in the catalog (they're the substrate for cross-retailer verification once Müller branded coverage lands) but are excluded from the rankings.
- **New `household` category** — added DM private-label cleaning products: Denkmit Spülmittel Ultra Pro Climate (dish soap) and Denkmit Allzweckreiniger Frühlingsmoment (all-purpose cleaner, 1 l), both reaching 8 countries. Also added Balea Trockenshampoo and alverde Reinigungsmilch. Comparison set grew 29 → 33; observations 236 → 283.
- **OBF re-run on 40 EANs: 8 confirmed · 4 stub · 28 miss · 0 disagreements.** Fixed a false-positive in `scripts/verify_eans_against_obf.py`: a crowd-sourced OBF `quantity` of "1pcs"/"1 piece" on a product the DB knows is sold by volume/weight is an *uninformative placeholder*, not a genuine size disagreement, and is now logged as `info` when brand + name already confirm the SKU. (This is what flipped Balea Cremedusche Sensitive from warning to confirmed — OBF agreed on brand=Balea, name="Sensitive Cremedusche"; only its quantity field was the placeholder.) The "0 disagreements" claim is preserved on its merits, not by suppressing a real conflict.
- Pack-quality audit: **0 fatal flags** (no EAN / category / multipack / size violations) across all 283 rows.

## 2026-05 — Müller, second pan-EU drugstore (Phase A.1)

The second pan-EU drugstore is now wired in. The strict-matcher rigor previously implemented for DM extends naturally to Müller (DE / AT / CH; HU / SI / CZ / IT seeded but disabled pending JS-rendering work for bot-defended pages).

- **New `scraper/spiders/mueller.py`** — same strict EAN-or-retailer-SKU acceptance as DM, with two Müller-specific adaptations:
  - EAN-13 is extracted from product image filenames (zero-padded 14-digit `_04005900917133_` chunks in `Markant_NN_DetailView_…jpg`), because Müller's JSON-LD `gtin` field carries the internal Markant article id, not the canonical retail EAN. Filtered through GS1 check-digit validity + leading-zero rejection + Markant-id exclusion so the article id can't false-positive as an EAN.
  - Pack size is harvested from the rendered HTML (`Inhalt: <span class="bold">NN unit</span>`) because Müller's JSON-LD `name` omits size. Without this graft into the candidate name, the pack-guard's ±15 % size check would silently accept multi-size variants. The spider also walks sibling `?itemId=NNN` variant links to find the seed size when the default landing variant differs.
- **Migration 005** seeds Switzerland (CH) as a new country (high-wage non-EU comparator: CHF, 8.1 % VAT, median wage from BFS Lohnstrukturerhebung 2022) and the Müller shop with seven country base URLs.
- **`scripts/audit_cross_retailer.py`** — for every product observed at ≥2 retailers in a single country, verifies the scraped EANs agree. Writes results to `data_quality_log`; a disagreement would surface as a `cross_retailer` warning.
- **Web UI** — `Finding.cross_verified` predicate in `web/lib/findings.ts`; cross-verified badge on product cards + per-product page; filter toggle on `/` (`?verified=1`); rollup tile + "0 disagreements" claim on `/about`.

**Honest finding about the catalog overlap.** EUPRICE's current product set is dominated by DM private-label brands (Balea ×8, alverde ×5, babylove ×3, Ebelin ×3, dontodent ×3, Jessa ×3) — 25 of 29 SKUs that, by definition, are sold only by DM. Cross-retailer verification applies only to branded SKUs in shared catalogs (Nivea, Dove). The Müller integration is therefore deliberately scoped to demonstrate the strict-matcher rigor *extends to a second retailer*, even though the bulk of present-day cross-verification coverage will come from future catalog growth into branded products (Phase E in the ROADMAP).

## 2026-05 — External EAN verification via Open Beauty Facts

The first external identity check on the dataset. Until now every identity claim rested on a single source — DM's own JSON-LD `gtin13`. This adds an independent second witness for the EANs that OBF carries.

- New `scripts/verify_eans_against_obf.py` queries the OBF API for every `product.ean` in the DB.
- New `data_quality_log` table (migration 004) records every check as an append-only row; latest-per-source view in `v_data_quality_latest`.
- Per-EAN classification: **confirmed** (OBF brand + size agree with our DB), **stub** (EAN known to OBF but no metadata), **miss** (EAN not in OBF), **warning** (disagreement on brand or size).
- Honest result of the first run on the 29-product catalogue: **4 confirmed · 4 stubs · 21 not in OBF · 0 disagreements.** OBF's coverage of private-label drugstore SKUs (Balea, Babylove, Dontodent, Ebelin) is thin; the cross-retailer check (Müller, Phase A.1) is the broader verification path.
- `/about` page surfaces the rollup with confirmed examples; `/product/[id]` shows a per-product OBF status pill next to the EAN.
- Why "0 disagreements" is the headline: every EAN OBF *does* have data for matches our DB on brand and size. Where OBF agrees, we agree. Where OBF doesn't carry the SKU at all, the dataset remains methodologically open until a second retailer confirms it.

## 2026-05 — Basket aggregate (universal + pairwise)

- New `/basket` page surfaces the cumulative version of the fairness question: how much of a working day does a representative bundle of identity-verified daily essentials cost in each country?
- **Universal basket v1** = intersection of products observed in every country. Today's basket is 6 SKUs across 10 EU countries. Every country pays for the identical six SKUs — apples-to-apples by construction, no imputation.
- **Pairwise basket** = intersection for a chosen country pair. Each pair is apples-to-apples within itself; cross-pair claims are non-transitive (and the UI says so).
- Per-country bars (EUR + minutes-of-work), composition grid, construction-rules recap on the page.
- Headline finding from this snapshot: **6-item universal basket — 17 minutes in DE vs 89 minutes in BG — 5.2× the labor time**, identical SKUs at the identical retailer.
- New section § 6a in `docs/METHODOLOGY.md` documenting the hard rules: never impute, version the basket, show N alongside totals, no cross-pair transitive claims.
- Dynamic Open Graph card for `/basket` so the cumulative finding gets a rich preview on social shares.

## 2026-05 — Dataset expansion to 29 cross-EU products

Three rounds of expansion across this window, every product passing the strict matcher + ≥5-country threshold.

- **+11 frequent-use essentials**: shampoo, shower gel, body lotion, hand cream, men's deodorant, lip balm, cosmetic accessories (make-up sponge, nail file), oral care (mouthwash), feminine hygiene (panty liners, tampons super).
- **+3 baby essentials**: babylove Premium Windeln (diapers), babylove Pants, babylove Bio Apfel-Banane fruit pouch.
- **+9 from the earlier round**: shower gel, body balm, hair shampoo, cotton pads, cotton swabs, toothpaste, toothbrush, tampons normal.
- **6 products with FULL 10-country observation** (every DM EU country):
  Balea Deo Roll-On Sensitive · Ebelin Wattepads · Ebelin Wattestäbchen Recycling · dontodent PRO+ Zahnpasta · dontodent Zahnbürste Soft Protect · dontodent Mundspülung Total Power.
- Honest disclosure: the text-search bootstrap on DM Germany lands on adjacent variants in a meaningful fraction of cases (e.g. "Wildrose" seed → "Sensitive" actual; "LSF 30" → "Kids LSF 50"). For each, the captured EAN/canonical URL is still a valid DM SKU sold cross-EU — the CSV and DB names were renamed to reflect *what was actually captured* rather than mislabel the data.
- Final dataset state at the end of this window: **29 products / 236 verified price rows / 0 fatal audit flags**.

### Top headline findings from the dataset

Same physical SKU, identical EAN-13, same retailer (DM). The "worktime" is the price expressed as minutes of work at each country's median hourly wage.

| Product | Cheapest worktime | Most worktime | Ratio | Countries |
|---|---|---|---|---|
| Balea Mizellenwasser 3-in-1 Rose (400 ml) | 4 min (DE) | 36 min (BG) | **9.0×** | 9 |
| dontodent Mundspülung Total Power (500 ml) | 2 min (DE) | 17 min (BG) | **7.2×** | 10 |
| Ebelin Wattestäbchen Recycling (200 cotton swabs) | 3 min (DE) | 18 min (BG) | **6.9×** | 10 |
| Balea Deo Roll-On Sensitive (50 ml) | 2 min (DE) | 10 min (RO) | **6.1×** | 10 |
| Jessa Tampons Cotton Super (16 pcs) | 5 min (DE) | 31 min (BG) | **5.8×** | 8 |
| babylove Premium Windeln Gr 4 (40 diapers) | 15 min (DE) | 76 min (BG) | **5.0×** | 9 |

## 2026-05 — Fairness-advocacy reframe

The web app pivoted from research dashboard to public-facing advocacy site:

- Homepage hero rewritten: **"Same product. Different price. Different worktime."** Lead with the finding, not the data.
- Headline-finding card under the CTAs surfaces the single biggest wage-time gap in the dataset.
- Product grid sorted by **labor-time ratio** (not EUR spread); the wage-time gap is the hero metric, not a secondary one.
- About page restructured as "Why this matters" — Mission + EU-policy hook + "Why this is a fair comparison" bullets + Press kit / Cite this.
- Per-product pages gained a "Cite this finding" block (copyable citation) and X/LinkedIn/Mastodon share buttons with auto-filled headline text.
- Dynamic Open Graph cards on every page (default, per-product) so social previews show the wage-time number.
- Compare page renamed "Where the wage-time gap is widest" — minutes-ratio bars instead of EUR-spread bars.

Wording precision: "low-wage consumer" → **"median-wage consumer"** across all surfaces. The metric is computed against each country's median hourly wage (Eurostat `earn_ses_hourly`), so "median-wage" is what the math actually represents.

## 2026-05 — Strict EAN-or-DM-SKU matcher

The single biggest methodology change of the project so far. Replaced the older text-scoring fallback with a strict acceptance rule:

> Every inserted price row must satisfy one of two identity criteria: (a) the scraped page's JSON-LD `gtin13` equals the seed EAN, **OR** (b) the scraped URL contains the same DM internal `/p/d/<NNNN>/` SKU id as the anchor country's URL. If neither holds, no row is inserted for that country.

Why this needed to happen — a deep audit of the dataset surfaced 15 wrong-product rows that the old matcher had silently inserted:

- Nivea Soft Creme 200 ml jar → 100 g soap bar in CZ/HU
- Denkmit liquid floor cleaner 1 l → toilet stones (4 piece) in AT/DE
- alverde lip balm 4.8 g → nail polish (10 ml) in SI
- Gillette Fusion5 4-pack blades → whole razor with 2 blades in HR/HU

The pack-guard was extended in the same change:

- Bidirectional unit-category check (volume ↔ weight ↔ piece) — catches the cream-to-soap class of error.
- Multi-pack regex catches multi-digit prefixes (`12x80`, `30x19,25`).
- All checks apply on every candidate, including EAN-equality matches (a multi-pack can legitimately reuse the single-unit EAN).

New `price.scraped_ean` column (migration 003) persists the JSON-LD `gtin13` the page actually exposed at scrape time. The audit script (`scripts/audit_pack_quality.py`) independently re-verifies every row's identity claim — so a future regression in the matcher becomes detectable on the next audit run rather than weeks later.

`init-db` migration tracker via `PRAGMA user_version` makes non-idempotent DDL (e.g. `ALTER TABLE ADD COLUMN`) safe across repeated runs.

## 2026-04 — Pack-guard hardening (multiple rounds)

Iterative response to surfacing wrong-variant matches:

- Multi-pack regex matching `2x...` through `12x...` plus word markers (`Duopack`, `Doppelpack`, `Jumbopack`, `Big Pack`, `Reisegröße`, `Travel size`, `Mini-pack`).
- EU piece-unit aliases for cross-language matching: `stück/stk/st` (DE/AT), `ks` (CZ/SK), `kom` (HR), `kos` (SI), `szt` (PL), `buc` (RO), `db` (HU), `бр` (BG Cyrillic).
- Unit-category mismatch check, originally one-way (piece-seed → weight/volume scrape), later made bidirectional.

## 2026-04 — EAN-as-prerequisite

Established the project's hardest rule: products that fail to acquire an EAN-13 at the anchor-country bootstrap step are excluded from the database entirely. No EAN, no entry, no exceptions. The pipeline enforces this by deleting any post-capture row where `ean IS NULL` before the cross-country scrape begins.

## 2026-04 — EAN-first cross-country matching

The first major matching-strategy iteration. Anchor country (DM Germany) is scraped by text-search; every other country is then searched by EAN, bypassing local-language naming variants entirely.

## 2026-04 — Cross-EU dataset bootstrap

Initial expansion to 30 products with English names + canonical retailer URLs + product images. 204 real scrapes across 10 DM countries.

## 2026-03 — Project foundation

- SQLite schema (5 tables + view), Playwright + Jina rendering backends, parallel-by-country scrape orchestrator.
- Next.js 15 / App Router web app with EU choropleth, per-product detail pages, sources table.
- METHODOLOGY + ARCHITECTURE docs.
