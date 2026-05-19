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
 * Compute one Finding per product from the flat latest-prices list.
 * Returns only products with ≥ 2 country observations (others can't be
 * meaningfully ranked against themselves).
 */
export function buildFindings(rows: LatestPriceRow[]): Finding[] {
  const byProduct = new Map<number, LatestPriceRow[]>();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id)!.push(r);
  }

  const out: Finding[] = [];
  for (const [pid, group] of byProduct) {
    if (group.length < 2) continue;

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
      countries_observed: group.length,
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
