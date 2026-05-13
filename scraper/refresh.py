"""CLI: refresh prices for every product in data/products.csv across configured countries.

Usage:
    python -m scraper.refresh init-db
    python -m scraper.refresh run --shop dm --countries SK,AT,DE
    python -m scraper.refresh run --shop dm                  # all DM countries
    python -m scraper.refresh run --shop dm --limit 3        # only first 3 products
"""
from __future__ import annotations

import logging
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

from .core import db as dbmod
from .core import fx as fxmod
from .core.fetch import Fetcher
from .core.models import ProductSpec, ShopCountry
from .core.normalize import to_eur
from .spiders.base import Spider
from .spiders.dm import DMSpider
from .spiders.tigota import TigotaSpider

app = typer.Typer(add_completion=False, help="EUPRICE scraper")
console = Console()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("euprice")

SPIDER_REGISTRY: dict[str, type[Spider]] = {
    "dm": DMSpider,
    "tigota": TigotaSpider,
}


@app.command("init-db")
def cmd_init_db() -> None:
    """Apply schema + migrations and load data/products.csv."""
    dbmod.init_db()
    conn = dbmod.connect()
    specs = dbmod.load_products_csv()
    dbmod.sync_products(conn, specs)
    console.print(f"[green]OK[/green] DB initialized at {dbmod.DB_PATH}")
    console.print(f"[green]OK[/green] {len(specs)} products synced from data/products.csv")
    conn.close()


@app.command("test-jina")
def cmd_test_jina(
    url: str = typer.Argument("https://www.dm.de", help="URL to fetch via Jina"),
    engine: str = typer.Option("browser", help="'direct' or 'browser'"),
) -> None:
    """Sanity-check the Jina API key and fetch one URL through it."""
    fetcher = Fetcher()
    if not fetcher.jina_api_key:
        console.print("[red]JINA_API_KEY is not set.[/red] Add it to your .env file.")
        raise typer.Exit(code=1)
    res = fetcher._get_via_jina(url, engine=engine)  # noqa: SLF001
    console.print(f"[green]Jina OK[/green]  status={res.status_code}  bytes={len(res.html)}")
    console.print(f"first 240 chars: {res.html[:240]!r}")
    fetcher.close()


@app.command("fetch-eurostat")
def cmd_fetch_eurostat(
    years: str = typer.Option("2023,2022", help="Comma-separated years to fetch"),
    categories: Optional[str] = typer.Option(None, help="Comma-separated icp codes; default CP00,CP01,CP05,CP12"),
) -> None:
    """Pull Eurostat Price Level Indices for the tracked countries and store them."""
    from .core import eurostat
    conn = dbmod.connect()
    country_codes = [r["code"] for r in conn.execute("SELECT code FROM country ORDER BY code")]
    if not country_codes:
        console.print("[yellow]No countries in DB — run init-db first.[/yellow]")
        return
    yrs = [int(y.strip()) for y in years.split(",") if y.strip()]
    cats = ([c.strip() for c in categories.split(",")]
            if categories else eurostat.DEFAULT_CATEGORIES)
    rows = eurostat.fetch_pli(country_codes, yrs, cats)
    eurostat.store_pli(conn, rows)
    console.print(f"[green]OK[/green] stored {len(rows)} PLI rows "
                  f"({len(country_codes)} countries × {len(yrs)} years × {len(cats)} categories)")
    conn.close()


@app.command("run")
def cmd_run(
    shop: str = typer.Option("dm", help="Shop code (e.g. 'dm')"),
    countries: Optional[str] = typer.Option(None, help="Comma-separated country codes (e.g. SK,AT,DE)"),
    limit: Optional[int] = typer.Option(None, help="Process only the first N products"),
) -> None:
    """Scrape every (product × country) for one shop."""
    spider_cls = SPIDER_REGISTRY.get(shop)
    if spider_cls is None:
        raise typer.BadParameter(f"Unknown shop '{shop}'. Known: {list(SPIDER_REGISTRY)}")
    country_codes = [c.strip().upper() for c in countries.split(",")] if countries else None

    conn = dbmod.connect()

    # Re-sync products from CSV every run; the CSV is the source of truth.
    specs = dbmod.load_products_csv()
    product_ids = dbmod.sync_products(conn, specs)
    pairs = list(zip(specs, product_ids))
    if limit:
        pairs = pairs[:limit]

    scs = dbmod.get_shop_countries(conn, shop, country_codes)
    if not scs:
        console.print(f"[yellow]No shop_country rows for {shop} / {country_codes}[/yellow]")
        return

    # FX once per run.
    try:
        rate_date, fx = fxmod.fetch_ecb_daily()
        log.info("ECB rates fetched (%s, %d currencies)", rate_date, len(fx))
    except Exception as e:  # noqa: BLE001
        log.warning("FX fetch failed: %s — non-EUR countries will be skipped", e)
        fx = {"EUR": 1.0}

    run_id = dbmod.start_scrape_run(conn, shop, country_codes, limit)

    table = Table(title=f"{shop.upper()} scrape results (run #{run_id})")
    for col in ("Country", "Producer", "Product", "EUR", "Local", "Status"):
        table.add_column(col)

    spider = spider_cls(fetcher=Fetcher(min_delay_seconds=1.5))
    try:
        for sc in scs:
            for spec, product_id in pairs:
                status, row = _scrape_one(conn, spider, spec, product_id, sc, fx, run_id)
                table.add_row(*(row if row else
                               (sc.country_code, spec.producer, spec.name, "-", "-", status)))
    finally:
        spider.close()
        dbmod.finish_scrape_run(conn, run_id)
        conn.close()

    console.print(table)


def _scrape_one(
    conn, spider: Spider, spec: ProductSpec, product_id: int,
    sc: ShopCountry, fx: dict[str, float], run_id: int,
) -> tuple[str, Optional[list[str]]]:
    try:
        scrape = spider.scrape(spec, sc)
    except Exception as e:  # noqa: BLE001
        log.exception("Spider error for %s/%s/%s", sc.country_code, spec.producer, spec.name)
        dbmod.log_scrape_attempt(conn, run_id, product_id, sc.country_code,
                                 status="error", error_class=type(e).__name__,
                                 error_msg=str(e)[:500])
        conn.commit()
        return f"ERROR {type(e).__name__}", None
    if scrape is None:
        dbmod.log_scrape_attempt(conn, run_id, product_id, sc.country_code, status="no_match")
        conn.commit()
        return "no match", None

    rate = fx.get(scrape.currency_code)
    if rate is None:
        dbmod.log_scrape_attempt(conn, run_id, product_id, sc.country_code,
                                 status="no_fx", error_msg=f"no FX rate for {scrape.currency_code}")
        conn.commit()
        return f"no FX ({scrape.currency_code})", None
    price_eur = to_eur(scrape.price_local, rate)
    regular_price_eur = (
        to_eur(scrape.regular_price_local, rate) if scrape.regular_price_local else None
    )

    with dbmod.transaction(conn):
        if scrape.ean:
            dbmod.attach_ean_to_product(conn, product_id, scrape.ean)
        if scrape.image_url:
            dbmod.attach_image_to_product(conn, product_id, scrape.image_url)
        price_id = dbmod.insert_price(
            conn,
            product_id=product_id,
            shop_id=sc.shop_id,
            country_code=sc.country_code,
            scrape=scrape,
            price_eur=price_eur,
            fx_rate=None if scrape.currency_code == "EUR" else rate,
            regular_price_eur=regular_price_eur,
        )
        status = "promo" if scrape.is_promo else "ok"
        dbmod.log_scrape_attempt(conn, run_id, product_id, sc.country_code,
                                 status=status, price_id=price_id)

    return status, [
        sc.country_code,
        spec.producer,
        scrape.product_name_local[:38] or spec.name[:38],
        f"{price_eur:.2f}",
        f"{scrape.price_local:.2f} {scrape.currency_code}",
        status,
    ]


if __name__ == "__main__":
    app()
