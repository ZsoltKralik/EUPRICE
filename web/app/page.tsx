import type { Metadata } from "next";
import Link from "next/link";
import { listLatest, listProducts, type LatestPriceRow, type ProductLite } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Products · EUPRICE",
};

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
  return ((Math.max(...eur) - Math.min(...eur)) / Math.min(...eur)) * 100;
}

function minutesSpread(rows: LatestPriceRow[]): { min: number; max: number } | null {
  const m = rows.map((r) => r.minutes_of_work).filter((x): x is number => x !== null);
  if (m.length < 2) return null;
  return { min: Math.min(...m), max: Math.max(...m) };
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
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-soft">
        <h2 className="mb-2 font-semibold">Data not ready</h2>
        <p className="mb-2 text-sm">{dbError}</p>
        <p className="text-sm">
          Run <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono">python scripts/export_for_web.py</code> in
          the repo root.
        </p>
      </div>
    );
  }

  const groups = groupByProduct(rows);
  const noPriceYet = allProducts.filter((p) => !groups.has(p.id));
  const totalCountries = new Set(rows.map((r) => r.country_code)).size;
  const totalSnapshots = rows.length;

  return (
    <div>
      {/* hero */}
      <section className="mb-10">
        <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          EU consumer price research
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Same product, <span className="text-indigo-600">different price.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
          Tracking everyday consumer items across {totalCountries} EU countries — measured in EUR,
          ex-VAT, and the metric that really matters: <span className="font-semibold text-slate-900">minutes of median-wage work</span>.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/map"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-indigo-700"
          >
            Open the map →
          </Link>
          <Link
            href="/compare"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-soft hover:bg-slate-50"
          >
            Biggest spreads
          </Link>
        </div>

        {/* quick stats */}
        <div className="mt-8 grid grid-cols-3 gap-3 max-w-xl">
          <Stat value={allProducts.length} label="products tracked" />
          <Stat value={totalCountries} label="countries" />
          <Stat value={totalSnapshots} label="price snapshots" />
        </div>
      </section>

      <h2 className="mb-4 text-xl font-semibold tracking-tight text-slate-900">Tracked products</h2>

      {groups.size === 0 && noPriceYet.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...groups.entries()].map(([productId, group]) => {
            const sample = group[0];
            const spread = spreadPct(group);
            const mw = minutesSpread(group);
            const promos = group.filter((r) => r.is_promo).length;
            const cheapest = group.reduce((a, b) => (a.price_eur < b.price_eur ? a : b));
            const dearest = group.reduce((a, b) => (a.price_eur > b.price_eur ? a : b));
            return (
              <Link
                key={productId}
                href={`/product/${productId}`}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft hover:shadow-lift"
              >
                <div className="flex items-center justify-center bg-slate-50 p-6 h-44 border-b border-slate-100">
                  {sample.image_url ? (
                    <img
                      src={sample.image_url}
                      alt=""
                      className="h-full w-auto object-contain transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="text-xs uppercase tracking-wide text-slate-400">no image</div>
                  )}
                  {promos > 0 && (
                    <span className="absolute right-3 top-3 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-200">
                      promo · {promos}
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {sample.producer}
                  </div>
                  <div className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-slate-900">
                    {sample.product_name}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {sample.size_value ?? "?"} {sample.size_unit ?? ""}
                    {sample.ean && (
                      <>
                        {" · "}
                        <span className="font-mono">{sample.ean}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-slate-500">Cheapest</div>
                      <div className="font-mono text-sm font-semibold text-emerald-700 tabular-nums">
                        €{cheapest.price_eur.toFixed(2)}{" "}
                        <span className="text-slate-400">{cheapest.country_code}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Most</div>
                      <div className="font-mono text-sm font-semibold text-rose-700 tabular-nums">
                        €{dearest.price_eur.toFixed(2)}{" "}
                        <span className="text-slate-400">{dearest.country_code}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                    {spread !== null && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono font-semibold tabular-nums text-slate-700">
                        {spread.toFixed(0)}% spread
                      </span>
                    )}
                    {mw && (
                      <span className="rounded-md bg-indigo-50 px-2 py-0.5 font-mono font-semibold tabular-nums text-indigo-700">
                        {mw.min.toFixed(0)}–{mw.max.toFixed(0)} min/wage
                      </span>
                    )}
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">
                      {group.length} {group.length === 1 ? "country" : "countries"}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {noPriceYet.length > 0 && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tracked but no prices yet ({noPriceYet.length})
          </h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {noPriceYet.map((p) => (
              <span
                key={p.id}
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600"
              >
                {p.producer} {p.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft">
      <div className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-soft">
      <div className="text-sm font-medium text-slate-900">No products yet</div>
      <p className="mt-2 text-sm text-slate-500">
        Edit <code className="font-mono">data/products.csv</code> and run{" "}
        <code className="font-mono">python -m scraper.refresh init-db</code>.
      </p>
    </div>
  );
}
