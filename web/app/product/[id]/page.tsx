import type { Metadata } from "next";
import Link from "next/link";
import {
  displayName,
  getProductLatest,
  listQuality,
  priceHistory,
  type QualityRow,
} from "@/lib/db";
import { buildFindings, headlineSentence } from "@/lib/findings";
import PriceBarChart from "@/components/PriceBarChart";
import MinutesOfWorkChart from "@/components/MinutesOfWorkChart";
import PriceHistoryChart from "@/components/PriceHistoryChart";

function classifyObf(q: QualityRow | null):
  | { kind: "confirmed"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "stub" }
  | { kind: "miss" }
  | null {
  if (!q) return null;
  if (q.severity === "warning") return { kind: "warning", message: q.message };
  if (q.message.startsWith("OBF confirms")) return { kind: "confirmed", message: q.message };
  if (q.message.includes("EAN known to OBF but no")) return { kind: "stub" };
  return { kind: "miss" };
}

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) return { title: "Product" };
  const rows = await getProductLatest(productId);
  const head = rows[0];
  if (!head) return { title: "Product" };
  const name = displayName(head);
  const findings = buildFindings(rows);
  const finding = findings[0];
  const headline = finding ? headlineSentence(finding) : null;
  const title = `${head.producer} ${name}`;
  const description = headline
    ? `${head.producer} ${name} (${head.size_value ?? ""}${head.size_unit ?? ""}): ${headline}. Same physical SKU, same retailer, ${rows.length} EU countries — EAN ${head.ean ?? ""}.`
    : `Cross-EU prices for ${head.producer} ${name} (${head.size_value ?? ""}${head.size_unit ?? ""}) across ${rows.length} countries.`;
  return {
    title,
    description,
    openGraph: {
      title: `${title} — ${headline ?? "EU cross-country prices"}`,
      description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
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
  const [rows, history, qualityRows] = await Promise.all([
    getProductLatest(productId),
    priceHistory(productId),
    listQuality("obf"),
  ]);
  const obfStatus = classifyObf(
    qualityRows.find((q) => q.product_id === productId) ?? null,
  );

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
  const finding = buildFindings(rows)[0] ?? null;
  const headline = finding ? headlineSentence(finding) : null;
  const productDisplayName = displayName(sample);
  const isCrossVerified = finding?.cross_verified ?? false;
  const crossVerifiedCountries = finding?.cross_verified_countries ?? [];

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
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{displayName(sample)}</h1>
          {sample.product_name_en && sample.product_name && sample.product_name !== sample.product_name_en && (
            <div className="mt-1 text-sm italic text-slate-500">
              Local name: {sample.product_name}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <span>
              {sample.size_value ?? "?"} {sample.size_unit ?? ""}
            </span>
            {sample.ean && (
              <span>
                · EAN <span className="font-mono">{sample.ean}</span>
              </span>
            )}
            {isCrossVerified && (
              <a
                href="/about#external-ean-verification-open-beauty-facts"
                title={`Same EAN-13 independently observed by two retailers in: ${crossVerifiedCountries.join(", ")}`}
                className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800"
              >
                ✓ cross-verified ({crossVerifiedCountries.join(", ")})
              </a>
            )}
            {obfStatus && <ObfPill status={obfStatus} />}
          </div>
          {sample.product_canonical_url && (
            <a
              href={sample.product_canonical_url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
            >
              View at retailer ↗
            </a>
          )}
        </div>
      </header>

      {/* headline finding — the unfairness statement, prominent */}
      {finding && finding.cheapest_minutes && finding.dearest_minutes && finding.minutes_ratio && (
        <section className="mb-10 overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-6 shadow-soft sm:p-8">
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
            The wage-time gap
          </div>
          <p className="mt-2 text-xl leading-relaxed text-slate-800 sm:text-2xl">
            This product costs{" "}
            <span className="font-bold text-rose-700">
              {finding.dearest_minutes.minutes.toFixed(0)} minutes of work in{" "}
              {finding.dearest_minutes.country_code}
            </span>{" "}
            vs{" "}
            <span className="font-bold text-emerald-700">
              {finding.cheapest_minutes.minutes.toFixed(0)} minutes in{" "}
              {finding.cheapest_minutes.country_code}
            </span>{" "}
            —{" "}
            <span className="font-bold text-indigo-700">
              {finding.minutes_ratio.toFixed(1)}× the labor time
            </span>{" "}
            for the same physical SKU.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Calculated as <code>price_eur ÷ median_hourly_wage × 60</code>. Wages from
            Eurostat <code className="font-mono">earn_ses_hourly</code>. The cross-country
            comparison is identity-verified — same EAN-13 barcode, same retailer-internal
            SKU id, same pack size.{" "}
            <Link href="/about" className="font-medium text-indigo-700 hover:text-indigo-900">
              Methodology
            </Link>
            .
          </p>
        </section>
      )}

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
          label="EUR spread"
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
                <td className="px-4 py-3 font-mono text-slate-700">
                  {r.country_code}
                  {r.is_sample === 1 && (
                    <span
                      className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500"
                      title="Wage-scaled sample row — link goes to that country's DM search for the EAN"
                    >
                      sample
                    </span>
                  )}
                </td>
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
                  <a
                    className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    title={r.is_sample ? "Wage-scaled sample row; link points to the country's DM search for the EAN" : "Real scrape of this exact page"}
                  >
                    {r.is_sample ? "search ↗" : "open ↗"}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Cite + Share */}
      <CiteAndShare
        productId={productId}
        producer={sample.producer}
        displayName={productDisplayName}
        sizeValue={sample.size_value}
        sizeUnit={sample.size_unit}
        ean={sample.ean}
        headline={headline}
        scrapedAt={sample.parsed_at}
      />
    </div>
  );
}

function CiteAndShare({
  productId,
  producer,
  displayName,
  sizeValue,
  sizeUnit,
  ean,
  headline,
  scrapedAt,
}: {
  productId: number;
  producer: string;
  displayName: string;
  sizeValue: number | null;
  sizeUnit: string | null;
  ean: string | null;
  headline: string | null;
  scrapedAt: string;
}) {
  const sizeStr = sizeValue && sizeUnit ? ` ${sizeValue} ${sizeUnit}` : "";
  const productLabel = `${producer} ${displayName}${sizeStr}`;
  const date = scrapedAt.split("T")[0];
  const citation =
    `${productLabel} (EAN ${ean ?? "—"}) — ${headline ?? "cross-EU price observations"}. ` +
    `Source: EUPRICE, scraped ${date}. ` +
    `Identity verified by EAN-13 + DM internal SKU id. ` +
    `Wages from Eurostat earn_ses_hourly. ` +
    `https://euprice.example.org/product/${productId}`;

  const shareText = headline
    ? `${productLabel}: ${headline}. Same physical SKU, same retailer, across the EU. Via EUPRICE.`
    : `${productLabel}: see the EU cross-country price comparison on EUPRICE.`;
  const shareUrl = `https://euprice.example.org/product/${productId}`;

  const twitter = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`;
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  const mastodon = `https://mastodonshare.com/?text=${encodeURIComponent(shareText + " " + shareUrl)}`;

  return (
    <section className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Cite this finding
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          For journalists, researchers, and EU policy work. Copy the block below and adapt
          to your house style.
        </p>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          {citation}
        </pre>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Share this finding
        </h2>
        <p className="mt-2 text-xs text-slate-500">
          Help these numbers reach the audiences that can do something about them.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ShareLink href={twitter} label="X / Twitter" />
          <ShareLink href={linkedin} label="LinkedIn" />
          <ShareLink href={mastodon} label="Mastodon" />
        </div>
      </div>
    </section>
  );
}

function ShareLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
    >
      {label} ↗
    </a>
  );
}

function ObfPill({
  status,
}: {
  status:
    | { kind: "confirmed"; message: string }
    | { kind: "warning"; message: string }
    | { kind: "stub" }
    | { kind: "miss" };
}) {
  const classes: Record<typeof status.kind, string> = {
    confirmed: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warning: "border-amber-300 bg-amber-50 text-amber-800",
    stub: "border-slate-200 bg-slate-50 text-slate-600",
    miss: "border-slate-200 bg-slate-50 text-slate-500",
  };
  const labels: Record<typeof status.kind, string> = {
    confirmed: "OBF confirmed",
    warning: "OBF disagreement",
    stub: "OBF stub (no metadata)",
    miss: "Not in OBF",
  };
  const title =
    status.kind === "confirmed" || status.kind === "warning"
      ? status.message
      : status.kind === "stub"
        ? "EAN is known to Open Beauty Facts but has no brand/name metadata."
        : "EAN is not in Open Beauty Facts. Most DM private-label SKUs are not yet catalogued.";
  return (
    <a
      href="/about#external-ean-verification-open-beauty-facts"
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${classes[status.kind]}`}
    >
      {labels[status.kind]}
    </a>
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
