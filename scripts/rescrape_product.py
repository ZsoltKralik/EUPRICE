"""Re-scrape one product across all countries of one shop (Playwright-backed).

Faster than `scraper.refresh run --shop dm` when only one product needs to be
re-scraped after a CSV / spider fix. Inserts a real price row per matched
country and updates product metadata as side effects.

Usage:
    python scripts/rescrape_product.py 12             # by product id
    python scripts/rescrape_product.py 12 --shop dm   # explicit shop
"""
from __future__ import annotations

import logging
import sqlite3
import sys
from pathlib import Path

import typer

from scraper.core import db as dbmod
from scraper.core import fx as fxmod
from scraper.core.fetch import Fetcher
from scraper.core.models import ProductSpec
from scraper.core.normalize import to_eur
from scraper.refresh import _scrape_one, SPIDER_REGISTRY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("rescrape")

app = typer.Typer(add_completion=False)


@app.command()
def main(
    product_id: int = typer.Argument(..., help="Product id to re-scrape"),
    shop: str = typer.Option("dm", help="Shop code"),
) -> None:
    spider_cls = SPIDER_REGISTRY[shop]
    conn = dbmod.connect()

    # Load this product as a ProductSpec
    row = conn.execute("""
        SELECT pd.name AS producer, p.name, p.name_en, p.size_value, p.size_unit,
               p.category, p.subcategory, p.search_hint, p.ean
        FROM product p JOIN producer pd ON pd.id = p.producer_id
        WHERE p.id = ?
    """, (product_id,)).fetchone()
    if row is None:
        print(f"No product #{product_id}", file=sys.stderr)
        raise typer.Exit(code=1)
    spec = ProductSpec(
        producer=row["producer"], name=row["name"], name_en=row["name_en"],
        size_value=row["size_value"], size_unit=row["size_unit"],
        category=row["category"], subcategory=row["subcategory"],
        search_hint=row["search_hint"], ean=row["ean"],
    )

    scs = dbmod.get_shop_countries(conn, shop)
    rate_date, fx = fxmod.fetch_ecb_daily()
    log.info("ECB rates fetched (%s)", rate_date)
    run_id = dbmod.start_scrape_run(conn, shop, None, 1)

    spider = spider_cls(fetcher=Fetcher(min_delay_seconds=1.5))
    ok = miss = 0
    try:
        for sc in scs:
            status, _row = _scrape_one(conn, spider, spec, product_id, sc, fx, run_id)
            if status in ("ok", "promo"):
                ok += 1
            else:
                miss += 1
            print(f"  {sc.country_code}: {status}")
    finally:
        spider.close()
        dbmod.finish_scrape_run(conn, run_id)
        conn.close()
    print(f"\nDone: {ok} ok, {miss} no-match for product #{product_id}.")


if __name__ == "__main__":
    app()
