"""CLI: refresh prices for every product in data/products.csv across configured countries.

Usage:
    python -m scraper.refresh init-db
    python -m scraper.refresh test-jina <url>
    python -m scraper.refresh run --shop dm --countries SK,AT,DE
    python -m scraper.refresh run --shop dm                       # all DM countries
    python -m scraper.refresh run --shop dm --limit 3             # only first 3 products
    python -m scraper.refresh run --shop dm --parallel 1          # force sequential
    python -m scraper.refresh run --shop dm --parallel 10         # max 10 countries at once

Concurrency model
-----------------
The default is `--parallel 5`: countries scrape concurrently, products *within*
a country scrape sequentially. This respects per-domain rate limits (each DM
country has a different domain — dm.de vs dm.at vs mojadm.sk — so concurrent
hits are spread across servers) while still getting roughly 5× speedup over
strict sequential.

Each thread owns its own:
  - SQLite connection (writes coordinated by WAL mode)
  - Fetcher (and therefore its own Playwright Chromium instance)
  - DM spider state

The ECB exchange-rate snapshot is fetched once on the main thread and shared
read-only across workers.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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

app = typer.Typer(add_completion=False, help="EUPRICE scraper")
console = Console()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
# Calm down third-party loggers so the per-country output stays readable.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
log = logging.getLogger("euprice")

SPIDER_REGISTRY: dict[str, type[Spider]] = {
    "dm": DMSpider,
}


# ============================================================== commands

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
    """Sanity-check the Jina API key by fetching one URL through it."""
    fetcher = Fetcher(render_backend="jina")
    if not fetcher.jina_api_key:
        console.print("[red]JINA_API_KEY is not set.[/red] Add it to your .env file.")
        raise typer.Exit(code=1)
    res = fetcher._get_via_jina(url, engine=engine)  # noqa: SLF001
    console.print(f"[green]Jina OK[/green]  status={res.status_code}  bytes={len(res.html)}")
    console.print(f"first 240 chars: {res.html[:240]!r}")
    fetcher.close()


@app.command("run")
def cmd_run(
    shop: str = typer.Option("dm", help="Shop code (e.g. 'dm')"),
    countries: Optional[str] = typer.Option(None, help="Comma-separated country codes, e.g. SK,AT,DE"),
    limit: Optional[int] = typer.Option(None, help="Process only the first N products"),
    parallel: int = typer.Option(
        5,
        "--parallel", "-p",
        help="Max countries scraped concurrently (one thread per country). "
             "Set to 1 for strict sequential. Each thread spawns its own Playwright "
             "browser, so memory scales roughly 300 MB × this number.",
    ),
) -> None:
    """Scrape every (product × country) for one shop."""
    spider_cls = SPIDER_REGISTRY.get(shop)
    if spider_cls is None:
        raise typer.BadParameter(f"Unknown shop '{shop}'. Known: {list(SPIDER_REGISTRY)}")

    country_filter = (
        [c.strip().upper() for c in countries.split(",") if c.strip()] if countries else None
    )

    # ---- main-thread setup -------------------------------------------------
    setup_conn = dbmod.connect()
    specs = dbmod.load_products_csv()
    product_ids = dbmod.sync_products(setup_conn, specs)
    pairs = list(zip(specs, product_ids))
    if limit:
        pairs = pairs[:limit]

    scs = dbmod.get_shop_countries(setup_conn, shop, country_filter)
    if not scs:
        console.print(f"[yellow]No shop_country rows for {shop} / {country_filter}[/yellow]")
        setup_conn.close()
        return

    # FX once for the whole run, shared read-only across workers.
    try:
        rate_date, fx = fxmod.fetch_ecb_daily()
        log.info("ECB rates fetched (%s, %d currencies)", rate_date, len(fx))
    except Exception as e:  # noqa: BLE001
        log.warning("FX fetch failed: %s — non-EUR countries will be skipped", e)
        fx = {"EUR": 1.0}

    run_id = dbmod.start_scrape_run(setup_conn, shop, country_filter, limit)
    setup_conn.close()

    workers = max(1, min(parallel, len(scs)))
    console.print(
        f"[bold]Scraping[/bold] {len(pairs)} products × {len(scs)} countries  "
        f"[dim]run #{run_id} · backend={Fetcher().render_backend} · parallel={workers}[/dim]"
    )

    started = time.monotonic()
    results: list[tuple[str, str, str, str, Optional[list[str]]]] = []

    if workers == 1:
        # Strict sequential — same behaviour as before parallelism was added.
        for sc in scs:
            results.extend(_scrape_country(shop, sc, pairs, fx, run_id))
    else:
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="euprice-cty") as pool:
            futures = {
                pool.submit(_scrape_country, shop, sc, pairs, fx, run_id): sc.country_code
                for sc in scs
            }
            for fut in as_completed(futures):
                cc = futures[fut]
                try:
                    country_rows = fut.result()
                except Exception as e:  # noqa: BLE001
                    log.exception("Country %s failed: %s", cc, e)
                    console.print(f"  [red]✗ {cc} ERROR[/red] {type(e).__name__}: {e}")
                    continue
                results.extend(country_rows)
                ok = sum(1 for r in country_rows if r[3] in ("ok", "promo"))
                color = "green" if ok == len(country_rows) else "yellow"
                console.print(
                    f"  [{color}]✓ {cc}[/{color}] {ok}/{len(country_rows)} ok "
                    f"[dim]({time.monotonic() - started:5.1f}s elapsed)[/dim]"
                )

    elapsed = time.monotonic() - started

    # ---- finalize + display ------------------------------------------------
    finish_conn = dbmod.connect()
    dbmod.finish_scrape_run(finish_conn, run_id)
    finish_conn.close()

    results.sort(key=lambda r: (r[0], r[1], r[2]))
    table = Table(title=f"{shop.upper()} scrape — run #{run_id} ({elapsed:.1f}s)")
    for col in ("Country", "Producer", "Product", "EUR", "Local", "Status"):
        table.add_column(col)
    for cc, producer, name, status, row in results:
        if row:
            table.add_row(*row)
        else:
            table.add_row(cc, producer, name[:38], "-", "-", status)
    console.print(table)

    # Quick totals
    n_ok = sum(1 for r in results if r[3] == "ok")
    n_promo = sum(1 for r in results if r[3] == "promo")
    n_miss = sum(1 for r in results if r[3] == "no match")
    n_err = sum(1 for r in results if r[3] not in ("ok", "promo", "no match"))
    console.print(
        f"[bold]Done[/bold] in [bold]{elapsed:.1f}s[/bold]: "
        f"[green]{n_ok}[/green] ok · [magenta]{n_promo}[/magenta] promo · "
        f"[yellow]{n_miss}[/yellow] no-match · [red]{n_err}[/red] errors  "
        f"({len(results)} attempts)"
    )


# ============================================================== workers

def _scrape_country(
    shop_code: str,
    sc: ShopCountry,
    pairs: list[tuple[ProductSpec, int]],
    fx: dict[str, float],
    run_id: int,
) -> list[tuple[str, str, str, str, Optional[list[str]]]]:
    """Scrape all products for one (shop, country) sequentially. Thread-safe entry point.

    Owns:
        * a private SQLite connection (coordinated with peers via WAL mode)
        * a private Fetcher, which owns a private Playwright Chromium when rendering

    Returns one (country_code, producer, name, status, row_for_table) tuple per product.
    """
    spider_cls = SPIDER_REGISTRY[shop_code]
    conn = dbmod.connect()
    fetcher = Fetcher(min_delay_seconds=1.5)
    spider = spider_cls(fetcher=fetcher)
    out: list[tuple[str, str, str, str, Optional[list[str]]]] = []
    try:
        for spec, product_id in pairs:
            status, row = _scrape_one(conn, spider, spec, product_id, sc, fx, run_id)
            out.append((sc.country_code, spec.producer, spec.name, status, row))
    finally:
        spider.close()
        conn.close()
    return out


def _scrape_one(
    conn, spider: Spider, spec: ProductSpec, product_id: int,
    sc: ShopCountry, fx: dict[str, float], run_id: int,
) -> tuple[str, Optional[list[str]]]:
    """Scrape one product on one country, persist, return status + table row."""
    try:
        scrape = spider.scrape(spec, sc)
    except Exception as e:  # noqa: BLE001
        log.exception("Spider error for %s/%s/%s", sc.country_code, spec.producer, spec.name)
        dbmod.log_scrape_attempt(
            conn, run_id, product_id, sc.country_code,
            status="error", error_class=type(e).__name__, error_msg=str(e)[:500],
        )
        conn.commit()
        return f"ERROR {type(e).__name__}", None
    if scrape is None:
        dbmod.log_scrape_attempt(conn, run_id, product_id, sc.country_code, status="no_match")
        conn.commit()
        return "no match", None

    rate = fx.get(scrape.currency_code)
    if rate is None:
        dbmod.log_scrape_attempt(
            conn, run_id, product_id, sc.country_code,
            status="no_fx", error_msg=f"no FX rate for {scrape.currency_code}",
        )
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
        dbmod.log_scrape_attempt(
            conn, run_id, product_id, sc.country_code,
            status=status, price_id=price_id,
        )

    return status, [
        sc.country_code,
        spec.producer,
        (scrape.product_name_local or spec.name)[:38],
        f"{price_eur:.2f}",
        f"{scrape.price_local:.2f} {scrape.currency_code}",
        status,
    ]


if __name__ == "__main__":
    app()
