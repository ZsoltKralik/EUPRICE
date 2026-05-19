import type { Metadata } from "next";
import Link from "next/link";
import { listLatest, type LatestPriceRow } from "@/lib/db";
import { buildFindings } from "@/lib/findings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Where the wage-time gap is widest",
  description:
    "Drugstore products ranked by how much more labor time their price represents in lower-wage EU countries vs higher-wage ones.",
};

export default async function ComparePage() {
  let rows: LatestPriceRow[] = [];
  let dbError: string | null = null;
  try {
    rows = await listLatest();
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  if (dbError) {
    return <div className="text-amber-700">{dbError}</div>;
  }

  const board = buildFindings(rows);
  const maxRatio = Math.max(...board.map((b) => b.minutes_ratio ?? 0), 1);

  return (
    <div>
      <div className="mb-8">
        <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Fairness leaderboard
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Where the wage-time gap is widest
        </h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Drugstore products ranked by labor-time ratio — how many <em>minutes of median-wage
          work</em> the same physical SKU costs in its most-expensive EU country vs its
          cheapest. The minutes column is the case-study number; EUR is for context. See the{" "}
          <Link href="/about" className="font-medium text-indigo-700 hover:text-indigo-900">
            methodology
          </Link>{" "}
          for why labor time is the fair comparison metric.
        </p>
      </div>

      {board.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500 shadow-soft">
          No products with prices in 2+ countries yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Wage-time gap (the unfairness)</th>
                <th className="px-4 py-3 text-right">Min worktime</th>
                <th className="px-4 py-3 text-right">Max worktime</th>
                <th className="px-4 py-3 text-right">EUR spread</th>
                <th className="px-4 py-3 text-right">Countries</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r, i) => (
                <tr
                  key={r.product_id}
                  className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/product/${r.product_id}`}
                      className="font-medium text-slate-900 hover:text-indigo-700"
                    >
                      <span className="text-xs uppercase tracking-wide text-slate-500">
                        {r.producer}
                      </span>{" "}
                      — {r.display_name}
                      <span className="ml-1 text-xs text-slate-500">
                        ({r.size_value} {r.size_unit})
                      </span>
                    </Link>
                    {r.any_promo && (
                      <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 ring-1 ring-rose-200">
                        promo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-32 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{
                            width: `${Math.min(
                              100,
                              ((r.minutes_ratio ?? 1) / Math.max(maxRatio, 1)) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-sm font-semibold tabular-nums text-indigo-700">
                        {r.minutes_ratio !== null
                          ? `${r.minutes_ratio.toFixed(1)}×`
                          : "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                    {r.cheapest_minutes
                      ? `${r.cheapest_minutes.minutes.toFixed(0)} min (${r.cheapest_minutes.country_code})`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-rose-700">
                    {r.dearest_minutes
                      ? `${r.dearest_minutes.minutes.toFixed(0)} min (${r.dearest_minutes.country_code})`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-mono tabular-nums text-slate-700">
                      €{r.cheapest_eur.price_eur.toFixed(2)}
                      <span className="mx-1 text-slate-400">→</span>€{r.dearest_eur.price_eur.toFixed(2)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {r.eur_spread_pct.toFixed(0)}% spread
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.countries_observed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
