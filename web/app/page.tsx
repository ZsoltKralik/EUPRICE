import type { Metadata } from "next";
import Link from "next/link";
import { listLatest, listProducts, type LatestPriceRow, type ProductLite } from "@/lib/db";
import { buildFindings, headlineSentence, type Finding } from "@/lib/findings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Same product. Different price. Different worktime.",
  description:
    "Identical drugstore SKUs cost more — in real labor time — for consumers in lower-wage EU member states. Verified product-by-product across 10 countries.",
};

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
          Run <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono">python scripts/export_for_web.py</code>{" "}
          in the repo root.
        </p>
      </div>
    );
  }

  const findings = buildFindings(rows);
  const headline = findings.find((f) => f.minutes_ratio !== null);
  const totalCountries = new Set(rows.map((r) => r.country_code)).size;

  return (
    <div>
      {/* hero */}
      <section className="mb-12">
        <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          EU consumer price fairness
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Same product. <span className="text-indigo-600">Different price.</span>{" "}
          <span className="block sm:inline">Different worktime.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
          Identical drugstore SKUs cost more — in real labor time — for consumers in lower-wage EU
          member states. Verified product-by-product across {totalCountries} countries at the same
          retailer group.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link
            href="/compare"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-indigo-700"
          >
            See the wage-time gap →
          </Link>
          <Link
            href="/map"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-soft hover:bg-slate-50"
          >
            Open the map
          </Link>
          <Link
            href="/about"
            className="inline-flex items-center gap-2 rounded-xl border border-transparent px-5 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            Why this matters
          </Link>
        </div>

        {/* quick stats */}
        <div className="mt-8 grid grid-cols-3 gap-3 max-w-xl">
          <Stat value={allProducts.length} label="cross-EU products" />
          <Stat value={totalCountries} label="countries" />
          <Stat value={rows.length} label="verified observations" />
        </div>
      </section>

      {/* headline finding card */}
      {headline && <HeadlineCard finding={headline} />}

      <h2 className="mb-1 text-xl font-semibold tracking-tight text-slate-900">
        Tracked products
      </h2>
      <p className="mb-5 text-sm text-slate-500">
        Ordered by the labor-time gap: products at the top punish the median-wage consumer the most.
      </p>

      {findings.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {findings.map((f) => (
            <ProductCard key={f.product_id} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function HeadlineCard({ finding }: { finding: Finding }) {
  const c = finding.cheapest_minutes!;
  const d = finding.dearest_minutes!;
  const ratio = finding.minutes_ratio!;
  return (
    <Link
      href={`/product/${finding.product_id}`}
      className="group mb-12 block overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-6 shadow-soft hover:shadow-lift sm:p-8"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Headline finding
        </span>
        <span className="text-xs text-slate-500">
          Click for full per-country breakdown →
        </span>
      </div>
      <div className="mt-4 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        {finding.image_url && (
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl border border-indigo-100 bg-white p-3">
            <img
              src={finding.image_url}
              alt=""
              className="h-full w-auto object-contain"
            />
          </div>
        )}
        <div className="flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {finding.producer}
          </div>
          <div className="mt-1 text-lg font-semibold leading-snug text-slate-900 sm:text-xl">
            {finding.display_name}{" "}
            <span className="font-normal text-slate-500">
              ({finding.size_value} {finding.size_unit})
            </span>
          </div>
          <p className="mt-4 text-base leading-relaxed text-slate-800 sm:text-lg">
            Costs{" "}
            <span className="font-bold text-rose-700">
              {d.minutes.toFixed(0)} minutes of work in {d.country_code}
            </span>{" "}
            vs{" "}
            <span className="font-bold text-emerald-700">
              {c.minutes.toFixed(0)} minutes in {c.country_code}
            </span>{" "}
            —{" "}
            <span className="font-bold text-indigo-700">
              {ratio.toFixed(1)}× the labor time
            </span>{" "}
            for the same physical SKU.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="font-mono">EAN {finding.ean ?? "—"}</span>
            <span>·</span>
            <span>
              €{c.price_eur.toFixed(2)} → €{d.price_eur.toFixed(2)} ({finding.eur_spread_pct.toFixed(0)}% EUR spread)
            </span>
            <span>·</span>
            <span>{finding.countries_observed} countries observed</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function ProductCard({ finding }: { finding: Finding }) {
  const c = finding.cheapest_minutes;
  const d = finding.dearest_minutes;
  return (
    <Link
      href={`/product/${finding.product_id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft hover:shadow-lift"
    >
      <div className="flex items-center justify-center bg-slate-50 p-6 h-44 border-b border-slate-100">
        {finding.image_url ? (
          <img
            src={finding.image_url}
            alt=""
            className="h-full w-auto object-contain transition group-hover:scale-105"
          />
        ) : (
          <div className="text-xs uppercase tracking-wide text-slate-400">no image</div>
        )}
        {finding.any_promo && (
          <span className="absolute right-3 top-3 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 ring-1 ring-rose-200">
            promo
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {finding.producer}
        </div>
        <div className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-slate-900">
          {finding.display_name}
        </div>
        <div className="mt-1 text-xs text-slate-500">
          {finding.size_value ?? "?"} {finding.size_unit ?? ""}
          {finding.ean && (
            <>
              {" · "}
              <span className="font-mono">{finding.ean}</span>
            </>
          )}
        </div>

        {/* MINUTES is the hero metric */}
        {c && d ? (
          <div className="mt-4 rounded-xl bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
              Wage-time gap
            </div>
            <div className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums">
              <span className="text-base font-semibold text-emerald-700">
                {c.minutes.toFixed(0)}
              </span>
              <span className="text-xs text-slate-400">min ({c.country_code})</span>
              <span className="mx-1 text-slate-300">→</span>
              <span className="text-base font-semibold text-rose-700">
                {d.minutes.toFixed(0)}
              </span>
              <span className="text-xs text-slate-400">min ({d.country_code})</span>
            </div>
            {finding.minutes_ratio !== null && (
              <div className="mt-1 text-xs font-semibold text-indigo-700">
                {finding.minutes_ratio.toFixed(1)}× more worktime for the median-wage consumer
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 text-xs text-slate-400">No wage data</div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>
            €{finding.cheapest_eur.price_eur.toFixed(2)} → €{finding.dearest_eur.price_eur.toFixed(2)}
          </span>
          <span>·</span>
          <span>{finding.eur_spread_pct.toFixed(0)}% EUR spread</span>
          <span>·</span>
          <span>{finding.countries_observed} countries</span>
        </div>
      </div>
    </Link>
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
