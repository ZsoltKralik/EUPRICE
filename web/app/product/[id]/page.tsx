import type { Metadata } from "next";
import Link from "next/link";
import { getProductLatest, priceHistory } from "@/lib/db";
import PriceBarChart from "@/components/PriceBarChart";
import MinutesOfWorkChart from "@/components/MinutesOfWorkChart";
import PriceHistoryChart from "@/components/PriceHistoryChart";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) return { title: "Product · EUPRICE" };
  const rows = await getProductLatest(productId);
  const head = rows[0];
  if (!head) return { title: "Product · EUPRICE" };
  return {
    title: `${head.producer} ${head.product_name} · EUPRICE`,
    description: `Cross-EU prices for ${head.producer} ${head.product_name} (${head.size_value ?? ""}${head.size_unit ?? ""}) across ${rows.length} countries.`,
  };
}

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
        <Link href="/" className="text-sm text-indigo-700">&larr; back</Link>
        <h1 className="mt-4 text-2xl font-semibold">Invalid product id</h1>
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
        <Link href="/" className="text-sm text-indigo-700">&larr; back</Link>
        <h1 className="mt-4 text-2xl font-semibold">No prices yet for product #{productId}</h1>
        <p className="mt-2 text-sm text-slate-500">Run the scraper to populate.</p>
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
    .map((r) => ({ country: r.country_code, minutes: r.minutes_of_work as number }));
  const historyForChart = history.map((h) => ({
    parsed_at: h.parsed_at,
    series: `${h.country_code}/${h.shop_code}`,
    price_eur: h.price_eur,
  }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between text-sm">
        <Link href="/" className="font-medium text-indigo-700 hover:text-indigo-900">&larr; all products</Link>
        <Link
          href={`/map?product=${productId}`}
          className="font-medium text-indigo-700 hover:text-indigo-900"
        >
          view on map &rarr;
        </Link>
      </div>

      {/* hero */}
      <header className="mb-10 flex flex-col items-start gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft sm:flex-row sm:items-center">
        {sample.image_url ? (
          <img
            src={sample.image_url}
            alt=""
            className="h-32 w-32 rounded-xl border border-slate-100 bg-slate-50 object-contain p-2"
          />
        ) : (
          <div className="grid h-32 w-32 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
            no image
          </div>
        )}
        <div className="flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{sample.producer}</div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{sample.product_name}</h1>
          <div className="mt-2 text-sm text-slate-500">
            {sample.size_value ?? "?"} {sample.size_unit ?? ""}
            {sample.ean && (
              <>
                {" · "}EAN <span className="font-mono">{sample.ean}</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* stat cards */}
      <section className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Cheapest"
          accent="emerald"
          value={`€${minRow.price_eur.toFixed(2)}`}
          sub={minRow.country_name}
        />
        <StatCard
          label="Most expensive"
          accent="rose"
          value={`€${maxRow.price_eur.toFixed(2)}`}
          sub={maxRow.country_name}
        />
        <StatCard
          label="Spread"
          accent="indigo"
          value={`${spreadPct.toFixed(0)}%`}
          sub={`${maxRow.country_code} vs ${minRow.country_code}`}
        />
      </section>

      <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Price by country (EUR)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Shelf price vs ex-VAT — gap is the VAT-policy contribution.
        </p>
        <PriceBarChart data={barData} />
      </section>

      {minutesData.length > 0 && (
        <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Minutes of median-wage work</h2>
          <p className="mb-4 text-sm text-slate-500">
            Price in EUR ÷ country median hourly wage × 60. Lower-wage countries pay more in real
            terms even when the nominal price is similar.
          </p>
          <MinutesOfWorkChart data={minutesData} />
        </section>
      )}

      {historyForChart.length > rows.length && (
        <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">History</h2>
          <PriceHistoryChart history={historyForChart} />
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-soft overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Sources</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Shop</th>
              <th className="px-4 py-3 text-right">Local price</th>
              <th className="px-4 py-3 text-right">EUR (incl)</th>
              <th className="px-4 py-3 text-right">EUR (ex-VAT)</th>
              <th className="px-4 py-3 text-right">Min of work</th>
              <th className="px-4 py-3">Promo</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3">Link</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.country_code}-${r.shop_code}-${r.url}`}
                className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
              >
                <td className="px-4 py-3 font-mono text-slate-700">{r.country_code}</td>
                <td className="px-4 py-3 text-slate-700">{r.shop_name}</td>
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
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.parsed_at.split("T")[0]}</td>
                <td className="px-4 py-3">
                  {r.url.startsWith("sample://") ? (
                    <span className="text-xs italic text-slate-400">sample</span>
                  ) : (
                    <a
                      className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      open ↗
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

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent: "emerald" | "rose" | "indigo";
}) {
  const accentText =
    accent === "emerald" ? "text-emerald-700" : accent === "rose" ? "text-rose-700" : "text-indigo-700";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-bold tabular-nums tracking-tight ${accentText}`}>
        {value}
      </div>
      <div className="mt-1 text-sm text-slate-600">{sub}</div>
    </div>
  );
}
