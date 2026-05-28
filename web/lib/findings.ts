/**
 * Roll-up logic shared by the homepage grid and the /compare leaderboard.
 *
 * The "Finding" object captures everything a fairness-narrative-driven UI
 * needs to know about a product's cross-country price spread:
 *  - cheapest & most-expensive country (in nominal EUR)
 *  - cheapest & most-expensive country (in minutes of median-wage work)
 *  - an `unfairness_score` for sorting — products are ranked by how much
 *    *more labor time* the median-wage consumer pays for the same physical SKU,
 *    not by raw EUR spread.
 *
 * Why a separate scoring metric? Two products can have the same EUR spread
 * but very different fairness implications:
 *   A: €3.00 in Slovakia vs €3.40 in Germany  → ~13 % EUR spread
 *      → ~22 min/wage in SK vs ~10 min/wage in DE → ratio 2.2×
 *   B: €15.00 in Bulgaria vs €17.00 in Austria → ~13 % EUR spread
 *      → ~150 min/wage in BG vs ~50 min/wage in AT → ratio 3.0×
 * Both have the same EUR spread; B is meaningfully more unfair. The
 * unfairness_score uses the minutes-of-work ratio (when available), falling
 * back to EUR spread when wage data is missing.
 */
import type { LatestPriceRow } from "./db";
import { displayName } from "./display";

export type Finding = {
  product_id: number;
  producer: string;
  product_name: string;          // canonical name (often German)
  product_name_en: string | null;
  display_name: string;          // what to show in the UI (name_en if set)
  image_url: string | null;
  size_value: number | null;
  size_unit: string | null;
  ean: string | null;
  countries_observed: number;
  // Shops this product is observed at — one entry per shop_code (e.g. "dm",
  // "mueller"). Lets the UI surface "multi-retailer" badges without joining
  // back to the raw rows.
  shops: string[];
  // Cross-retailer verification: true when two or more retailers in the same
  // country have independently observed the same EAN-13 for this product.
  // The bar for "audit-proof" identity — see methodology.
  cross_verified: boolean;
  cross_verified_countries: string[];  // countries where ≥2 retailers agreed
  cheapest_eur: { country_code: string; price_eur: number; minutes: number | null };
  dearest_eur:  { country_code: string; price_eur: number; minutes: number | null };
  cheapest_minutes: { country_code: string; minutes: number; price_eur: number } | null;
  dearest_minutes:  { country_code: string; minutes: number; price_eur: number } | null;
  eur_spread_pct: number;
  minutes_ratio: number | null;  // dearest_minutes / cheapest_minutes
  unfairness_score: number;      // sort key — higher = more unfair
  any_promo: boolean;
  any_sample: boolean;
};

/**
 * Minimum number of distinct countries a product must be observed in before it
 * appears as a fairness comparison. A two- or three-country spread is too thin
 * to make a credible cross-EU claim (e.g. a DACH-only branded SKU that DM only
 * carries in DE + AT tells us nothing about lower-wage member states). Four is
 * the floor: enough geographic spread that the wage-time gap reflects a genuine
 * cross-EU pattern rather than a single neighbouring-country quirk.
 *
 * Products below the floor stay in the database (they still matter for
 * cross-retailer EAN verification) but are excluded from the comparison grids.
 */
export const MIN_COMPARISON_COUNTRIES = 4;

/**
 * Compute one Finding per product from the flat latest-prices list.
 * Returns only products observed in at least MIN_COMPARISON_COUNTRIES distinct
 * countries — fewer than that can't support a credible cross-EU comparison.
 */
export function buildFindings(rows: LatestPriceRow[]): Finding[] {
  const byProduct = new Map<number, LatestPriceRow[]>();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id)!.push(r);
  }

  const out: Finding[] = [];
  for (const [pid, group] of byProduct) {
    // Count DISTINCT countries, not rows: a cross-verified product can have two
    // rows in one country (one per retailer), which must not inflate coverage.
    const distinctCountries = new Set(group.map((r) => r.country_code)).size;
    if (distinctCountries < MIN_COMPARISON_COUNTRIES) continue;

    const sample = group[0];
    const cheapestEurRow = group.reduce((a, b) => (a.price_eur <= b.price_eur ? a : b));
    const dearestEurRow  = group.reduce((a, b) => (a.price_eur >= b.price_eur ? a : b));

    const withMinutes = group.filter(
      (r): r is LatestPriceRow & { minutes_of_work: number } =>
        typeof r.minutes_of_work === "number" && r.minutes_of_work > 0,
    );
    const cheapestMinRow =
      withMinutes.length > 0
        ? withMinutes.reduce((a, b) => (a.minutes_of_work < b.minutes_of_work ? a : b))
        : null;
    const dearestMinRow =
      withMinutes.length > 0
        ? withMinutes.reduce((a, b) => (a.minutes_of_work > b.minutes_of_work ? a : b))
        : null;

    const eur_spread_pct =
      ((dearestEurRow.price_eur - cheapestEurRow.price_eur) /
        Math.max(cheapestEurRow.price_eur, 0.0001)) *
      100;

    const minutes_ratio =
      cheapestMinRow && dearestMinRow && cheapestMinRow.minutes_of_work > 0
        ? dearestMinRow.minutes_of_work / cheapestMinRow.minutes_of_work
        : null;

    // Sort key: prefer the minutes-of-work ratio (the project's headline
    // fairness measure). When wage data is missing for a row, fall back to
    // the EUR spread so the product still ranks somewhere reasonable.
    const unfairness_score =
      minutes_ratio !== null
        ? minutes_ratio * 100
        : eur_spread_pct;

    // Shop / cross-retailer roll-up. A product is "cross-verified" if any
    // single country has observations from two or more retailers, AND those
    // retailers report identical EANs. We trust v_latest_prices.ean (the
    // product-table canonical) as the comparison key — same logic as
    // scripts/audit_cross_retailer.py.
    const shops = Array.from(new Set(group.map((r) => r.shop_code))).sort();
    const cross_countries = new Set<string>();
    if (shops.length >= 2) {
      const byCountry = new Map<string, LatestPriceRow[]>();
      for (const r of group) {
        if (!byCountry.has(r.country_code)) byCountry.set(r.country_code, []);
        byCountry.get(r.country_code)!.push(r);
      }
      for (const [cc, rows] of byCountry) {
        if (new Set(rows.map((r) => r.shop_code)).size < 2) continue;
        const eans = new Set(rows.map((r) => r.ean).filter(Boolean));
        if (eans.size === 1) cross_countries.add(cc);
      }
    }

    out.push({
      product_id: pid,
      producer: sample.producer,
      product_name: sample.product_name,
      product_name_en: sample.product_name_en,
      display_name: displayName(sample),
      image_url: sample.image_url,
      size_value: sample.size_value,
      size_unit: sample.size_unit,
      ean: sample.ean,
      countries_observed: distinctCountries,
      shops,
      cross_verified: cross_countries.size > 0,
      cross_verified_countries: Array.from(cross_countries).sort(),
      cheapest_eur: {
        country_code: cheapestEurRow.country_code,
        price_eur: cheapestEurRow.price_eur,
        minutes: cheapestEurRow.minutes_of_work,
      },
      dearest_eur: {
        country_code: dearestEurRow.country_code,
        price_eur: dearestEurRow.price_eur,
        minutes: dearestEurRow.minutes_of_work,
      },
      cheapest_minutes: cheapestMinRow
        ? {
            country_code: cheapestMinRow.country_code,
            minutes: cheapestMinRow.minutes_of_work,
            price_eur: cheapestMinRow.price_eur,
          }
        : null,
      dearest_minutes: dearestMinRow
        ? {
            country_code: dearestMinRow.country_code,
            minutes: dearestMinRow.minutes_of_work,
            price_eur: dearestMinRow.price_eur,
          }
        : null,
      eur_spread_pct,
      minutes_ratio,
      unfairness_score,
      any_promo: group.some((r) => r.is_promo === 1),
      any_sample: group.some((r) => r.is_sample === 1),
    });
  }

  // Sort: most unfair first.
  out.sort((a, b) => b.unfairness_score - a.unfairness_score);
  return out;
}

/** Return the top-N most unfair findings (already sorted by buildFindings). */
export function topUnfairness(findings: Finding[], n = 1): Finding[] {
  return findings.slice(0, n);
}

/**
 * One-line headline string for a finding — used in OG cards, share buttons,
 * citations. Returns null if the finding lacks minutes-of-work data.
 *
 * Example: "14 min in SK vs 5 min in DE — 2.8× the labor time"
 */
export function headlineSentence(f: Finding): string | null {
  if (!f.cheapest_minutes || !f.dearest_minutes || f.minutes_ratio === null) return null;
  const c = f.cheapest_minutes;
  const d = f.dearest_minutes;
  return `${d.minutes.toFixed(0)} min in ${d.country_code} vs ${c.minutes.toFixed(0)} min in ${c.country_code} — ${f.minutes_ratio.toFixed(1)}× the labor time`;
}

// ============================================================================
// Basket aggregates
//
// See docs/METHODOLOGY.md § 6a for the rules. Summary:
//   - The "universal basket" is the intersection of products observed in
//     EVERY country in the dataset. Each country's total uses the SAME set
//     of SKUs, so totals are apples-to-apples comparable.
//   - The "pairwise basket" is the intersection of products observed in a
//     specific two-country pair. Different pairs yield different baskets;
//     each pair is apples-to-apples within itself but cross-pair claims
//     are non-transitive and must be flagged as such in the UI.
//   - No imputation. If a country lacks an SKU, that SKU is excluded.
//   - VAT-inclusive totals are primary; ex-VAT is exposed as well.
// ============================================================================

/** Lightweight product label inside a basket; just enough to render a chip. */
export type BasketProduct = {
  product_id: number;
  producer: string;
  display_name: string;
  size_value: number | null;
  size_unit: string | null;
  ean: string | null;
  image_url: string | null;
};

/** Per-country basket totals. Currencies are EUR throughout. */
export type BasketCountryTotal = {
  country_code: string;
  country_name: string;
  median_hourly_wage_eur: number | null;
  total_eur: number;          // VAT-inclusive sum of basket prices
  total_eur_ex_vat: number;   // ex-VAT sum
  total_minutes: number;      // sum of minutes_of_work across the basket
  products_counted: number;   // == basket size when complete
  any_promo: boolean;         // at least one basket row is on promo
};

export type Basket = {
  kind: "universal" | "pairwise";
  label: string;                    // e.g. "Universal basket v1" or "DE ↔ BG basket"
  basket_size: number;              // number of SKUs in the basket
  products: BasketProduct[];
  countries: BasketCountryTotal[];  // sorted cheapest minutes first
  cheapest_eur: BasketCountryTotal | null;
  dearest_eur: BasketCountryTotal | null;
  cheapest_minutes: BasketCountryTotal | null;
  dearest_minutes: BasketCountryTotal | null;
  eur_spread_pct: number | null;    // (dearest_eur - cheapest_eur) / cheapest_eur × 100
  minutes_ratio: number | null;     // dearest_minutes / cheapest_minutes
  promo_country_codes: string[];    // countries whose total includes a promo row
};

/**
 * Build the universal basket — the intersection of products observed in
 * every country in the dataset. Returns null if the intersection is empty.
 */
export function buildUniversalBasket(
  rows: LatestPriceRow[],
  version = "v1",
): Basket | null {
  const allCountries = new Set(rows.map((r) => r.country_code));
  if (allCountries.size === 0) return null;
  const productCountrySets = new Map<number, Set<string>>();
  for (const r of rows) {
    if (!productCountrySets.has(r.product_id)) {
      productCountrySets.set(r.product_id, new Set());
    }
    productCountrySets.get(r.product_id)!.add(r.country_code);
  }
  const universalProductIds = [...productCountrySets.entries()]
    .filter(([, set]) => set.size === allCountries.size)
    .map(([pid]) => pid);
  if (universalProductIds.length === 0) return null;
  return buildBasketFromIds(
    rows,
    universalProductIds,
    [...allCountries],
    "universal",
    `Universal basket ${version} (${universalProductIds.length} products × ${allCountries.size} countries)`,
  );
}

/**
 * Build a pairwise basket — the intersection of products observed in BOTH
 * named countries. Returns null if the intersection is empty.
 */
export function buildPairwiseBasket(
  rows: LatestPriceRow[],
  countryA: string,
  countryB: string,
): Basket | null {
  if (countryA === countryB) return null;
  const inA = new Set<number>();
  const inB = new Set<number>();
  for (const r of rows) {
    if (r.country_code === countryA) inA.add(r.product_id);
    else if (r.country_code === countryB) inB.add(r.product_id);
  }
  const intersection = [...inA].filter((pid) => inB.has(pid));
  if (intersection.length === 0) return null;
  return buildBasketFromIds(
    rows,
    intersection,
    [countryA, countryB],
    "pairwise",
    `${countryA} ↔ ${countryB} pairwise basket (${intersection.length} products)`,
  );
}

function buildBasketFromIds(
  rows: LatestPriceRow[],
  productIds: number[],
  countryCodes: string[],
  kind: Basket["kind"],
  label: string,
): Basket {
  const productIdSet = new Set(productIds);
  const countrySet = new Set(countryCodes);
  const filtered = rows.filter(
    (r) => productIdSet.has(r.product_id) && countrySet.has(r.country_code),
  );

  // products in the basket — take first observation per product_id for label
  const productMap = new Map<number, BasketProduct>();
  for (const r of filtered) {
    if (!productMap.has(r.product_id)) {
      productMap.set(r.product_id, {
        product_id: r.product_id,
        producer: r.producer,
        display_name: displayName(r),
        size_value: r.size_value,
        size_unit: r.size_unit,
        ean: r.ean,
        image_url: r.image_url,
      });
    }
  }
  const products = [...productMap.values()].sort((a, b) =>
    a.producer.localeCompare(b.producer) || a.display_name.localeCompare(b.display_name),
  );

  // per-country totals
  const byCountry = new Map<string, BasketCountryTotal>();
  for (const r of filtered) {
    if (!byCountry.has(r.country_code)) {
      byCountry.set(r.country_code, {
        country_code: r.country_code,
        country_name: r.country_name,
        median_hourly_wage_eur: r.median_hourly_wage_eur,
        total_eur: 0,
        total_eur_ex_vat: 0,
        total_minutes: 0,
        products_counted: 0,
        any_promo: false,
      });
    }
    const c = byCountry.get(r.country_code)!;
    c.total_eur += r.price_eur;
    c.total_eur_ex_vat += r.price_eur_ex_vat;
    if (typeof r.minutes_of_work === "number" && r.minutes_of_work > 0) {
      c.total_minutes += r.minutes_of_work;
    }
    c.products_counted += 1;
    if (r.is_promo === 1) c.any_promo = true;
  }

  const countries = [...byCountry.values()].sort(
    (a, b) => a.total_minutes - b.total_minutes,
  );

  const cheapest_eur = countries.length
    ? countries.reduce((a, b) => (a.total_eur <= b.total_eur ? a : b))
    : null;
  const dearest_eur = countries.length
    ? countries.reduce((a, b) => (a.total_eur >= b.total_eur ? a : b))
    : null;
  const withMin = countries.filter((c) => c.total_minutes > 0);
  const cheapest_minutes = withMin.length
    ? withMin.reduce((a, b) => (a.total_minutes <= b.total_minutes ? a : b))
    : null;
  const dearest_minutes = withMin.length
    ? withMin.reduce((a, b) => (a.total_minutes >= b.total_minutes ? a : b))
    : null;

  const eur_spread_pct =
    cheapest_eur && dearest_eur && cheapest_eur.total_eur > 0
      ? ((dearest_eur.total_eur - cheapest_eur.total_eur) / cheapest_eur.total_eur) *
        100
      : null;
  const minutes_ratio =
    cheapest_minutes && dearest_minutes && cheapest_minutes.total_minutes > 0
      ? dearest_minutes.total_minutes / cheapest_minutes.total_minutes
      : null;

  const promo_country_codes = countries
    .filter((c) => c.any_promo)
    .map((c) => c.country_code);

  return {
    kind,
    label,
    basket_size: products.length,
    products,
    countries,
    cheapest_eur,
    dearest_eur,
    cheapest_minutes,
    dearest_minutes,
    eur_spread_pct,
    minutes_ratio,
    promo_country_codes,
  };
}

/**
 * One-line headline sentence for a basket — used in OG cards, share text,
 * homepage callouts. Returns null if the basket lacks minutes data.
 *
 * Example: "The 6-item universal basket costs 53 min of work in AT vs
 * 254 min in BG — 4.8× the labor time"
 */
export function basketHeadlineSentence(b: Basket): string | null {
  if (!b.cheapest_minutes || !b.dearest_minutes || b.minutes_ratio === null) {
    return null;
  }
  const kindWord = b.kind === "universal" ? "universal" : "pairwise";
  return (
    `The ${b.basket_size}-item ${kindWord} basket costs ` +
    `${b.cheapest_minutes.total_minutes.toFixed(0)} min of work in ${b.cheapest_minutes.country_code}` +
    ` vs ${b.dearest_minutes.total_minutes.toFixed(0)} min in ${b.dearest_minutes.country_code}` +
    ` — ${b.minutes_ratio.toFixed(1)}× the labor time`
  );
}
