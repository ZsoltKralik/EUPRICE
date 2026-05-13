import Link from "next/link";
import { listLatest, type LatestPriceRow } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = {
  product_id: number;
  producer: string;
  name: string;
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

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Biggest spreads</h1>
      <p className="text-gray-600 dark:text-gray-300 mb-6">
        Products ranked by how much more they cost in their most expensive EU country vs the cheapest.
      </p>
      {board.length === 0 ? (
        <div className="text-gray-500">No products with prices in 2+ countries yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-800">
              <th className="py-2 pr-3">Product</th>
              <th className="py-2 pr-3 text-right">Cheapest</th>
              <th className="py-2 pr-3 text-right">Most expensive</th>
              <th className="py-2 pr-3 text-right">EUR spread</th>
              <th className="py-2 pr-3 text-right">Min of work spread</th>
              <th className="py-2 pr-3 text-right">Countries</th>
            </tr>
          </thead>
          <tbody>
            {board.map((r) => (
              <tr key={r.product_id} className="border-b border-gray-100 dark:border-gray-900">
                <td className="py-2 pr-3">
                  <Link href={`/product/${r.product_id}`} className="text-blue-600 underline">
                    {r.producer} — {r.name}
                  </Link>
                  {r.has_promo && (
                    <span className="ml-2 text-[10px] uppercase text-rose-600">promo active</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  €{r.min_eur.toFixed(2)} <span className="text-gray-500">({r.min_country})</span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  €{r.max_eur.toFixed(2)} <span className="text-gray-500">({r.max_country})</span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold">{r.spread_pct.toFixed(0)}%</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {r.min_minutes !== null && r.max_minutes !== null
                    ? `${r.min_minutes.toFixed(0)} → ${r.max_minutes.toFixed(0)} min`
                    : "—"}
                </td>
                <td className="py-2 pr-3 text-right">{r.countries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
