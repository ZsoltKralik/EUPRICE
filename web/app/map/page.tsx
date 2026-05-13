import type { Metadata } from "next";
import { listLatest, listProducts, type LatestPriceRow, type ProductLite } from "@/lib/db";
import MapClient from "./MapClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Map · EUPRICE",
  description: "Interactive EU choropleth showing price by country in EUR, ex-VAT, or minutes of median wage.",
};

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const sp = await searchParams;
  let products: ProductLite[] = [];
  let prices: LatestPriceRow[] = [];
  let dbError: string | null = null;
  try {
    [products, prices] = await Promise.all([listProducts(), listLatest()]);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  if (dbError) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900">
        <h2 className="font-semibold mb-2">Data not ready</h2>
        <p className="text-sm">{dbError}</p>
      </div>
    );
  }
  const initialProductId = sp.product ? Number(sp.product) : products[0]?.id ?? 0;
  return (
    <MapClient products={products} prices={prices} initialProductId={initialProductId} />
  );
}
