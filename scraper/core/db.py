"""SQLite storage layer. All DDL/DML lives here; spiders never touch SQL."""
from __future__ import annotations

import csv
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from .models import ProductSpec, ScrapedPrice, ShopCountry

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "db" / "eu_prices.db"
SCHEMA_PATH = REPO_ROOT / "db" / "schema.sql"
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
PRODUCTS_CSV_PATH = REPO_ROOT / "data" / "products.csv"


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db(db_path: Path = DB_PATH) -> None:
    """Apply schema + all migrations. Idempotent via PRAGMA user_version.

    Migrations are named `NNN_description.sql`; once applied, `user_version`
    is bumped to NNN and subsequent runs skip them. This lets migrations
    contain non-idempotent DDL like ALTER TABLE without breaking re-runs.
    """
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    with transaction(conn):
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    current = conn.execute("PRAGMA user_version").fetchone()[0]
    for mig in sorted(MIGRATIONS_DIR.glob("*.sql")):
        try:
            version = int(mig.name.split("_", 1)[0])
        except ValueError:
            continue
        if version <= current:
            continue
        with transaction(conn):
            conn.executescript(mig.read_text(encoding="utf-8"))
            conn.execute(f"PRAGMA user_version = {version}")
    conn.close()


# ----------------------------------------------------------------------- read

def get_shop_countries(conn: sqlite3.Connection, shop_code: str,
                       country_codes: Optional[list[str]] = None) -> list[ShopCountry]:
    q = """
        SELECT s.id   AS shop_id,
               s.code AS shop_code,
               s.name AS shop_name,
               c.code AS country_code,
               c.name AS country_name,
               sc.base_url,
               c.currency_code,
               c.vat_standard_rate,
               c.vat_food_rate
        FROM shop_country sc
        JOIN shop    s ON s.id = sc.shop_id
        JOIN country c ON c.code = sc.country_code
        WHERE s.code = ? AND sc.active = 1
    """
    params: list = [shop_code]
    if country_codes:
        placeholders = ",".join("?" * len(country_codes))
        q += f" AND c.code IN ({placeholders})"
        params.extend(country_codes)
    q += " ORDER BY c.code"
    return [ShopCountry(**dict(row)) for row in conn.execute(q, params)]


# ---------------------------------------------------------------- products.csv

def load_products_csv(path: Path = PRODUCTS_CSV_PATH) -> list[ProductSpec]:
    rows: list[ProductSpec] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            rows.append(ProductSpec(
                producer=row["producer"].strip(),
                name=row["name"].strip(),
                name_en=(row.get("name_en") or "").strip() or None,
                size_value=float(row["size_value"]) if row.get("size_value") else None,
                size_unit=(row.get("size_unit") or "").strip() or None,
                category=row["category"].strip(),
                subcategory=(row.get("subcategory") or "").strip() or None,
                search_hint=row["search_hint"].strip(),
                ean=(row.get("ean") or "").strip() or None,
                canonical_url=(row.get("canonical_url") or "").strip() or None,
                notes=(row.get("notes") or "").strip() or None,
            ))
    return rows


def sync_products(conn: sqlite3.Connection, specs: list[ProductSpec]) -> list[int]:
    """Upsert producer + product rows from the CSV. Returns one product_id per spec."""
    ids: list[int] = []
    with transaction(conn):
        for s in specs:
            conn.execute("INSERT OR IGNORE INTO producer (name) VALUES (?)", (s.producer,))
            producer_id = conn.execute(
                "SELECT id FROM producer WHERE name = ?", (s.producer,)
            ).fetchone()["id"]
            # Try update first (matches on the natural key); else insert.
            cur = conn.execute(
                """
                UPDATE product
                SET name_en       = COALESCE(?, name_en),
                    category      = ?,
                    subcategory   = ?,
                    search_hint   = ?,
                    ean           = COALESCE(?, ean),
                    canonical_url = COALESCE(?, canonical_url),
                    notes         = ?
                WHERE producer_id = ? AND name = ?
                  AND COALESCE(size_value, -1) = COALESCE(?, -1)
                  AND COALESCE(size_unit, '')  = COALESCE(?, '')
                """,
                (s.name_en, s.category, s.subcategory, s.search_hint, s.ean,
                 s.canonical_url, s.notes,
                 producer_id, s.name, s.size_value, s.size_unit),
            )
            if cur.rowcount == 0:
                cur = conn.execute(
                    """
                    INSERT INTO product
                        (ean, producer_id, name, name_en, size_value, size_unit,
                         category, subcategory, search_hint, canonical_url, notes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (s.ean, producer_id, s.name, s.name_en, s.size_value, s.size_unit,
                     s.category, s.subcategory, s.search_hint, s.canonical_url, s.notes),
                )
                ids.append(cur.lastrowid)
            else:
                pid = conn.execute(
                    """
                    SELECT id FROM product
                    WHERE producer_id = ? AND name = ?
                      AND COALESCE(size_value, -1) = COALESCE(?, -1)
                      AND COALESCE(size_unit, '')  = COALESCE(?, '')
                    """,
                    (producer_id, s.name, s.size_value, s.size_unit),
                ).fetchone()["id"]
                ids.append(pid)
    return ids


# ----------------------------------------------------------- product/EAN reconcile

def attach_ean_to_product(conn: sqlite3.Connection, product_id: int, ean: str) -> None:
    """Set the EAN on a product if not already set. No-op if a different product already owns this EAN."""
    existing = conn.execute("SELECT id FROM product WHERE ean = ?", (ean,)).fetchone()
    if existing and existing["id"] != product_id:
        return  # another product already has this EAN; don't clobber
    conn.execute("UPDATE product SET ean = ? WHERE id = ? AND (ean IS NULL OR ean = '')",
                 (ean, product_id))


def attach_image_to_product(conn: sqlite3.Connection, product_id: int, image_url: str) -> None:
    """Set image_url on a product if not already set."""
    conn.execute(
        "UPDATE product SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')",
        (image_url, product_id),
    )


def attach_canonical_url_to_product(conn: sqlite3.Connection, product_id: int, url: str) -> None:
    """Set canonical_url on a product if not already set. Typically the DM Germany page URL."""
    conn.execute(
        "UPDATE product SET canonical_url = ? WHERE id = ? AND (canonical_url IS NULL OR canonical_url = '')",
        (url, product_id),
    )


# -------------------------------------------------------------- scrape logging

def start_scrape_run(conn: sqlite3.Connection, shop_code: str,
                     countries: Optional[list[str]], products_limit: Optional[int]) -> int:
    cur = conn.execute(
        """
        INSERT INTO scrape_run (shop_code, countries, products_limit)
        VALUES (?, ?, ?)
        """,
        (shop_code, ",".join(countries) if countries else None, products_limit),
    )
    conn.commit()
    return cur.lastrowid


def log_scrape_attempt(
    conn: sqlite3.Connection,
    run_id: int,
    product_id: Optional[int],
    country_code: str,
    status: str,
    error_class: Optional[str] = None,
    error_msg: Optional[str] = None,
    price_id: Optional[int] = None,
) -> None:
    conn.execute(
        """
        INSERT INTO scrape_attempt
            (run_id, product_id, country_code, status, error_class, error_msg, price_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (run_id, product_id, country_code, status, error_class, error_msg, price_id),
    )


def finish_scrape_run(conn: sqlite3.Connection, run_id: int) -> None:
    conn.execute(
        """
        UPDATE scrape_run
        SET finished_at = datetime('now'),
            products_total    = (SELECT COUNT(*) FROM scrape_attempt WHERE run_id = ?),
            products_ok       = (SELECT COUNT(*) FROM scrape_attempt WHERE run_id = ? AND status = 'ok'),
            products_promo    = (SELECT COUNT(*) FROM scrape_attempt WHERE run_id = ? AND status = 'promo'),
            products_no_match = (SELECT COUNT(*) FROM scrape_attempt WHERE run_id = ? AND status = 'no_match'),
            products_error    = (SELECT COUNT(*) FROM scrape_attempt WHERE run_id = ? AND status NOT IN ('ok','promo','no_match'))
        WHERE id = ?
        """,
        (run_id, run_id, run_id, run_id, run_id, run_id),
    )
    conn.commit()


# ----------------------------------------------------------- price inserts

def insert_price(
    conn: sqlite3.Connection,
    product_id: int,
    shop_id: int,
    country_code: str,
    scrape: ScrapedPrice,
    price_eur: float,
    fx_rate: Optional[float],
    regular_price_eur: Optional[float] = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO price
            (product_id, shop_id, country_code, parsed_at, url,
             product_name_local, price_local, currency_code, price_eur, fx_rate,
             is_promo, regular_price_local, regular_price_eur,
             raw_html_sha256, raw_html_path, scraped_ean)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            product_id,
            shop_id,
            country_code,
            scrape.parsed_at.isoformat(timespec="seconds"),
            scrape.url,
            scrape.product_name_local,
            scrape.price_local,
            scrape.currency_code,
            price_eur,
            fx_rate,
            int(scrape.is_promo),
            scrape.regular_price_local,
            regular_price_eur,
            scrape.raw_html_sha256,
            scrape.raw_html_path,
            scrape.ean,
        ),
    )
    return cur.lastrowid
