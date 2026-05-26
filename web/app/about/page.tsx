import type { Metadata } from "next";
import Link from "next/link";

import { listQuality, qualityRollup } from "@/lib/db";

export const metadata: Metadata = {
  title: "Why this matters",
  description:
    "EUPRICE documents EU consumer price unfairness in drugstore essentials: how the strict EAN-and-retailer-SKU matching works, why minutes-of-median-wage is the headline metric, and what the EU policy hook is.",
};

export default async function AboutPage() {
  const obfRollup = await qualityRollup("obf");
  const obfRows = await listQuality("obf");
  // Latest run timestamp for "as of" label
  const lastRun = obfRows.length
    ? obfRows.map((r) => r.run_at).sort().slice(-1)[0]
    : null;
  const lastRunDate = lastRun ? lastRun.slice(0, 10) : null;
  // Up to 4 confirmed examples to show as evidence rows
  const confirmed = obfRows
    .filter(
      (r) =>
        r.severity === "info" && r.message.startsWith("OBF confirms"),
    )
    .slice(0, 4);

  return (
    <article className="prose-slate mx-auto max-w-3xl">
      <div className="mb-10">
        <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Mission · Methodology
        </div>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900">
          Why this matters
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-slate-600">
          A single market should mean one price level for one product — but it doesn&apos;t.
          EUPRICE measures the gap, product by product, and translates it into the metric
          consumers actually feel: minutes of work at the country&apos;s median hourly wage.
        </p>
      </div>

      <Section title="Mission">
        <p>
          EUPRICE documents EU consumer price unfairness in the drugstore category — the
          everyday products (face cream, soap, micellar water, hand cream) where consumers
          have no realistic alternative to retail. We track the <em>same physical SKU</em>{" "}
          (identical EAN-13 barcode, identical pack size, identical retailer group) across
          EU countries and report three views of the price: nominal EUR, ex-VAT EUR, and{" "}
          <strong className="text-slate-900">minutes of median-wage labor time</strong>.
        </p>
        <p>
          The labor-time view is what makes the unfairness visible. A €3 face cream that
          costs ~10 minutes of work for an Austrian consumer can cost ~25 minutes for a
          Bulgarian consumer with the same euro price — because their wages aren&apos;t
          equal even though the EU single market promises consumer-price convergence.
        </p>
        <p>
          This is directly relevant to{" "}
          <strong className="text-slate-900">
            European Commission policy on territorial supply constraints (TSCs)
          </strong>
          : contractual or de-facto restrictions that allow manufacturers to
          price-discriminate across the single market. EUPRICE provides the kind of
          product-level, identity-verified evidence that case-study work and policy
          submissions need.
        </p>
      </Section>

      <Section title="Why this is a fair comparison">
        <p>
          A cross-country price comparison is only as honest as the identity guarantees
          underneath it. EUPRICE enforces five rigor checks before any row enters the
          public dataset:
        </p>
        <ul>
          <li>
            <strong className="text-slate-900">Same physical SKU.</strong> EAN-13 barcode
            equality. Each price row records the JSON-LD <code>gtin13</code> value the
            retailer page actually exposed; the audit verifies it matches the canonical
            product EAN at scrape time AND on every re-audit.
          </li>
          <li>
            <strong className="text-slate-900">Same retailer group.</strong> Currently DM
            Drogerie Markt across 10 EU countries. No cross-retailer averaging that would
            blur supply-chain differences with retail-margin differences.
          </li>
          <li>
            <strong className="text-slate-900">Same retailer-internal SKU id.</strong> When
            EAN-13 codes diverge between countries (a real edge case for regionally
            re-labeled SKUs), we accept a match only when DM&apos;s own internal{" "}
            <code>/p/d/&lt;NNNN&gt;/</code> id is identical across both URLs — the
            retailer&apos;s own &quot;same product&quot; claim.
          </li>
          <li>
            <strong className="text-slate-900">Pack-guard validation.</strong> Multi-pack
            markers (<code>2x4,8 g</code>, <code>Duopack</code>, <code>Jumbopack</code>),
            unit-category mismatches (200 ml seed vs 100 g scrape), and same-category size
            deviations &gt; 15 % are all rejected automatically. This catches the
            wrong-product-line failures common to text-search matchers.
          </li>
          <li>
            <strong className="text-slate-900">Minimum coverage threshold.</strong> Every
            product on the site has observations in at least 5 EU countries — a Germany +
            Austria pair isn&apos;t a cross-EU finding, it&apos;s a cross-DACH
            observation, so those are excluded.
          </li>
        </ul>
        <p>
          See <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">docs/METHODOLOGY.md</code>{" "}
          in the repository for the full rules, including the bidirectional unit-category
          check and the scraped-EAN audit trail.
        </p>
      </Section>

      <Section title="External EAN verification (Open Beauty Facts)">
        <p>
          Today every identity claim in the dataset rests on the retailer&apos;s own
          JSON-LD <code>gtin13</code>. To strengthen that with an independent witness,
          every EAN is also checked against{" "}
          <a
            href="https://world.openbeautyfacts.org/"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-indigo-700 hover:text-indigo-900"
          >
            Open Beauty Facts
          </a>{" "}
          — the community-maintained public EAN registry for personal-care products.
          Results are recorded in the <code>data_quality_log</code> table and are
          append-only: drift over time is itself a signal.
        </p>
        <div className="not-prose mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Confirmed"
            value={obfRollup.confirmed}
            of={obfRollup.total}
            tone="positive"
            hint="Brand + size agree with OBF"
          />
          <Stat
            label="Stub"
            value={obfRollup.stub}
            of={obfRollup.total}
            tone="neutral"
            hint="EAN known to OBF, no metadata yet"
          />
          <Stat
            label="Not in OBF"
            value={obfRollup.miss}
            of={obfRollup.total}
            tone="neutral"
            hint="Private-label SKUs uncatalogued"
          />
          <Stat
            label="Disagreement"
            value={obfRollup.warning}
            of={obfRollup.total}
            tone={obfRollup.warning ? "warning" : "positive"}
            hint="Brand or size mismatch (warning)"
          />
        </div>
        {lastRunDate && (
          <p className="not-prose mt-3 text-xs text-slate-500">
            Last verification run: {lastRunDate}. Source:{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5">
              scripts/verify_eans_against_obf.py
            </code>
            .
          </p>
        )}
        {confirmed.length > 0 && (
          <div className="not-prose mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Examples confirmed by OBF
            </div>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
              {confirmed.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-0.5 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-mono text-xs text-emerald-900">{r.ean}</span>
                  <span className="text-xs text-slate-600">{r.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="not-prose mt-3 text-sm text-slate-600">
          Honest framing: OBF&apos;s coverage of private-label drugstore SKUs is thin —
          Balea, Babylove, Dontodent, Ebelin SKUs are largely uncatalogued by the
          community. The full external-verification answer is{" "}
          <strong className="text-slate-900">a second retailer observing the same EAN</strong>{" "}
          (Müller is next on the roadmap). The OBF check is one independent witness; the
          cross-retailer check will be a second.
        </p>
      </Section>

      <Section title="The minutes-of-work metric">
        <p>
          The headline metric. Formula: <code>price_eur ÷ median_hourly_wage × 60</code>.
        </p>
        <p>
          Example. A €3 micellar water in Vienna (median wage ~€20/h) costs ~9 minutes
          of work. The same product at €3.40 in Bratislava (median wage ~€9/h) costs ~23
          minutes — <strong className="text-slate-900">2.5× the labor time</strong> for
          nearly the same euro price.
        </p>
        <p>
          Why this metric rather than PPP-adjusted EUR? Three reasons:
        </p>
        <ul>
          <li>
            <strong>Concrete.</strong> &quot;25 minutes of work&quot; is quotable; a
            PPP-adjusted euro figure is abstract.
          </li>
          <li>
            <strong>Income-aware.</strong> Cross-country EUR comparisons ignore that not
            everyone earns the same. Wage-time accounts for that.
          </li>
          <li>
            <strong>Policy-relevant.</strong> The harm from TSCs falls hardest on
            consumers in low-wage countries; wage-time makes that incidence visible.
          </li>
        </ul>
      </Section>

      <Section title="Data sources">
        <dl className="not-prose grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Source
            label="Retailer catalogs"
            value={
              <>
                <a
                  href="https://www.dm.de"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-indigo-700 hover:text-indigo-900"
                >
                  DM Drogerie Markt
                </a>{" "}
                (10 EU countries). Second retailer{" "}
                <a
                  href="https://www.muller.de"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-indigo-700 hover:text-indigo-900"
                >
                  Müller
                </a>{" "}
                planned.
              </>
            }
          />
          <Source
            label="Currency"
            value={
              <a
                href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-indigo-700 hover:text-indigo-900"
              >
                ECB daily euro reference rates
              </a>
            }
          />
          <Source
            label="VAT"
            value="National tax-authority publications, 2026 Q1"
          />
          <Source
            label="Median wages"
            value={
              <>
                Eurostat{" "}
                <a
                  href="https://ec.europa.eu/eurostat/databrowser/view/earn_ses_hourly/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-indigo-700 hover:text-indigo-900"
                >
                  earn_ses_hourly
                </a>{" "}
                (latest SES, 2022)
              </>
            }
          />
          <Source
            label="Product identity"
            value={
              <>
                <a
                  href="https://www.gs1.org/standards/barcodes/ean-upc"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-indigo-700 hover:text-indigo-900"
                >
                  GS1 EAN-13 barcodes
                </a>
              </>
            }
          />
          <Source
            label="Reproducibility"
            value="Every scraped page archived locally with SHA-256; scraped EAN preserved per row"
          />
        </dl>
      </Section>

      <Section title="What this is not">
        <ul>
          <li>
            <strong>Not a general consumer price index.</strong> The product list is
            curated drugstore essentials, not a representative consumer basket.
          </li>
          <li>
            <strong>Not in-store evidence.</strong> Online catalog prices, which can differ
            from in-store, especially for promotions.
          </li>
          <li>
            <strong>Not a price-comparison shopping tool.</strong> The goal is research,
            visibility, and EU policy advocacy — not transactions.
          </li>
          <li>
            <strong>Not a single-retailer attack.</strong> We use DM precisely because its
            cross-country JSON-LD product data is more transparent than most retailers&apos;.
            Adding a second drugstore is on the roadmap.
          </li>
        </ul>
      </Section>

      <Section title="Press kit · cite this">
        <p>
          Findings on this site are research artifacts. Journalists, researchers, and EU
          policy analysts are welcome to quote any number, and we encourage citation. A
          sample citation:
        </p>
        <pre className="not-prose overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
          {`Bratislava (SK) shelf price of €3.39 for Balea Mizellenwasser 3in1 Rose
400 ml (EAN 4066447365962), scraped from mojadm.sk on 2026-05-13.
Source: EUPRICE (price_id=42). Slovak median hourly wage of €9.00
from Eurostat earn_ses_hourly (2022 release).`}
        </pre>
        <p>
          The full per-row dataset is available as JSON:{" "}
          <a
            href="/data/prices.json"
            className="font-mono text-indigo-700 hover:text-indigo-900"
          >
            /data/prices.json
          </a>
          .
        </p>
      </Section>

      <div className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-soft">
        <div className="font-semibold text-slate-900">Start exploring</div>
        <p className="mt-1">
          Open the{" "}
          <Link href="/" className="font-medium text-indigo-700 hover:text-indigo-900">
            product grid
          </Link>{" "}
          (sorted by labor-time unfairness), the{" "}
          <Link href="/compare" className="font-medium text-indigo-700 hover:text-indigo-900">
            wage-time gap leaderboard
          </Link>
          , or the interactive{" "}
          <Link href="/map" className="font-medium text-indigo-700 hover:text-indigo-900">
            EU map
          </Link>
          .
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

function Source({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-soft">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-slate-700">{value}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  of,
  tone,
  hint,
}: {
  label: string;
  value: number;
  of: number;
  tone: "positive" | "warning" | "neutral";
  hint: string;
}) {
  const toneClasses: Record<typeof tone, string> = {
    positive: "border-emerald-200 bg-emerald-50",
    warning: "border-amber-200 bg-amber-50",
    neutral: "border-slate-200 bg-white",
  };
  const valueClasses: Record<typeof tone, string> = {
    positive: "text-emerald-700",
    warning: "text-amber-700",
    neutral: "text-slate-900",
  };
  return (
    <div className={`rounded-xl border ${toneClasses[tone]} p-3 shadow-soft`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${valueClasses[tone]}`}>
        {value}
        <span className="ml-1 text-sm font-medium text-slate-400">/ {of}</span>
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</div>
    </div>
  );
}
