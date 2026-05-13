import Link from "next/link";
import { getProductLatest, priceHistory, type LatestPriceRow } from "@/lib/db";
import PriceBarChart from "@/components/PriceBarChart";
import MinutesOfWorkChart from "@/components/MinutesOfWorkChart";
import PriceHistoryChart from "@/components/PriceHistoryChart";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idParam } = await params;
  const productId = Number(idParam);
  if (!Number.isInteger(productId) || productId <= 0) {
    return (
      <div>
        <Link href="/" className="text-sm text-blue-600">&larr; back</Link>
        <h1 className="text-2xl font-semibold mt-4">Invalid product id</h1>
      </div>
    );
  }
  const [rows, history] = await Promise.all([
    getProductLatest(productId),
    priceHistory(productId),
  ]);

  if (rows.length === 0) {
    return (
      <div>
        <Link href="/" className="text-sm text-blue-600">&larr; back</Link>
        <h1 className="text-2xl font-semibold mt-4">No prices yet for product #{productId}</h1>
        <p className="text-sm text-gray-500 mt-2">Run the scraper to populate.</p>
      </div>
    );
  }

  const sample = rows[0];
  const minRow = rows.reduce((a, b) => (a.price_eur <= b.price_eur ? a : b));
  const maxRow = rows.reduce((a, b) => (a.price_eur >= b.price_eur ? a : b));
  const spreadPct = ((maxRow.price_eur - minRow.price_eur) / minRow.price_eur) * 100;

  const barData = rows.map((r) => ({
    country: r.country_code,
    incl: r.price_eur,
    ex_vat: r.price_eur_ex_vat,
  }));

  const minutesData = rows
    .filter((r) => r.minutes_of_work !== null && r.minutes_of_work > 0)
    .map((r) => ({
      country: r.country_code,
      minutes: r.minutes_of_work as number,
    }));

  const historyForChart = history.map((h) => ({
    parsed_at: h.parsed_at,
    series: `${h.country_code}/${h.shop_code}`,
    price_eur: h.price_eur,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm text-blue-600">&larr; back</Link>
        <Link href={`/map?product=${productId}`} className="text-sm text-blue-600">view on map →</Link>
      </div>

      <header className="mt-3 mb-6 flex items-start gap-5">
        {sample.image_url && (
          <img
            src={sample.image_url}
            alt=""
            className="w-28 h-28 object-contain rounded bg-white border border-gray-200 dark:border-gray-800"
          />
        )}
        <div>
          <div className="text-sm text-gray-500">{sample.producer}</div>
          <h1 className="text-3xl font-bold">{sample.product_name}</h1>
          <div className="text-sm text-gray-500 mt-1">
            {sample.size_value ?? "?"} {sample.size_unit ?? ""}
            {sample.ean && ` · EAN ${sample.ean}`}
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          <div className="text-xs uppercase text-gray-500">cheapest</div>
          <div className="text-2xl font-bold">€{minRow.price_eur.toFixed(2)}</div>
          <div className="text-sm text-gray-600 dark:text-gray-300">{minRow.country_name}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          <div className="text-xs uppercase text-gray-500">most expensive</div>
          <div className="text-2xl font-bold">€{maxRow.price_eur.toFixed(2)}</div>
          <div className="text-sm text-gray-600 dark:text-gray-300">{maxRow.country_name}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
          <div className="text-xs uppercase text-gray-500">spread</div>
          <div className="text-2xl font-bold">{spreadPct.toFixed(0)}%</div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {maxRow.country_code} vs {minRow.country_code}
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Price by country (EUR)</h2>
        <PriceBarChart data={barData} />
      </section>

      {minutesData.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Minutes of median-wage work</h2>
          <p className="text-xs text-gray-500 mb-3">
            Price in EUR ÷ country median hourly wage × 60. Lower-wage countries pay more in
            real terms even when nominal price is similar.
          </p>
          <MinutesOfWorkChart data={minutesData} />
        </section>
      )}

      {historyForChart.length > rows.length && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">History</h2>
          <PriceHistoryChart history={historyForChart} />
        </section>
      )}

      <section>
        <h2 className="text-xl font-semibold mb-3">Sources</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-800">
              <th className="py-2 pr-3">Country</th>
              <th className="py-2 pr-3">Shop</th>
              <th className="py-2 pr-3 text-right">Local price</th>
              <th className="py-2 pr-3 text-right">EUR (incl)</th>
              <th className="py-2 pr-3 text-right">EUR (ex-VAT)</th>
              <th className="py-2 pr-3 text-right">Min of work</th>
              <th className="py-2 pr-3">Promo</th>
              <th className="py-2 pr-3">Updated</th>
              <th className="py-2 pr-3">Link</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.country_code}-${r.shop_code}-${r.url}`}
                className="border-b border-gray-100 dark:border-gray-900"
              >
                <td className="py-2 pr-3 font-mono">{r.country_code}</td>
                <td className="py-2 pr-3">{r.shop_name}</td>
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
                    "—"
                  )}
                </td>
                <td className="py-2 pr-3 text-gray-500">{r.parsed_at.split("T")[0]}</td>
                <td className="py-2 pr-3">
                  {r.url.startsWith("sample://") ? (
                    <span className="text-gray-400 italic">sample</span>
                  ) : (
                    <a className="text-blue-600 underline" href={r.url} target="_blank" rel="noreferrer">
                      open
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
