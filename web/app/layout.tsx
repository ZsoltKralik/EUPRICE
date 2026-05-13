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
  title: "EUPRICE — EU consumer price comparison",
  description:
    "Cross-country price comparison of everyday consumer items across 10 EU countries, measured in EUR and in minutes of median wage.",
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
              <NavLink href="/map">Map</NavLink>
              <NavLink href="/compare">Compare</NavLink>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>

        <footer className="mt-12 border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-6 text-xs text-slate-500">
            Real prices scraped from retailer websites for research. Wages from{" "}
            <span className="font-mono">Eurostat earn_ses_hourly</span>. Price Level
            Indices from <span className="font-mono">Eurostat prc_ppp_ind</span>.
            Sample data marked <span className="italic">sample</span> where applicable.
          </div>
        </footer>
      </body>
    </html>
  );
}
