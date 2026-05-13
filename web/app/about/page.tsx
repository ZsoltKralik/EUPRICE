import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About · EUPRICE",
  description:
    "EUPRICE methodology: data sources, normalization rules, the minutes-of-median-wage metric, and limitations.",
};

export default function AboutPage() {
  return (
    <article className="prose-slate mx-auto max-w-3xl">
      <div className="mb-10">
        <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Methodology
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900">
          How EUPRICE measures cross-EU prices
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          A short summary. For the complete documentation, see{" "}
          <a
            href="https://github.com/"
            className="font-medium text-indigo-700 underline-offset-2 hover:underline"
          >
            <code>docs/METHODOLOGY.md</code>
          </a>{" "}
          in the repository.
        </p>
      </div>

      <Section title="What we measure">
        <p>
          For each tracked product, the same EAN-13 barcode SKU is scraped from
          every country where the retailer operates. We then report three views
          of the price:
        </p>
        <ul>
          <li>
            <strong className="text-slate-900">Shelf EUR (incl. VAT)</strong> —
            what the consumer pays.
          </li>
          <li>
            <strong className="text-slate-900">Shelf EUR (ex-VAT)</strong> —
            strips national tax, isolates retailer/manufacturer pricing.
          </li>
          <li>
            <strong className="text-slate-900">Minutes of median wage</strong> —
            price ÷ country median hourly wage × 60. The labor-time cost,
            comparable across income levels.
          </li>
        </ul>
      </Section>

      <Section title="Data sources">
        <dl className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Source
            label="Retailer catalogs"
            value="DM Drogerie Markt (10 countries). Tigotà (Italy) coming."
          />
          <Source
            label="Currency"
            value="ECB daily euro reference rates"
          />
          <Source
            label="VAT"
            value="National tax-authority publications, 2026 Q1"
          />
          <Source
            label="Median wages"
            value="Eurostat earn_ses_hourly (latest SES, 2022)"
          />
          <Source
            label="Price Level Indices"
            value="Eurostat prc_ppp_ind (annual, for triangulation)"
          />
          <Source
            label="Reproducibility"
            value="Every scraped page archived locally with SHA-256"
          />
        </dl>
      </Section>

      <Section title="The minutes-of-work metric">
        <p>
          The headline metric. A €3 micellar water in Vienna (median wage
          ~€20/h) costs ~9 minutes of work. The same product at €3.40 in
          Bratislava (median wage ~€9/h) costs ~23 minutes — 2.5× the labor for
          nearly the same nominal price. This is the consumer cost that
          territorial supply constraints actually produce.
        </p>
      </Section>

      <Section title="Product identity">
        <p>
          EAN-13 barcodes are the only thing that makes two prices comparable:
          they are globally unique, language-independent, and stable through
          packaging refreshes. Bootstrap: scrape the anchor country (DM Germany)
          by name, capture the EAN from JSON-LD, then EAN-search every other
          country. The local-language product name is preserved on every price
          row as a side-effect dictionary.
        </p>
      </Section>

      <Section title="What this is not">
        <ul>
          <li>
            Not a general consumer price index — the product list is curated,
            not representative of all consumer spending.
          </li>
          <li>
            Not in-store evidence — these are online catalog prices, which can
            differ from in-store, especially for promotions.
          </li>
          <li>
            Not a price-comparison shopping tool — the goal is research,
            visibility, and case-study support, not transactions.
          </li>
        </ul>
      </Section>

      <Section title="Citation">
        <p>
          When citing a specific finding, include the scrape date, retailer,
          country, EAN, and the Eurostat dataset versions used for wages and
          PLI. A sample citation lives in the methodology document.
        </p>
      </Section>

      <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-soft">
        <div className="font-semibold text-slate-900">
          Got a research question?
        </div>
        <p className="mt-1">
          Explore the data live — start at the{" "}
          <Link href="/map" className="font-medium text-indigo-700 hover:text-indigo-900">
            map
          </Link>{" "}
          and switch the metric to <em>Minutes of median wage</em>. Or scan the{" "}
          <Link href="/compare" className="font-medium text-indigo-700 hover:text-indigo-900">
            spread leaderboard
          </Link>{" "}
          to find the products with the widest cross-EU gap.
        </p>
      </div>
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-2xl font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      <div className="space-y-3 text-base leading-relaxed text-slate-700 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}

function Source({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-soft">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-700">{value}</dd>
    </div>
  );
}
