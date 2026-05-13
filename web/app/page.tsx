import Link from "next/link";
import { listLatest, listProducts, type LatestPriceRow, type ProductLite } from "@/lib/db";

export const dynamic = "force-dynamic";

function groupByProduct(rows: LatestPriceRow[]): Map<number, LatestPriceRow[]> {
  const m = new Map<number, LatestPriceRow[]>();
  for (const r of rows) {
    if (!m.has(r.product_id)) m.set(r.product_id, []);
    m.get(r.product_id)!.push(r);
  }
  return m;
}

function spreadPct(rows: LatestPriceRow[]): number | null {
  const eur = rows.map((r) => r.price_eur).filter((p) => p > 0);
  if (eur.length < 2) return null;
  const min = Math.min(...eur);
  const max = Math.max(...eur);
  return ((max - min) / min) * 100;
}

export default async function Home() {
  let rows: LatestPriceRow[] = [];
  let allProducts: ProductLite[] = [];
  let dbError: string | null = null;
  try {
    [rows, allProducts] = await Promise.all([listLatest(), listProducts()]);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  if (dbError) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900">
        <h2 className="font-semibold mb-2">Data not ready</h2>
        <p className="text-sm mb-2">{dbError}</p>
        <p className="text-sm">
          Run <code className="bg-amber-100 px-1 rounded">python scripts/export_for_web.py</code> in
          the repo root after populating the SQLite DB.
        </p>
      </div>
    );
  }

  const groups = groupByProduct(rows);
  const noPriceYet = allProducts.filter((p) => !groups.has(p.id));

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Tracked products</h1>
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        Latest shelf prices across EU. Click a product for cross-country breakdown,
        or <Link href="/map" className="text-blue-600 underline">view on the map</Link>.
      </p>

      {groups.size === 0 && noPriceYet.length === 0 ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6 text-gray-600 dark:text-gray-300">
          No products yet. Edit <code>data/products.csv</code> and run{" "}
          <code>python -m scraper.refresh init-db</code>.
        </div>
      ) : (
        <div className="space-y-3">
          {[...groups.entries()].map(([productId, group]) => {
            const sample = group[0];
            const spread = spreadPct(group);
            const promos = group.filter((r) => r.is_promo).length;
            return (
              <Link
                key={productId}
                href={`/product/${productId}`}
                className="block rounded-lg border border-gray-200 dark:border-gray-800 p-4 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <div className="flex items-start gap-4">
                  {sample.image_url && (
                    <img
                      src={sample.image_url}
                      alt=""
                      className="w-16 h-16 object-contain rounded bg-white border border-gray-100 dark:border-gray-800"
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <div>
                        <div className="text-sm text-gray-500">{sample.producer}</div>
                        <div className="font-semibold">{sample.product_name}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          {sample.size_value ?? "?"} {sample.size_unit ?? ""}
                          {sample.ean && ` · EAN ${sample.ean}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">
                          {group.length} countr{group.length === 1 ? "y" : "ies"}
                          {promos > 0 && ` · ${promos} on promo`}
                        </div>
                        {spread !== null && (
                          <div className="text-lg font-mono tabular-nums">{spread.toFixed(0)}% spread</div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {group
                        .slice()
                        .sort((a, b) => a.price_eur - b.price_eur)
                        .map((r) => (
                          <span
                            key={`${r.country_code}-${r.shop_code}`}
                            className={`inline-flex items-center gap-1 rounded border px-2 py-1 ${
                              r.is_promo
                                ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200"
                                : "border-gray-200 dark:border-gray-700"
                            }`}
                          >
                            <span className="font-mono font-semibold">{r.country_code}</span>
                            <span>€{r.price_eur.toFixed(2)}</span>
                            {r.is_promo && <span className="text-[10px] uppercase">promo</span>}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}

          {noPriceYet.length > 0 && (
            <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
              <h2 className="text-sm font-semibold uppercase text-gray-500 mb-2">
                Tracked but no prices yet ({noPriceYet.length})
              </h2>
              <div className="text-xs text-gray-500">
                {noPriceYet.map((p) => (
                  <span key={p.id} className="inline-block mr-3">
                    {p.producer} {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
