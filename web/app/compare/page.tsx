import type { Metadata } from "next";
import Link from "next/link";
import { displayName, listLatest, type LatestPriceRow } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare · EUPRICE",
  description: "Products ranked by their cross-EU price spread.",
};

type Row = {
  product_id: number;
  producer: string;
  name: string;
  name_en: string | null;
  countries: number;
  min_eur: number;
  max_eur: number;
  min_country: string;
  max_country: string;
  spread_pct: number;
  has_promo: boolean;
  max_minutes: number | null;
  min_minutes: number | null;
};

function buildLeaderboard(rows: LatestPriceRow[]): Row[] {
  const byProduct = new Map<number, LatestPriceRow[]>();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id)!.push(r);
  }
  const out: Row[] = [];
  for (const [pid, group] of byProduct) {
    if (group.length < 2) continue;
    const minR = group.reduce((a, b) => (a.price_eur <= b.price_eur ? a : b));
    const maxR = group.reduce((a, b) => (a.price_eur >= b.price_eur ? a : b));
    const minutes = group.map((r) => r.minutes_of_work).filter((m): m is number => m !== null);
    out.push({
      product_id: pid,
      producer: group[0].producer,
      name: group[0].product_name,
      name_en: group[0].product_name_en,
      countries: group.length,
      min_eur: minR.price_eur,
      max_eur: maxR.price_eur,
      min_country: minR.country_code,
      max_country: maxR.country_code,
      spread_pct: ((maxR.price_eur - minR.price_eur) / minR.price_eur) * 100,
      has_promo: group.some((r) => r.is_promo),
      max_minutes: minutes.length ? Math.max(...minutes) : null,
      min_minutes: minutes.length ? Math.min(...minutes) : null,
    });
  }
  out.sort((a, b) => b.spread_pct - a.spread_pct);
  return out;
}

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

  const board = buildLeaderboard(rows);
  const maxSpread = board[0]?.spread_pct ?? 0;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Biggest spreads</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Products ranked by how much more they cost in their most expensive EU country vs the cheapest.
          The minutes-of-work column shows the gap in real cost — what a low-wage worker actually pays.
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
                <th className="px-4 py-3 text-right">Cheapest</th>
                <th className="px-4 py-3 text-right">Most expensive</th>
                <th className="px-4 py-3">EUR spread</th>
                <th className="px-4 py-3 text-right">Min of work spread</th>
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
                      <span className="text-xs uppercase tracking-wide text-slate-500">{r.producer}</span>{" "}
                      — {displayName({ name: r.name, name_en: r.name_en })}
                    </Link>
                    {r.has_promo && (
                      <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 ring-1 ring-rose-200">
                        promo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700">
                    €{r.min_eur.toFixed(2)}{" "}
                    <span className="text-slate-400">({r.min_country})</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-rose-700">
                    €{r.max_eur.toFixed(2)}{" "}
                    <span className="text-slate-400">({r.max_country})</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-32 rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-indigo-500"
                          style={{ width: `${Math.min(100, (r.spread_pct / Math.max(maxSpread, 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {r.spread_pct.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-indigo-700">
                    {r.min_minutes !== null && r.max_minutes !== null
                      ? `${r.min_minutes.toFixed(0)} → ${r.max_minutes.toFixed(0)} min`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.countries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
