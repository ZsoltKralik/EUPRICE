import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "EUPRICE — EU consumer price comparison",
  description:
    "Real-world price comparison of everyday consumer items across EU countries.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        <header className="border-b border-gray-200 dark:border-gray-800">
          <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
            <Link href="/" className="text-xl font-semibold tracking-tight">
              EU<span className="text-blue-600">PRICE</span>
            </Link>
            <nav className="flex gap-5 text-sm text-gray-600 dark:text-gray-300">
              <Link href="/">Products</Link>
              <Link href="/map">Map</Link>
              <Link href="/compare">Compare</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-6 py-8 text-xs text-gray-500">
          Prices scraped from retailer websites for research; not a commercial price-comparison service.
        </footer>
      </body>
    </html>
  );
}
