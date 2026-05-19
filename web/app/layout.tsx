import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import NavLink from "@/components/NavLink";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "EUPRICE — Same product. Different price. Different worktime.",
    template: "%s · EUPRICE",
  },
  description:
    "Same drugstore product. Different price. Different worktime. Documenting EU consumer price unfairness, product by product, in minutes of median-wage work.",
  openGraph: {
    title: "EUPRICE — Same product. Different price. Different worktime.",
    description:
      "Evidence that identical drugstore SKUs cost more — in real labor time — for consumers in lower-wage EU countries.",
    type: "website",
    siteName: "EUPRICE",
  },
  twitter: {
    card: "summary_large_image",
    title: "EUPRICE — EU consumer price fairness",
    description:
      "Same drugstore product. Different price. Different worktime. Verified across 10 EU countries.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
            <Link href="/" className="group flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-soft transition group-hover:bg-indigo-700">
                €
              </div>
              <span className="text-base font-semibold tracking-tight">
                EU<span className="text-indigo-600">PRICE</span>
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              <NavLink href="/">Products</NavLink>
              <NavLink href="/compare">Compare</NavLink>
              <NavLink href="/map">Map</NavLink>
              <NavLink href="/about">Why this matters</NavLink>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>

        <footer className="mt-12 border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-8 text-xs text-slate-500 sm:flex sm:items-start sm:justify-between sm:gap-8">
            <div className="max-w-2xl">
              <div className="font-semibold text-slate-900">
                Open data — every finding is citable.
              </div>
              <p className="mt-1 leading-relaxed">
                Real shelf prices scraped from retailer websites, identity-verified by
                EAN-13 + retailer-internal SKU. Wages from{" "}
                <a
                  href="https://ec.europa.eu/eurostat/databrowser/view/earn_ses_hourly/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-indigo-700 hover:text-indigo-900"
                >
                  Eurostat earn_ses_hourly
                </a>
                . Price Level Indices from{" "}
                <a
                  href="https://ec.europa.eu/eurostat/databrowser/view/prc_ppp_ind/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-indigo-700 hover:text-indigo-900"
                >
                  Eurostat prc_ppp_ind
                </a>
                . Exchange rates from{" "}
                <a
                  href="https://www.ecb.europa.eu"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-700 hover:text-indigo-900"
                >
                  ECB
                </a>
                .
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 sm:mt-0 sm:flex-col sm:gap-1 sm:text-right">
              <Link href="/about" className="text-indigo-700 hover:text-indigo-900">
                Methodology
              </Link>
              <a
                href="/data/prices.json"
                className="text-indigo-700 hover:text-indigo-900"
              >
                Data dump (JSON)
              </a>
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-700 hover:text-indigo-900"
              >
                Source on GitHub
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
