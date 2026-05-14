"""Fill in `product.ean`, `product.image_url`, and `product.canonical_url` for
rows missing them, using the DM Germany spider with the configured render
backend (typically Playwright).

For each EAN-less product:
  1. Run the DM spider against Germany (largest catalog, most reliable anchor).
  2. Take the EAN, image_url, canonical product URL, and local product name
     from JSON-LD on the matching DM detail page.
  3. Write back to product.ean / image_url / canonical_url (each only if NULL,
     so existing values are never clobbered).

Why DM Germany specifically: same SKU IDs across all DM country sites, so once
DE has the EAN every other country can EAN-search for it later. The canonical
URL also lets the web app deep-link readers to the original product page.
"""
from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

from scraper.core import db as dbmod
from scraper.core.fetch import Fetcher
from scraper.core.models import ProductSpec, ShopCountry
from scraper.spiders.dm import DMSpider

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("capture-eans")


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = list(conn.execute("""
        SELECT p.id, pd.name AS producer, p.name, p.size_value, p.size_unit,
               p.category, p.subcategory, p.search_hint
        FROM product p JOIN producer pd ON pd.id = p.producer_id
        WHERE p.ean IS NULL
           OR p.image_url IS NULL
           OR p.canonical_url IS NULL
        ORDER BY p.id
    """))
    if not rows:
        print("No EAN-less products — nothing to do.")
        return

    de = next(iter(dbmod.get_shop_countries(conn, "dm", ["DE"])), None)
    if de is None:
        raise SystemExit("DM Germany not configured in shop_country")

    print(f"Capturing EANs for {len(rows)} products via DM Germany "
          f"(backend={__import__('os').environ.get('EUPRICE_RENDER', 'playwright')})\n")

    fetcher = Fetcher(min_delay_seconds=1.0)
    spider = DMSpider(fetcher=fetcher)
    success = 0
    try:
        for r in rows:
            spec = ProductSpec(
                producer=r["producer"], name=r["name"],
                size_value=r["size_value"], size_unit=r["size_unit"],
                category=r["category"], subcategory=r["subcategory"],
                search_hint=r["search_hint"],
            )
            label = f"{spec.producer} {spec.name}"[:50]
            try:
                scrape = spider.scrape(spec, de)
            except Exception as e:
                print(f"  ! {label:<50}  error {type(e).__name__}: {e}")
                continue
            if scrape is None:
                print(f"  - {label:<50}  no confident match")
                continue

            # Attach EAN (skip if another product already owns it)
            if scrape.ean:
                taken = conn.execute(
                    "SELECT id FROM product WHERE ean = ? AND id <> ?",
                    (scrape.ean, r["id"]),
                ).fetchone()
                if taken is None:
                    conn.execute(
                        "UPDATE product SET ean = ? WHERE id = ? AND ean IS NULL",
                        (scrape.ean, r["id"]),
                    )
            if scrape.image_url:
                conn.execute(
                    "UPDATE product SET image_url = ? WHERE id = ? AND image_url IS NULL",
                    (scrape.image_url, r["id"]),
                )
            # Always store the canonical (DM Germany) URL we landed on.
            conn.execute(
                "UPDATE product SET canonical_url = ? WHERE id = ? AND canonical_url IS NULL",
                (scrape.url, r["id"]),
            )
            print(f"  + {label:<50}  EAN {scrape.ean or '(?)':<14}  "
                  f"<- {scrape.product_name_local[:30]}")
            success += 1
    finally:
        spider.close()
        conn.commit()
        conn.close()

    print(f"\nCaptured {success}/{len(rows)} EANs.")


if __name__ == "__main__":
    main()
