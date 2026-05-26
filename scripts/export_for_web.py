"""Export DB tables as JSON for the Next.js web app to read.

Writes to web/data/{prices.json,products.json,countries.json,eurostat_pli.json}.
Run after every scrape (or after the sample seed) before refreshing the web app.

We export only what the UI needs — keeping payloads small.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"
OUT_DIR = ROOT / "web" / "data"


def dump(cursor, name: str) -> list[dict]:
    cols = [c[0] for c in cursor.description]
    rows = [dict(zip(cols, r)) for r in cursor.fetchall()]
    return rows


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)

    files: dict[str, list[dict]] = {}

    # Latest prices (everything the map + list pages need)
    files["prices.json"] = dump(conn.execute("""
        SELECT v.*, p.image_url
        FROM v_latest_prices v
        JOIN product p ON p.id = v.product_id
        ORDER BY v.producer, v.product_name, v.country_code
    """), "prices")

    # All products (including those with no prices yet)
    files["products.json"] = dump(conn.execute("""
        SELECT p.id, p.ean, pd.name AS producer, p.name, p.name_en,
               p.size_value, p.size_unit,
               p.category, p.subcategory, p.image_url, p.search_hint,
               p.canonical_url
        FROM product p
        JOIN producer pd ON pd.id = p.producer_id
        ORDER BY pd.name, p.name
    """), "products")

    # Countries — with wages, VAT, currency
    files["countries.json"] = dump(conn.execute("""
        SELECT code, name, currency_code, vat_standard_rate, vat_food_rate,
               median_hourly_wage_eur, wage_source, wage_year
        FROM country ORDER BY code
    """), "countries")

    # Eurostat PLI snapshot
    files["eurostat_pli.json"] = dump(conn.execute("""
        SELECT country_code, year, category_code, category_label, value
        FROM eurostat_pli ORDER BY year DESC, category_code, country_code
    """), "pli")

    # Per-product price history (for time-series chart)
    files["history.json"] = dump(conn.execute("""
        SELECT pr.product_id, pr.parsed_at, pr.country_code, s.code AS shop_code,
               pr.price_eur
        FROM price pr
        JOIN shop s ON s.id = pr.shop_id
        ORDER BY pr.product_id, pr.parsed_at ASC
    """), "history")

    # External data-quality verification (Open Beauty Facts, etc.) — latest row
    # per (source × product). Surfaced on the /about page as a transparency
    # block: "of N EANs, X confirmed against OBF, Y not yet in OBF, Z stubs".
    files["quality.json"] = dump(conn.execute("""
        SELECT id, run_at, source, severity, ean, product_id, message, details_json
        FROM v_data_quality_latest
        ORDER BY source, product_id
    """), "quality")

    total = 0
    for name, rows in files.items():
        path = OUT_DIR / name
        path.write_text(json.dumps(rows, ensure_ascii=False, default=str), encoding="utf-8")
        total += len(rows)
        print(f"  wrote {name:<22} {len(rows)} rows  ({path.stat().st_size} bytes)")
    print(f"Total: {total} rows exported to {OUT_DIR}")
    conn.close()


if __name__ == "__main__":
    main()
