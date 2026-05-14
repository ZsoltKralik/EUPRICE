"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import EuropeMap, { type CountryDatum } from "@/components/EuropeMap";
import { displayName } from "@/lib/display";
import type { LatestPriceRow, ProductLite } from "@/lib/db";

type Metric = "eur" | "ex_vat" | "minutes" | "pli";

const METRICS: { id: Metric; label: string; help: string }[] = [
  { id: "minutes", label: "Minutes of median wage", help: "Price ÷ country median hourly wage × 60. The real cost." },
  { id: "eur", label: "EUR (incl. VAT)", help: "Shelf price paid by consumers." },
  { id: "ex_vat", label: "EUR ex-VAT", help: "Strips national tax — isolates retailer/manufacturer pricing." },
  { id: "pli", label: "Eurostat PLI (soon)", help: "Official Price Level Index — for triangulation. Not yet wired in." },
];

export default function MapClient({
  products,
  prices,
  initialProductId,
}: {
  products: ProductLite[];
  prices: LatestPriceRow[];
  initialProductId: number;
}) {
  const [productId, setProductId] = useState<number>(initialProductId);
  const [metric, setMetric] = useState<Metric>("minutes");
  const [selected, setSelected] = useState<string | null>(null);

  const product = useMemo(
    () => products.find((p) => p.id === productId) ?? null,
    [products, productId],
  );
  const productPrices = useMemo(
    () => prices.filter((r) => r.product_id === productId),
    [prices, productId],
  );

  const mapData: CountryDatum[] = useMemo(() => {
    const data: CountryDatum[] = [];
    for (const r of productPrices) {
      let value: number | null = null;
      let display = "";
      if (metric === "eur") {
        value = r.price_eur;
        display = `€${value.toFixed(2)}`;
      } else if (metric === "ex_vat") {
        value = r.price_eur_ex_vat;
        display = `€${value.toFixed(2)}`;
      } else if (metric === "minutes") {
        value = r.minutes_of_work;
        if (value !== null) display = `${value.toFixed(1)} min of work`;
      }
      if (value === null) continue;
      data.push({
        country_code: r.country_code,
        country_name: r.country_name,
        value,
        display,
        subtitle: r.is_promo ? "on promo" : undefined,
      });
    }
    return data;
  }, [productPrices, metric]);

  const selectedRow = selected
    ? productPrices.find((r) => r.country_code === selected) ?? null
    : null;

  const minMax = useMemo(() => {
    if (mapData.length === 0) return { min: 0, max: 1 };
    const vals = mapData.map((d) => d.value);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [mapData]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Cross-EU price map</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Same SKU, different countries. Toggle the metric to see EUR, ex-VAT, or how many minutes
          of median-wage work it takes to afford.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        {/* sidebar */}
        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <ProductPicker
            products={products}
            value={productId}
            onChange={(id) => {
              setProductId(id);
              setSelected(null);
            }}
          />
          <MetricPicker value={metric} onChange={setMetric} />
          {product && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-500 shadow-soft">
              <div>
                <span className="font-mono">EAN</span>{" "}
                <span className="font-mono text-slate-700">{product.ean ?? "—"}</span>
              </div>
              <div className="mt-1">
                {productPrices.length} countr
                {productPrices.length === 1 ? "y" : "ies"} with data
              </div>
            </div>
          )}
        </aside>

        {/* main */}
        <main className="space-y-5">
          {product && (
            <div className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
              {product.image_url ? (
                <img
                  src={product.image_url}
                  alt=""
                  className="h-20 w-20 rounded-lg border border-slate-100 bg-slate-50 object-contain p-1"
                />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                  no image
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {product.producer}
                </div>
                <div className="truncate text-xl font-semibold text-slate-900">{displayName(product)}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {product.size_value ?? "?"} {product.size_unit ?? ""}
                  {product.ean && (
                    <>
                      {" · "}EAN <span className="font-mono">{product.ean}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link
                  href={`/product/${product.id}`}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-soft hover:bg-slate-50 whitespace-nowrap"
                >
                  detail →
                </Link>
                {product.canonical_url && (
                  <a
                    href={product.canonical_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-soft hover:bg-indigo-100 whitespace-nowrap"
                  >
                    at retailer ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {mapData.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500 shadow-soft">
              No prices yet for this product / metric.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
              <EuropeMap
                data={mapData}
                scaleMin={minMax.min}
                scaleMax={minMax.max}
                selectedCode={selected ?? undefined}
                onSelect={setSelected}
              />
            </div>
          )}

          {selectedRow && <SelectedCountryCard row={selectedRow} />}

          <CountryTable rows={productPrices} metric={metric} />
        </main>
      </div>
    </div>
  );
}

function ProductPicker({
  products,
  value,
  onChange,
}: {
  products: ProductLite[];
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Product
      </label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-soft focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
      >
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.producer} — {p.name}
            {p.size_value ? ` (${p.size_value}${p.size_unit ?? ""})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function MetricPicker({
  value,
  onChange,
}: {
  value: Metric;
  onChange: (m: Metric) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        Metric
      </label>
      <div className="space-y-1.5">
        {METRICS.filter((m) => m.id !== "pli").map((m) => (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={
              value === m.id
                ? "block w-full rounded-xl border border-indigo-500 bg-indigo-50 px-3 py-2.5 text-left text-sm shadow-soft"
                : "block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm shadow-soft hover:bg-slate-50"
            }
          >
            <div
              className={
                value === m.id
                  ? "font-semibold text-indigo-900"
                  : "font-semibold text-slate-900"
              }
            >
              {m.label}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">{m.help}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectedCountryCard({ row }: { row: LatestPriceRow }) {
  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 to-white p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">{row.country_name}</div>
          <div className="text-xs text-slate-500">{row.shop_name}</div>
        </div>
        {row.url.startsWith("sample://") ? (
          <span className="text-xs italic text-slate-400">sample data</span>
        ) : (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
          >
            open page →
          </a>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <Stat label="Local" value={`${row.price_local.toFixed(2)} ${row.currency_code}`} />
        <Stat label="EUR" value={`€${row.price_eur.toFixed(2)}`} />
        <Stat label="ex-VAT" value={`€${row.price_eur_ex_vat.toFixed(2)}`} />
        <Stat
          label="Min of work"
          value={row.minutes_of_work ? row.minutes_of_work.toFixed(1) : "—"}
        />
      </dl>
      {row.is_promo && (
        <div className="mt-3 text-xs text-rose-700">
          On promo · regular €{row.regular_price_eur?.toFixed(2)} (
          −{((row.discount_pct ?? 0) * 100).toFixed(0)}%)
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-slate-900">
        {value}
      </dd>
    </div>
  );
}

function CountryTable({
  rows,
  metric,
}: {
  rows: LatestPriceRow[];
  metric: Metric;
}) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => {
    if (metric === "minutes")
      return (a.minutes_of_work ?? 999) - (b.minutes_of_work ?? 999);
    if (metric === "ex_vat") return a.price_eur_ex_vat - b.price_eur_ex_vat;
    return a.price_eur - b.price_eur;
  });
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">Country</th>
            <th className="px-4 py-3 text-right">Local</th>
            <th className="px-4 py-3 text-right">EUR</th>
            <th className="px-4 py-3 text-right">ex-VAT</th>
            <th className="px-4 py-3 text-right">Min of work</th>
            <th className="px-4 py-3">Promo</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={`${r.country_code}-${r.shop_code}`}
              className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
            >
              <td className="px-4 py-3">
                <span className="font-mono text-slate-500">{r.country_code}</span>{" "}
                <span className="text-slate-900">{r.country_name}</span>
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums">
                {r.price_local.toFixed(2)} {r.currency_code}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                €{r.price_eur.toFixed(2)}
              </td>
              <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-600">
                €{r.price_eur_ex_vat.toFixed(2)}
              </td>
              <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-indigo-700">
                {r.minutes_of_work ? r.minutes_of_work.toFixed(1) : "—"}
              </td>
              <td className="px-4 py-3 text-xs">
                {r.is_promo ? (
                  <span className="rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700 ring-1 ring-rose-200">
                    −{((r.discount_pct ?? 0) * 100).toFixed(0)}%
                  </span>
                ) : (
                  ""
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
