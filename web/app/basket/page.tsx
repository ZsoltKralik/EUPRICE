import type { Metadata } from "next";
import Link from "next/link";
import { listLatest, listCountries, type LatestPriceRow, type Country } from "@/lib/db";
import {
  buildUniversalBasket,
  buildPairwiseBasket,
  basketHeadlineSentence,
  type Basket,
} from "@/lib/findings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The basket — same SKUs, very different worktime",
  description:
    "Aggregate cross-EU price and worktime for a basket of identity-verified drugstore essentials. Universal basket (every country, same SKUs) and pairwise basket (any two countries) views, methodologically apples-to-apples.",
};

type SearchParams = Promise<{ a?: string; b?: string }>;

export default async function BasketPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  let rows: LatestPriceRow[] = [];
  let countries: Country[] = [];
  let dbError: string | null = null;
  try {
    [rows, countries] = await Promise.all([listLatest(), listCountries()]);
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  if (dbError) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-soft">
        Data not ready: {dbError}
      </div>
    );
  }

  const universal = buildUniversalBasket(rows);
  const observedCountries = Array.from(
    new Set(rows.map((r) => r.country_code)),
  ).sort();
  const countryNames = new Map(countries.map((c) => [c.code, c.name]));
  const defaultA = sp.a ?? "DE";
  const defaultB =
    sp.b ?? (universal?.dearest_minutes?.country_code ?? observedCountries[observedCountries.length - 1] ?? "BG");
  const pairwise = buildPairwiseBasket(rows, defaultA, defaultB);

  return (
    <div>
      {/* hero */}
      <section className="mb-10">
        <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          The basket aggregate · cross-EU price fairness
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          A basket of identical SKUs.{" "}
          <span className="text-indigo-600">Wildly different worktime.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
          What if the same shopping cart of everyday drugstore essentials had to be filled in
          every EU country at the same retailer? Here&apos;s the aggregate cost in nominal
          EUR and in minutes of median-wage work — apples-to-apples by construction.
        </p>
        <div className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-500">
          We use only products observed in every country being compared — never imputing
          missing prices. See{" "}
          <Link href="/about" className="font-medium text-indigo-700 hover:text-indigo-900">
            the methodology
          </Link>{" "}
          for the construction rules.
        </div>
      </section>

      {/* universal basket */}
      {universal ? (
        <BasketHero basket={universal} />
      ) : (
        <div className="mb-10 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          No product is yet observed in every EU country — the universal basket is empty.
          Try the pairwise comparison below.
        </div>
      )}

      {/* country totals chart */}
      {universal && <BasketBars basket={universal} sectionTitle="Universal basket — per country" />}

      {/* composition */}
      {universal && <BasketComposition basket={universal} />}

      {/* pairwise picker */}
      <PairwiseSection
        observedCountries={observedCountries}
        countryNames={countryNames}
        defaultA={defaultA}
        defaultB={defaultB}
        basket={pairwise}
      />

      {/* methodology recap */}
      <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-base font-semibold text-slate-900">Construction rules</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600 [&_li]:list-disc [&_li]:ml-5">
          <li>
            <strong className="text-slate-900">Same SKU set in every country.</strong> The
            universal basket = the intersection of products observed in every country in the
            dataset. Country totals use the identical {universal?.basket_size ?? "—"}-product
            set; no imputation.
          </li>
          <li>
            <strong className="text-slate-900">Pairwise basket</strong> = intersection of
            products observed in both countries of the pair. Each pair is apples-to-apples
            within itself, but <em>cross-pair ratios are not transitive</em>: a DE↔BG ratio
            and a DE↔PL ratio cannot be composed into a BG↔PL claim because the underlying
            basket differs.
          </li>
          <li>
            <strong className="text-slate-900">VAT included by default.</strong> Consumer
            shelf-price perspective; the ex-VAT total is shown alongside.
          </li>
          <li>
            <strong className="text-slate-900">Versioned for citation.</strong> The current
            universal basket is labelled <code className="rounded bg-slate-100 px-1.5 py-0.5">v1</code> with
            {" "}{universal?.basket_size ?? "—"} products as of the latest scrape. When the basket
            grows, the prior version stays citable.
          </li>
          <li>
            <strong className="text-slate-900">Promo rows badged.</strong> Country totals that
            include any promo-priced row are flagged.
          </li>
        </ul>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------------------

function BasketHero({ basket }: { basket: Basket }) {
  const c = basket.cheapest_minutes!;
  const d = basket.dearest_minutes!;
  const ratio = basket.minutes_ratio!;
  return (
    <section className="mb-10 overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-6 shadow-soft sm:p-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Headline finding
        </span>
        <span className="text-xs font-medium text-indigo-700">{basket.label}</span>
      </div>
      <p className="mt-4 text-xl leading-relaxed text-slate-800 sm:text-2xl">
        Buying the <strong className="font-bold">{basket.basket_size}-item universal basket</strong> costs{" "}
        <span className="font-bold text-emerald-700">
          {c.total_minutes.toFixed(0)} minutes of work in {c.country_code}
        </span>{" "}
        vs{" "}
        <span className="font-bold text-rose-700">
          {d.total_minutes.toFixed(0)} minutes in {d.country_code}
        </span>{" "}
        —{" "}
        <span className="font-bold text-indigo-700">
          {ratio.toFixed(1)}× the labor time
        </span>{" "}
        for the identical six SKUs at the identical retailer.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Cheapest EUR"
          value={`€${basket.cheapest_eur!.total_eur.toFixed(2)}`}
          sub={basket.cheapest_eur!.country_code}
          accent="emerald"
        />
        <Stat
          label="Most expensive EUR"
          value={`€${basket.dearest_eur!.total_eur.toFixed(2)}`}
          sub={basket.dearest_eur!.country_code}
          accent="rose"
        />
        <Stat
          label="EUR spread"
          value={`${(basket.eur_spread_pct ?? 0).toFixed(0)}%`}
          sub={`${basket.dearest_eur!.country_code} vs ${basket.cheapest_eur!.country_code}`}
          accent="indigo"
        />
        <Stat
          label="Worktime ratio"
          value={`${ratio.toFixed(1)}×`}
          sub={`${d.country_code} vs ${c.country_code}`}
          accent="indigo"
        />
      </div>
    </section>
  );
}

function BasketBars({ basket, sectionTitle }: { basket: Basket; sectionTitle: string }) {
  const maxEur = Math.max(...basket.countries.map((c) => c.total_eur));
  const maxMin = Math.max(...basket.countries.map((c) => c.total_minutes), 1);
  // Order by minutes ascending so cheapest worktime is on top
  const ordered = [...basket.countries].sort((a, b) => a.total_minutes - b.total_minutes);
  return (
    <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">{sectionTitle}</h2>
      <p className="mt-1 text-sm text-slate-500">
        Each row is one country&apos;s total for the same {basket.basket_size}-product basket. The blue
        bar is labor time (minutes of work at country median wage); the grey bar is nominal EUR.
      </p>
      <div className="mt-5 space-y-2">
        <div className="grid grid-cols-[40px_minmax(0,1fr)_180px_minmax(0,1fr)_120px] items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <div>Cty</div>
          <div>Worktime (min, lower = cheaper for that country&apos;s typical earner)</div>
          <div className="text-right">Minutes</div>
          <div>Nominal EUR</div>
          <div className="text-right">EUR / ex-VAT</div>
        </div>
        {ordered.map((c) => (
          <div
            key={c.country_code}
            className="grid grid-cols-[40px_minmax(0,1fr)_180px_minmax(0,1fr)_120px] items-center gap-3"
          >
            <div className="font-mono text-sm font-semibold text-slate-700">{c.country_code}</div>
            <div className="relative h-7 rounded-md bg-slate-100">
              <div
                className="h-full rounded-md bg-indigo-500/85"
                style={{ width: `${Math.min(100, (c.total_minutes / maxMin) * 100)}%` }}
              />
              <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-medium text-slate-700">
                {c.country_name}
              </span>
            </div>
            <div className="text-right">
              <span className="font-mono text-base font-bold tabular-nums text-indigo-700">
                {c.total_minutes.toFixed(0)} min
              </span>
              {c.any_promo && (
                <span className="ml-1.5 rounded bg-rose-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-rose-700 ring-1 ring-rose-200">
                  promo
                </span>
              )}
            </div>
            <div className="relative h-7 rounded-md bg-slate-100">
              <div
                className="h-full rounded-md bg-slate-400/70"
                style={{ width: `${Math.min(100, (c.total_eur / maxEur) * 100)}%` }}
              />
            </div>
            <div className="text-right">
              <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                €{c.total_eur.toFixed(2)}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-slate-500">
                ex-VAT €{c.total_eur_ex_vat.toFixed(2)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BasketComposition({ basket }: { basket: Basket }) {
  return (
    <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">
        What&apos;s in the basket
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        The {basket.basket_size} products below are observed in every country shown above —
        the apples-to-apples set.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {basket.products.map((p) => (
          <Link
            key={p.product_id}
            href={`/product/${p.product_id}`}
            className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft hover:shadow-lift"
          >
            <div className="flex h-28 items-center justify-center bg-slate-50 p-3">
              {p.image_url ? (
                <img src={p.image_url} alt="" className="h-full w-auto object-contain transition group-hover:scale-105" />
              ) : (
                <div className="text-[10px] uppercase tracking-wide text-slate-400">no image</div>
              )}
            </div>
            <div className="flex-1 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {p.producer}
              </div>
              <div className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-900">
                {p.display_name}
              </div>
              {p.size_value && (
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {p.size_value} {p.size_unit}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function PairwiseSection({
  observedCountries,
  countryNames,
  defaultA,
  defaultB,
  basket,
}: {
  observedCountries: string[];
  countryNames: Map<string, string>;
  defaultA: string;
  defaultB: string;
  basket: Basket | null;
}) {
  return (
    <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Pairwise basket — pick any two countries
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            The pairwise basket uses every product observed in both countries you pick. Larger
            basket than the universal view, but the comparison only holds for that specific pair.
          </p>
        </div>
        <form className="flex items-center gap-2 text-sm" action="/basket" method="get">
          <select
            name="a"
            defaultValue={defaultA}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm shadow-soft"
          >
            {observedCountries.map((c) => (
              <option key={c} value={c}>
                {c} — {countryNames.get(c) ?? c}
              </option>
            ))}
          </select>
          <span className="text-slate-400">vs</span>
          <select
            name="b"
            defaultValue={defaultB}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm shadow-soft"
          >
            {observedCountries.map((c) => (
              <option key={c} value={c}>
                {c} — {countryNames.get(c) ?? c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-soft hover:bg-indigo-700"
          >
            Compare
          </button>
        </form>
      </div>

      {basket === null ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No products are observed in both <span className="font-mono">{defaultA}</span> and{" "}
          <span className="font-mono">{defaultB}</span>. Pick another pair.
        </div>
      ) : (
        <PairwiseResult basket={basket} />
      )}
    </section>
  );
}

function PairwiseResult({ basket }: { basket: Basket }) {
  const [a, b] = basket.countries;
  if (!a || !b) return null;
  const cheaperEur = basket.cheapest_eur!;
  const dearerEur = basket.dearest_eur!;
  const cheaperMin = basket.cheapest_minutes;
  const dearerMin = basket.dearest_minutes;
  return (
    <div className="mt-5 space-y-5">
      {cheaperMin && dearerMin && basket.minutes_ratio !== null && (
        <p className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-base leading-relaxed text-slate-800">
          The {basket.basket_size}-product pairwise basket costs{" "}
          <span className="font-bold text-emerald-700">
            {cheaperMin.total_minutes.toFixed(0)} min of work in {cheaperMin.country_code}
          </span>{" "}
          vs{" "}
          <span className="font-bold text-rose-700">
            {dearerMin.total_minutes.toFixed(0)} min in {dearerMin.country_code}
          </span>{" "}
          —{" "}
          <span className="font-bold text-indigo-700">{basket.minutes_ratio.toFixed(1)}×</span>{" "}
          the labor time. EUR: €{cheaperEur.total_eur.toFixed(2)} → €{dearerEur.total_eur.toFixed(2)} (
          {(basket.eur_spread_pct ?? 0).toFixed(0)}% spread).
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[a, b].map((c) => (
          <div key={c.country_code} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {c.country_name} ({c.country_code})
              {c.any_promo && (
                <span className="ml-1.5 rounded bg-rose-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-rose-700 ring-1 ring-rose-200">
                  promo
                </span>
              )}
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
              €{c.total_eur.toFixed(2)}
            </div>
            <div className="text-xs text-slate-500">ex-VAT €{c.total_eur_ex_vat.toFixed(2)}</div>
            <div className="mt-2 text-xl font-bold tabular-nums text-indigo-700">
              {c.total_minutes.toFixed(0)} min
            </div>
            <div className="text-xs text-slate-500">
              median wage €
              {c.median_hourly_wage_eur ? c.median_hourly_wage_eur.toFixed(2) : "—"}/h
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
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
  const tone =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "rose"
      ? "text-rose-700"
      : "text-indigo-700";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-soft">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums tracking-tight ${tone}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
