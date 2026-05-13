"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import EuropeMap, { type CountryDatum } from "@/components/EuropeMap";
import type { LatestPriceRow, ProductLite } from "@/lib/db";

type Metric = "eur" | "ex_vat" | "minutes" | "pli";

const METRICS: { id: Metric; label: string; help: string }[] = [
  { id: "eur", label: "EUR (incl. VAT)", help: "Shelf price paid by consumers." },
  { id: "ex_vat", label: "EUR ex-VAT", help: "Strips national tax — isolates retailer/manufacturer pricing." },
  { id: "minutes", label: "Minutes of median wage", help: "Price ÷ country median hourly wage × 60. The real burden." },
  { id: "pli", label: "Eurostat PLI (placeholder)", help: "Official Price Level Index — for triangulation. Not yet wired in." },
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
        if (value !== null) display = `${value.toFixed(1)} min`;
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
      <h1 className="text-3xl font-bold mb-1">Cross-EU price map</h1>
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        Same SKU, different countries. Toggle the metric to see EUR price, ex-VAT,
        or how many minutes of median-wage work it takes to afford.
      </p>

      <section className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
        <aside className="space-y-4">
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
            <div className="text-xs text-gray-500 leading-relaxed">
              <div>
                <span className="font-mono">EAN:</span> {product.ean ?? "—"}
              </div>
              <div className="mt-1">
                {productPrices.length} country
                {productPrices.length === 1 ? "" : "ies"} with data
              </div>
            </div>
          )}
        </aside>

        <main className="space-y-4">
          {product && (
            <div className="flex items-start gap-4 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
              {product.image_url && (
                <img
                  src={product.image_url}
                  alt=""
                  className="w-20 h-20 object-contain rounded bg-white border border-gray-100 dark:border-gray-800"
                />
              )}
              <div className="flex-1">
                <div className="text-sm text-gray-500">{product.producer}</div>
                <div className="text-xl font-semibold">{product.name}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {product.size_value ?? "?"} {product.size_unit ?? ""}
                </div>
              </div>
              <Link
                href={`/product/${product.id}`}
                className="text-sm text-blue-600 underline self-start"
              >
                detail →
              </Link>
            </div>
          )}

          {mapData.length === 0 ? (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-gray-500">
              No prices yet for this product / metric.
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
              <EuropeMap
                data={mapData}
                scaleMin={minMax.min}
                scaleMax={minMax.max}
                selectedCode={selected ?? undefined}
                onSelect={setSelected}
              />
            </div>
          )}

          {selectedRow && (
            <SelectedCountryCard row={selectedRow} metric={metric} />
          )}

          <CountryTable rows={productPrices} metric={metric} />
        </main>
      </section>
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
      <label className="block text-xs uppercase tracking-wide text-gray-500 mb-1">
        Product
      </label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
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
      <label className="block text-xs uppercase tracking-wide text-gray-500 mb-1">
        Metric
      </label>
      <div className="space-y-1">
        {METRICS.filter((m) => m.id !== "pli").map((m) => (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={`block w-full text-left rounded px-3 py-2 text-sm border ${
              value === m.id
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-900 dark:text-blue-100"
                : "border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900"
            }`}
          >
            <div className="font-medium">{m.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{m.help}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectedCountryCard({
  row,
  metric,
}: {
  row: LatestPriceRow;
  metric: Metric;
}) {
  return (
    <div className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/30 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="font-semibold">{row.country_name}</div>
          <div className="text-xs text-gray-500">{row.shop_name}</div>
        </div>
        <a
          href={row.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-blue-600 underline"
        >
          open product page →
        </a>
      </div>
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Local" value={`${row.price_local.toFixed(2)} ${row.currency_code}`} />
        <Stat label="EUR" value={`€${row.price_eur.toFixed(2)}`} />
        <Stat label="ex-VAT" value={`€${row.price_eur_ex_vat.toFixed(2)}`} />
        <Stat
          label="Min of work"
          value={row.minutes_of_work ? `${row.minutes_of_work.toFixed(1)}` : "—"}
        />
      </dl>
      {row.is_promo && (
        <div className="mt-2 text-xs text-rose-700 dark:text-rose-300">
          On promo: regular €{row.regular_price_eur?.toFixed(2)} (
          −{((row.discount_pct ?? 0) * 100).toFixed(0)}%)
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-gray-500">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-800">
            <th className="py-2 pr-3">Country</th>
            <th className="py-2 pr-3 text-right">Local</th>
            <th className="py-2 pr-3 text-right">EUR</th>
            <th className="py-2 pr-3 text-right">ex-VAT</th>
            <th className="py-2 pr-3 text-right">Min of work</th>
            <th className="py-2 pr-3">Promo</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={`${r.country_code}-${r.shop_code}`} className="border-b border-gray-100 dark:border-gray-900">
              <td className="py-2 pr-3 font-mono">
                {r.country_code} <span className="text-gray-500">{r.country_name}</span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {r.price_local.toFixed(2)} {r.currency_code}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">€{r.price_eur.toFixed(2)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">€{r.price_eur_ex_vat.toFixed(2)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {r.minutes_of_work ? r.minutes_of_work.toFixed(1) : "—"}
              </td>
              <td className="py-2 pr-3">
                {r.is_promo ? (
                  <span className="text-rose-700 dark:text-rose-300">
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
