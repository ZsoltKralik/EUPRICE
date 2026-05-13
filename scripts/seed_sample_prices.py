"""Seed plausible-but-fake price rows so the web app shows something.

Wipes any existing rows with `parsed_at` >= today (so re-running is idempotent).
Real scrapes from later today will land alongside these — flag them as sample
by the placeholder URL pattern (`sample://...`) if you want to filter later.

Spreads are realistic-ish (sources: occasional in-store observations, dm.de
catalog reference prices). They show the *direction* the case study cares
about: identical SKUs cost less in low-wage countries by absolute EUR but more
in minutes-of-work.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"

# Per-country (currency, fx-rate-per-eur). Matches the ECB feed roughly for 2026-05.
COUNTRIES: dict[str, tuple[str, float]] = {
    "DE": ("EUR", 1.0),
    "AT": ("EUR", 1.0),
    "SK": ("EUR", 1.0),
    "CZ": ("CZK", 25.05),
    "HU": ("HUF", 388.50),
    "PL": ("PLN", 4.27),
    "SI": ("EUR", 1.0),
    "HR": ("EUR", 1.0),
    "RO": ("RON", 4.97),
    "BG": ("BGN", 1.95583),
    "IT": ("EUR", 1.0),  # for the Tigotà comparison once we add it
}

# Sample shelf prices in EUR. Conversion to local currency happens below.
# Each row: producer + name + (country -> price_eur, optional promo info)
SAMPLE_PRICES: list[dict] = [
    {  # Balea micellar water — DM private label, modest spread
        "producer": "Balea", "name": "Mizellenwasser 3in1 Rose", "size": (400, "ml"),
        "shop": "dm", "image": "https://media.dm.de/products/balea-mizellenwasser-rose.jpg",
        "by_country": {
            "DE": 2.95, "AT": 2.95, "SK": 3.39, "CZ": 2.65, "HU": 2.80,
            "PL": 3.20, "SI": 3.15, "HR": 3.49, "RO": 3.00, "BG": 2.91,
        },
    },
    {  # Balea bodylotion — bigger spread
        "producer": "Balea", "name": "Bodylotion Aloe Vera", "size": (500, "ml"),
        "shop": "dm", "image": "https://media.dm.de/products/balea-bodylotion-aloe.jpg",
        "by_country": {
            "DE": 2.45, "AT": 2.45, "SK": 2.99, "CZ": 2.20,
            "HU": 2.55, "PL": 2.95, "SI": 2.69, "BG": 2.70,
        },
    },
    {  # Nivea Creme — international brand, more variation
        "producer": "Nivea", "name": "Creme", "size": (150, "ml"),
        "shop": "dm", "image": "https://media.dm.de/products/nivea-creme-150.jpg",
        "by_country": {
            "DE": 3.75, "AT": 3.95, "SK": 4.49, "CZ": 4.10, "HU": 4.85,
            "PL": 4.20, "SI": 4.25, "HR": 4.79, "RO": 4.30, "BG": 4.05,
        },
        "promo": {"AT": 2.95},  # AT on promo, regular 3.95
    },
    {  # Garnier micellar — bigger international-brand spread
        "producer": "Garnier", "name": "SkinActive Mizellen-Reinigungswasser", "size": (400, "ml"),
        "shop": "dm", "image": "https://media.dm.de/products/garnier-mizellen-400.jpg",
        "by_country": {
            "DE": 4.45, "AT": 4.95, "SK": 5.79, "CZ": 5.20, "HU": 5.95,
            "PL": 5.50, "SI": 5.25, "RO": 5.40,
        },
    },
    {  # Dontodent — DM private label
        "producer": "Dontodent", "name": "Zahncreme Classic", "size": (125, "ml"),
        "shop": "dm", "image": "https://media.dm.de/products/dontodent-classic.jpg",
        "by_country": {
            "DE": 0.65, "AT": 0.85, "SK": 0.99, "CZ": 0.75,
            "HU": 0.90, "PL": 1.05, "SI": 0.95,
        },
    },
    {  # Denkmit dishwasher tabs
        "producer": "Denkmit", "name": "Geschirrspül-Tabs All in One", "size": (40, "piece"),
        "shop": "dm", "image": "https://media.dm.de/products/denkmit-tabs-40.jpg",
        "by_country": {
            "DE": 4.45, "AT": 4.45, "SK": 5.29, "CZ": 4.80,
            "HU": 5.50, "PL": 5.10, "SI": 4.99, "HR": 5.79,
        },
    },
    {  # alverde shampoo
        "producer": "alverde", "name": "Feuchtigkeitsshampoo", "size": (200, "ml"),
        "shop": "dm", "image": "https://media.dm.de/products/alverde-shampoo-200.jpg",
        "by_country": {
            "DE": 1.95, "AT": 2.25, "SK": 2.49, "CZ": 2.15,
            "HU": 2.55, "PL": 2.45, "SI": 2.39, "RO": 2.50,
        },
    },
    {  # Labello — iconic, identical EAN across EU
        "producer": "Labello", "name": "Original Lippenpflege", "size": (4.8, "g"),
        "shop": "dm", "image": "https://media.dm.de/products/labello-original.jpg",
        "by_country": {
            "DE": 1.45, "AT": 1.75, "SK": 1.99, "CZ": 1.85, "HU": 2.10,
            "PL": 1.95, "SI": 1.89, "HR": 2.15, "RO": 1.99, "BG": 1.79,
        },
    },
    {  # L'Oreal Elseve shampoo
        "producer": "L'Oreal", "name": "Elseve Color Vive Shampoo", "size": (250, "ml"),
        "shop": "dm", "image": "https://media.dm.de/products/loreal-elseve-color.jpg",
        "by_country": {
            "DE": 3.25, "AT": 3.95, "SK": 4.79, "CZ": 4.35,
            "PL": 4.50, "SI": 4.49, "RO": 4.60,
        },
        "promo": {"DE": 2.49},  # DE on promo, regular 3.25
    },
]


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"DB not found at {DB} — run init-db first.")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # Build name -> product_id lookup
    products = {(r["producer"], r["name"]): r["product_id"]
                for r in conn.execute("""
                    SELECT pd.name AS producer, p.name, p.id AS product_id
                    FROM product p
                    JOIN producer pd ON pd.id = p.producer_id
                """)}
    shops = {r["code"]: r["id"] for r in conn.execute("SELECT id, code FROM shop")}

    # Wipe prior sample rows (urls starting with sample://) so this is idempotent.
    conn.execute("DELETE FROM price WHERE url LIKE 'sample://%'")
    conn.commit()

    inserted = 0
    for entry in SAMPLE_PRICES:
        pid = products.get((entry["producer"], entry["name"]))
        if pid is None:
            print(f"  skip {entry['producer']} {entry['name']!r} — not in product table")
            continue
        shop_id = shops.get(entry["shop"])
        if shop_id is None:
            continue

        # Attach image URL on the product row (idempotent, no-op if already set)
        if entry.get("image"):
            conn.execute(
                "UPDATE product SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')",
                (entry["image"], pid),
            )

        promo = entry.get("promo") or {}
        for cc, price_eur in entry["by_country"].items():
            cur, fx = COUNTRIES[cc]
            price_local = round(price_eur * fx, 2)
            is_promo = cc in promo
            promo_local = round(promo[cc] * fx, 2) if is_promo else None
            promo_eur = promo[cc] if is_promo else None

            # If on promo, the "current price" is the promo price; regular = the listed price.
            current_local = promo_local if is_promo else price_local
            current_eur = promo_eur if is_promo else price_eur
            regular_local = price_local if is_promo else None
            regular_eur = price_eur if is_promo else None

            conn.execute(
                """
                INSERT INTO price
                    (product_id, shop_id, country_code, parsed_at, url,
                     product_name_local, price_local, currency_code, price_eur, fx_rate,
                     is_promo, regular_price_local, regular_price_eur)
                VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (pid, shop_id, cc, f"sample://{entry['shop']}.{cc}/p/{pid}",
                 f"{entry['producer']} {entry['name']}",
                 current_local, cur, current_eur,
                 None if cur == "EUR" else fx,
                 int(is_promo), regular_local, regular_eur),
            )
            inserted += 1
    conn.commit()
    print(f"Inserted {inserted} sample price rows. All URLs start with 'sample://' so they're easy to wipe.")
    conn.close()


if __name__ == "__main__":
    main()
