import type { Metadata } from "next";
import Link from "next/link";
import {
  listLatest,
  listCountries,
  evidenceByUrl,
  qualityRollup,
  type LatestPriceRow,
  type Country,
} from "@/lib/db";
import {
  buildFindings,
  buildUniversalBasket,
  comparisonRows,
  NON_EU_COUNTRIES,
  MIN_COMPARISON_COUNTRIES,
  type Finding,
} from "@/lib/findings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Report — intra-EU consumer price discrimination, documented",
  description:
    "Case study for EU institutions: identical drugstore SKUs (same EAN-13, same retailer) are priced differently across EU member states — and cost lower-wage consumers several times more in working time. Identity-verified, independently archived, reproducible.",
  openGraph: {
    title: "EUPRICE Report — Same product. Same retailer. Different price.",
    description:
      "Identity-verified evidence of intra-EU consumer price discrimination, in EUR, ex-VAT EUR, and minutes of median-wage work.",
  },
};

/** Top-N products by ex-VAT EUR spread — the corporate-pricing layer. */
function topExVatSpreads(rows: LatestPriceRow[], n: number) {
  const byProduct = new Map<number, LatestPriceRow[]>();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    byProduct.get(r.product_id)!.push(r);
  }
  const out: {
    product_id: number;
    label: string;
    size: string;
    min: LatestPriceRow;
    max: LatestPriceRow;
    spread_pct: number;
    countries: number;
  }[] = [];
  for (const [pid, group] of byProduct) {
    const distinct = new Set(group.map((r) => r.country_code)).size;
    if (distinct < MIN_COMPARISON_COUNTRIES) continue;
    const min = group.reduce((a, b) => (a.price_eur_ex_vat <= b.price_eur_ex_vat ? a : b));
    const max = group.reduce((a, b) => (a.price_eur_ex_vat >= b.price_eur_ex_vat ? a : b));
    const s = group[0];
    out.push({
      product_id: pid,
      label: `${s.producer} ${s.product_name_en ?? s.product_name}`,
      size: s.size_value ? `${s.size_value} ${s.size_unit}` : "",
      min,
      max,
      spread_pct: ((max.price_eur_ex_vat - min.price_eur_ex_vat) / min.price_eur_ex_vat) * 100,
      countries: distinct,
    });
  }
  out.sort((a, b) => b.spread_pct - a.spread_pct);
  return out.slice(0, n);
}

export default async function ReportPage() {
  let rows: LatestPriceRow[] = [];
  let countries: Country[] = [];
  let dbError: string | null = null;
  let archivedCount = 0;
  let obf = { confirmed: 0, total: 0, warning: 0 };
  try {
    rows = await listLatest();
    countries = await listCountries();
    archivedCount = (await evidenceByUrl()).size;
    const q = await qualityRollup("obf");
    obf = { confirmed: q.confirmed, total: q.total, warning: q.warning };
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  if (dbError) {
    return <div className="text-amber-700">{dbError}</div>;
  }

  const comp = comparisonRows(rows);
  const findings = buildFindings(rows);
  const basket = buildUniversalBasket(rows);
  const headline = findings.find((f) => f.minutes_ratio !== null) ?? null;
  const exVat = topExVatSpreads(comp, 10);

  const euCountryCodes = Array.from(
    new Set(comp.map((r) => r.country_code)),
  ).sort();
  const shops = Array.from(new Set(rows.map((r) => r.shop_code))).sort();
  const crossVerified = findings.filter((f) => f.cross_verified);
  const scrapeDates = rows.map((r) => r.parsed_at.split("T")[0]).sort();
  const scrapeWindow =
    scrapeDates.length > 0
      ? scrapeDates[0] === scrapeDates[scrapeDates.length - 1]
        ? scrapeDates[0]
        : `${scrapeDates[0]} – ${scrapeDates[scrapeDates.length - 1]}`
      : "—";
  const euCountries = countries
    .filter((c) => euCountryCodes.includes(c.code))
    .sort((a, b) => (b.median_hourly_wage_eur ?? 0) - (a.median_hourly_wage_eur ?? 0));
  const today = new Date().toISOString().split("T")[0];

  const fmtMin = (m: number | null | undefined) =>
    m == null ? "—" : `${m.toFixed(1)} min`;

  return (
    <article className="mx-auto max-w-4xl">
      {/* ---------- header ---------- */}
      <header className="mb-10 border-b border-slate-200 pb-8">
        <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Case study · prepared for EU-institution readers
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Same product. Same retailer. Different price — and a far larger share
          of the consumer&apos;s working day.
        </h1>
        <p className="mt-4 text-sm text-slate-500">
          Living report, regenerated from the dataset on every visit · data scraped{" "}
          {scrapeWindow} · report rendered {today} ·{" "}
          <Link href="/about" className="font-medium text-indigo-700 hover:text-indigo-900">
            methodology
          </Link>{" "}
          ·{" "}
          <a
            href="https://github.com/ZsoltKralik/EUPRICE"
            className="font-medium text-indigo-700 hover:text-indigo-900"
          >
            source &amp; data
          </a>
        </p>
      </header>

      {/* ---------- executive summary ---------- */}
      <Section title="Executive summary">
        <p>
          This dataset documents, product by product, that <strong>identical drugstore
          SKUs — same EAN-13 barcode, same pack size, sold by the same retail group —
          carry materially different shelf prices across EU member states</strong>, and that
          after converting prices into the <em>working time</em> of the median earner who
          pays them, consumers in lower-wage member states routinely give up several
          times more of their day for the same physical product.
        </p>
        <ul>
          <li>
            <strong>{findings.length} products</strong> currently qualify for cross-EU
            comparison (observed in ≥{MIN_COMPARISON_COUNTRIES} EU countries), drawn from{" "}
            <strong>{comp.length} price observations</strong> across{" "}
            <strong>{euCountryCodes.length} EU countries</strong> at {shops.length} retail
            chains ({shops.join(", ")}), plus Switzerland as a non-EU high-wage comparator.
          </li>
          {headline && headline.cheapest_minutes && headline.dearest_minutes && (
            <li>
              Worst current gap: <strong>{headline.producer} {headline.display_name}</strong>{" "}
              ({headline.size_value} {headline.size_unit}) costs{" "}
              {fmtMin(headline.cheapest_minutes.minutes)} of median-wage work in{" "}
              {headline.cheapest_minutes.country_code} and{" "}
              {fmtMin(headline.dearest_minutes.minutes)} in{" "}
              {headline.dearest_minutes.country_code} —{" "}
              <strong>{headline.minutes_ratio!.toFixed(1)}× the labor time</strong> for the
              identical EAN.
            </li>
          )}
          {basket && basket.cheapest_minutes && basket.dearest_minutes && (
            <li>
              A {basket.basket_size}-item basket of identical SKUs available in every
              tracked country costs{" "}
              <strong>{Math.round(basket.cheapest_minutes.total_minutes)} minutes</strong> of
              median-wage work in {basket.cheapest_minutes.country_name} and{" "}
              <strong>{Math.round(basket.dearest_minutes.total_minutes)} minutes</strong> in{" "}
              {basket.dearest_minutes.country_name}.
            </li>
          )}
          <li>
            The spread survives VAT removal: ex-VAT price differences of{" "}
            {exVat[0] ? `${exVat[0].spread_pct.toFixed(0)} %` : "—"} on the most extreme
            product mean the gap is corporate pricing, not national tax policy.
          </li>
        </ul>
        <p>
          Every observation links the live retailer page, carries a SHA-256 fingerprint of
          the parsed HTML, and {archivedCount > 0 ? `${archivedCount} pages are` : "pages are being"}{" "}
          independently archived at the Internet Archive — third-party, dated evidence that
          the prices shown here were the prices displayed.
        </p>
      </Section>

      {/* ---------- the claim, in two layers ---------- */}
      <Section title="The claim, in two independently verifiable layers">
        <h3>Layer 1 — price discrimination on identical goods (ex-VAT EUR)</h3>
        <p>
          VAT rates are national policy, so we strip them first. What remains is the
          retailer/manufacturer pricing decision. The same physical SKU, identified by the
          same EAN-13 at the same retail group, ex-VAT:
        </p>
        <div className="not-prose overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Cheapest ex-VAT</th>
                <th className="px-3 py-2 text-right">Dearest ex-VAT</th>
                <th className="px-3 py-2 text-right">Spread</th>
                <th className="px-3 py-2 text-right">Countries</th>
              </tr>
            </thead>
            <tbody>
              {exVat.map((e, i) => (
                <tr key={e.product_id} className={i % 2 ? "bg-slate-50/50" : "bg-white"}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/product/${e.product_id}`}
                      className="font-medium text-slate-900 hover:text-indigo-700"
                    >
                      {e.label} <span className="text-xs text-slate-500">({e.size})</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">
                    €{e.min.price_eur_ex_vat.toFixed(2)} ({e.min.country_code})
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-rose-700">
                    €{e.max.price_eur_ex_vat.toFixed(2)} ({e.max.country_code})
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                    +{e.spread_pct.toFixed(0)}%
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{e.countries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Layer 2 — the wage-time burden (minutes of median-wage work)</h3>
        <p>
          Median gross hourly earnings differ several-fold across member states (Eurostat
          SES 2022: €19.39 in Germany vs €4.05 in Bulgaria). Converting each shelf price
          into minutes of the local median wage measures what the price <em>feels like</em>{" "}
          to the median consumer who pays it:
        </p>
        <div className="not-prose overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Least worktime</th>
                <th className="px-3 py-2 text-right">Most worktime</th>
                <th className="px-3 py-2 text-right">Ratio</th>
                <th className="px-3 py-2 text-right">Countries</th>
              </tr>
            </thead>
            <tbody>
              {findings.slice(0, 10).map((f: Finding, i: number) => (
                <tr key={f.product_id} className={i % 2 ? "bg-slate-50/50" : "bg-white"}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/product/${f.product_id}`}
                      className="font-medium text-slate-900 hover:text-indigo-700"
                    >
                      {f.producer} {f.display_name}{" "}
                      <span className="text-xs text-slate-500">
                        ({f.size_value} {f.size_unit})
                      </span>
                    </Link>
                    {f.cross_verified && (
                      <span className="ml-1.5 rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-700 ring-1 ring-emerald-200">
                        2-retailer verified
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">
                    {f.cheapest_minutes
                      ? `${fmtMin(f.cheapest_minutes.minutes)} (${f.cheapest_minutes.country_code})`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-rose-700">
                    {f.dearest_minutes
                      ? `${fmtMin(f.dearest_minutes.minutes)} (${f.dearest_minutes.country_code})`
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-indigo-700">
                    {f.minutes_ratio ? `${f.minutes_ratio.toFixed(1)}×` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{f.countries_observed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-slate-500">
          Full leaderboard on the <Link href="/compare" className="font-medium text-indigo-700">compare page</Link>;
          cumulative view on the <Link href="/basket" className="font-medium text-indigo-700">basket page</Link>.
        </p>
      </Section>

      {/* ---------- identity rigor ---------- */}
      <Section title="Why “identical product” is not in question">
        <ul>
          <li>
            <strong>EAN-13 identity.</strong> Every accepted observation carries the same
            GS1 barcode the anchor observation carries — read from the retailer&apos;s own
            structured data (JSON-LD <code>gtin13</code>), never inferred from text search.
          </li>
          <li>
            <strong>Same retailer-internal SKU id</strong> as a second anchor, plus a
            pack-guard that rejects size deviations &gt;±15 %, unit-category mismatches and
            multi-packs automatically.
          </li>
          <li>
            <strong>Cross-retailer corroboration.</strong> {crossVerified.length} products are
            additionally observed at a second, independent retail chain (Müller); in every
            shared country both retailers report the <em>same EAN</em> — zero disagreements.
          </li>
          <li>
            <strong>External registry check.</strong> All {obf.total} catalogued EANs are
            reconciled against Open Beauty Facts: {obf.confirmed} confirmed,{" "}
            {obf.warning} disagreements.
          </li>
          <li>
            <strong>≥{MIN_COMPARISON_COUNTRIES} EU countries</strong> required before a product
            enters any ranking; Switzerland is reported only as a non-EU comparator.
          </li>
        </ul>
        <p>
          Because identity holds at the barcode level, the well-documented{" "}
          <strong>“dual quality”</strong> objection — that Eastern European shelves get
          different formulations under the same branding (see the Commission&apos;s JRC
          testing campaigns and Directive (EU) 2019/2161, which classifies misleading dual
          quality as an unfair commercial practice) — does not apply here:{" "}
          <em>these are bit-for-bit the same products.</em> Where dual quality exists, it
          compounds the unfairness documented here; it cannot explain it away.
        </p>
      </Section>

      {/* ---------- inputs ---------- */}
      <Section title="Inputs and sources (precision audit)">
        <p>
          Every multiplier between an observed shelf price and a headline number below is
          an official statistic with a named source and retrieval date:
        </p>
        <div className="not-prose overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Country</th>
                <th className="px-3 py-2 text-right">Median wage €/h (SES 2022)</th>
                <th className="px-3 py-2 text-right">Standard VAT</th>
                <th className="px-3 py-2">Currency</th>
              </tr>
            </thead>
            <tbody>
              {euCountries.map((c, i) => (
                <tr key={c.code} className={i % 2 ? "bg-slate-50/50" : "bg-white"}>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {c.name} <span className="font-mono text-xs text-slate-400">{c.code}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {c.median_hourly_wage_eur?.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {(c.vat_standard_rate * 100).toFixed(0)} %
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{c.currency_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="text-sm">
          <li>
            <strong>Wages:</strong> Eurostat{" "}
            <a
              href="https://ec.europa.eu/eurostat/databrowser/view/earn_ses_pub2s/default/table"
              className="font-medium text-indigo-700"
            >
              earn_ses_pub2s
            </a>{" "}
            — median gross hourly earnings, all employees excl. apprentices, SES 2022 wave
            (the latest; quadrennial), retrieved via the Eurostat API on 2026-06-12. Using
            2022 medians with 2026 prices slightly <em>overstates</em> minutes in fast
            wage-growth countries (mostly CEE); the direction of this bias is documented
            and does not affect the qualitative conclusion.
          </li>
          <li>
            <strong>VAT:</strong> national standard rates as legally in force on the scrape
            dates — incl. Slovakia 23 % (from 2025-01-01), Romania 21 % (Law 141/2025, from
            2025-08-01). All price observations postdate these changes.
          </li>
          <li>
            <strong>Currencies:</strong> non-euro prices converted at ECB reference rates of
            the scrape date (rate stored per row). Bulgaria has priced in euro since
            2026-01-01 (fixed conversion 1.95583 BGN/€); Bulgarian rows are observed
            directly in EUR.
          </li>
        </ul>
      </Section>

      {/* ---------- evidence ---------- */}
      <Section title="Evidence trail — “on this date, this page showed this price”">
        <ul>
          <li>
            <strong>Live link:</strong> every row links the exact retailer product page it
            was parsed from.
          </li>
          <li>
            <strong>Local archive:</strong> the parsed HTML is stored with a SHA-256
            fingerprint recorded on the price row at scrape time.
          </li>
          <li>
            <strong>Independent archive:</strong> product pages are submitted to the{" "}
            <a href="https://web.archive.org/" className="font-medium text-indigo-700">
              Internet Archive&apos;s Wayback Machine
            </a>{" "}
            ({archivedCount} pages archived so far) — dated snapshots held by a third party
            we cannot edit. Each product page links its snapshots in the source table.
          </li>
        </ul>
        <p className="text-sm text-slate-500">
          To independently verify any single finding: open the product page → click the
          retailer link (live price) and the &quot;Archived&quot; link (dated snapshot) →
          compare with the EAN printed on a physical pack.
        </p>
      </Section>

      {/* ---------- policy ---------- */}
      <Section title="Why this belongs on an EU policy desk">
        <p>
          The Single Market promises that goods move freely. The Commission&apos;s own work on{" "}
          <a
            href="https://single-market-economy.ec.europa.eu/single-market/territorial-supply-constraints_en"
            className="font-medium text-indigo-700"
          >
            territorial supply constraints (TSCs)
          </a>{" "}
          estimates that supply-side territorial restrictions cost EU consumers billions of
          euros per year by preventing retailers from sourcing where prices are lower.
          What this dataset adds is the <strong>consumer-level, SKU-level evidence</strong>:
          named products with verified identity, price gaps that survive VAT removal, and a
          wage-time metric that shows the burden lands hardest on the lowest-wage member
          states — the inverse of convergence.
        </p>
        <p>
          The data and code are open. Each finding is citable by stable URL, downloadable as
          JSON, and independently re-verifiable. We welcome scrutiny — the methodology page
          lists every known limitation.
        </p>
      </Section>

      {/* ---------- limitations ---------- */}
      <Section title="Limitations, stated plainly">
        <ul>
          <li>
            <strong>Online prices only.</strong> National in-store promotions, loyalty
            pricing and regional store-level variation are not captured.
          </li>
          <li>
            <strong>Snapshot cadence.</strong> Prices are re-scraped in waves; a given row
            reflects its &quot;Updated&quot; date. Promo prices are flagged and visible in
            every table.
          </li>
          <li>
            <strong>Wage vintage.</strong> SES medians are from 2022 (latest wave). CEE wages
            have since grown faster than DACH wages, so current minutes-of-work in low-wage
            countries are somewhat lower than shown; ratios shrink but do not invert.
          </li>
          <li>
            <strong>Basket size.</strong> The universal basket is small by construction
            (intersection of full-coverage products); it is a rigor choice, not a
            representativeness claim.
          </li>
          <li>
            <strong>Retailer coverage.</strong> Two chains today (DM in 10 EU countries;
            Müller in DE/AT + CH). A third, east-west chain (Notino) is planned; assortment
            differences mean not every product exists at every chain.
          </li>
        </ul>
      </Section>

      {/* ---------- cite ---------- */}
      <Section title="Cite this report">
        <pre className="not-prose overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
{`EUPRICE (${today.slice(0, 4)}). Same product, same retailer, different price:
SKU-level evidence of intra-EU consumer price discrimination in labor time.
Data scraped ${scrapeWindow}; report generated ${today}.
https://github.com/ZsoltKralik/EUPRICE — per-product permalinks under /product/<id>.`}
        </pre>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
      <div className="space-y-3 text-base leading-relaxed text-slate-700 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-900 [&_strong]:text-slate-900">
        {children}
      </div>
    </section>
  );
}
