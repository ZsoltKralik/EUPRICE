/**
 * Data access layer for the EUPRICE web app.
 *
 * Reads from static JSON snapshots exported by `python scripts/export_for_web.py`.
 * That script dumps the SQLite DB to web/data/*.json. The split keeps the web side
 * dependency-free (no native SQLite bindings, no build tools required) and makes
 * the dataset easy to ship to Vercel or anywhere static.
 *
 * Re-run the exporter after every scrape (or sample seed).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");

export type LatestPriceRow = {
  price_id: number;
  product_id: number;
  ean: string | null;
  producer: string;
  product_name: string;
  product_name_en: string | null;
  product_canonical_url: string | null;
  size_value: number | null;
  size_unit: string | null;
  category: string;
  subcategory: string | null;
  image_url: string | null;
  shop_code: string;
  shop_name: string;
  country_code: string;
  country_name: string;
  url: string;
  product_name_local: string | null;
  parsed_at: string;
  price_local: number;
  currency_code: string;
  price_eur: number;
  fx_rate: number | null;
  is_promo: number;
  is_sample: number;
  regular_price_local: number | null;
  regular_price_eur: number | null;
  discount_pct: number | null;
  vat_standard_rate: number;
  price_eur_ex_vat: number;
  median_hourly_wage_eur: number | null;
  minutes_of_work: number | null;
};

export type ProductLite = {
  id: number;
  ean: string | null;
  producer: string;
  name: string;
  name_en: string | null;
  size_value: number | null;
  size_unit: string | null;
  category: string;
  subcategory: string | null;
  image_url: string | null;
  search_hint: string;
  canonical_url: string | null;
};

// Re-export the client-safe displayName helper so existing imports from
// "@/lib/db" continue to work. New code should prefer "@/lib/display".
export { displayName } from "./display";

export type Country = {
  code: string;
  name: string;
  currency_code: string;
  vat_standard_rate: number;
  vat_food_rate: number | null;
  median_hourly_wage_eur: number | null;
  wage_source: string | null;
  wage_year: number | null;
};

export type EurostatPliRow = {
  country_code: string;
  year: number;
  category_code: string;
  category_label: string | null;
  value: number;
};

export type HistoryRow = {
  product_id: number;
  parsed_at: string;
  country_code: string;
  shop_code: string;
  price_eur: number;
};

// Lightweight mtime-keyed cache. In dev we always want to see fresh JSON when
// the Python exporter rewrites web/data/*.json — caching by mtime means any
// file change invalidates automatically without us restarting the dev server.
// Files are <100 KB so even re-reading on every request would be fine; the
// cache is just a small perf nicety for production builds.
type CacheEntry<T> = { mtime: number; data: T[] };
declare global {
  // eslint-disable-next-line no-var
  var __EUPRICE_CACHE__: Record<string, CacheEntry<unknown>> | undefined;
}
function cacheStore() {
  if (!globalThis.__EUPRICE_CACHE__) globalThis.__EUPRICE_CACHE__ = {};
  return globalThis.__EUPRICE_CACHE__;
}

async function load<T>(file: string): Promise<T[]> {
  const full = path.join(DATA_DIR, file);
  let mtime: number;
  try {
    mtime = (await fs.stat(full)).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `${file} not found. Run \`python scripts/export_for_web.py\` from the repo root.`,
      );
    }
    throw e;
  }
  const store = cacheStore();
  const hit = store[file] as CacheEntry<T> | undefined;
  if (hit && hit.mtime === mtime) {
    return hit.data;
  }
  const raw = await fs.readFile(full, "utf-8");
  const data = JSON.parse(raw) as T[];
  store[file] = { mtime, data };
  return data;
}

export async function listLatest(): Promise<LatestPriceRow[]> {
  return load<LatestPriceRow>("prices.json");
}

export async function getProductLatest(productId: number): Promise<LatestPriceRow[]> {
  return (await listLatest())
    .filter((r) => r.product_id === productId)
    .sort((a, b) => a.price_eur - b.price_eur);
}

export async function listProducts(): Promise<ProductLite[]> {
  return load<ProductLite>("products.json");
}

export async function listCountries(): Promise<Country[]> {
  return load<Country>("countries.json");
}

export async function priceHistory(productId: number): Promise<HistoryRow[]> {
  const all = await load<HistoryRow>("history.json");
  return all.filter((h) => h.product_id === productId);
}

export async function eurostatPli(year?: number, categoryCode?: string): Promise<EurostatPliRow[]> {
  const all = await load<EurostatPliRow>("eurostat_pli.json");
  return all.filter(
    (r) =>
      (year === undefined || r.year === year) &&
      (categoryCode === undefined || r.category_code === categoryCode),
  );
}
