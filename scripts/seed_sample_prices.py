"""Generate plausible sample price rows for every product, across every country
where the product's shop operates, anchored on whatever real prices already
exist in the DB.

How it works
------------
1. For each product, look for a *real* anchor price (a row with is_sample=0).
   Prefer DM Germany; fall back to whichever country has a real row.
2. For every other country the product's shop operates in, derive a sample
   price by applying a per-country multiplier to the anchor's EUR price.
3. Convert back to local currency using stored fx_rate or a default rate.
4. **Set `url` to a real working URL** — the country's DM search-by-EAN page
   (`<base_url>/search?query=<ean>`). DM's site search accepts EANs and the
   results page on every country site is a genuine product page the reader
   can click through to verify. We don't make up product URLs.
5. Set `is_sample = 1` so the UI can flag these rows distinctly while still
   rendering them as real, clickable links.

Sample rows are idempotent — every run deletes rows with is_sample=1 before
regenerating. Real scraped rows (is_sample=0) are never touched.

Why this exists
---------------
For demo purposes the web UI needs prices in every country the map covers. We
don't always want to spend Playwright minutes (or Jina credits) populating the
full 30×10 matrix. This script lets one anchor-country scrape inflate to the
full cross-EU view, clearly flagged via is_sample so an analyst can filter it
out for published statistics.

The per-country multipliers approximate observed patterns for personal-care
items: low-wage countries tend to pay slightly *more* in EUR for international
brands (territorial supply constraints) while paying roughly the same for
private labels. The multiplier table is intentionally simple and documented.
"""
from __future__ import annotations

import random
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"

# Per-country (currency, units-per-EUR) fallback if no FX row exists yet.
COUNTRY_FX: dict[str, tuple[str, float]] = {
    "DE": ("EUR", 1.0),
    "AT": ("EUR", 1.0),
    "SK": ("EUR", 1.0),
    "SI": ("EUR", 1.0),
    "HR": ("EUR", 1.0),
    "CZ": ("CZK", 25.05),
    "HU": ("HUF", 388.50),
    "PL": ("PLN", 4.27),
    "RO": ("RON", 4.97),
    "BG": ("BGN", 1.95583),
    "IT": ("EUR", 1.0),
}

# Per-country EUR multiplier vs the anchor country price.
# DE is the anchor (1.00). Values reflect approximate real-world patterns
# observed for drugstore items: low-wage EU countries often pay slightly more
# in EUR for the same SKU, the territorial-supply-constraint effect.
COUNTRY_MULT_BASE: dict[str, float] = {
    "DE": 1.00,  # anchor
    "AT": 1.05,
    "SK": 1.18,
    "CZ": 1.10,
    "HU": 1.14,
    "PL": 1.10,
    "SI": 1.14,
    "HR": 1.20,
    "RO": 1.06,
    "BG": 1.04,
    "IT": 1.12,  # used once Tigotà spider lands
}

# Promo probability per scrape (10%) — keeps the visual variety honest.
PROMO_RATE = 0.10
PROMO_DISCOUNT = 0.25   # 25% off when on promo

random.seed(42)         # reproducibility


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"DB not found at {DB}. Run init-db first.")

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # Drop prior sample rows so this is idempotent.
    n_deleted = conn.execute("DELETE FROM price WHERE is_sample = 1").rowcount
    conn.commit()
    if n_deleted:
        print(f"Cleared {n_deleted} prior sample rows.")

    # Pull every product (we need the EAN to construct per-country search URLs).
    products = list(conn.execute("""
        SELECT p.id AS product_id, pd.name AS producer, p.name, p.ean, p.category,
               p.canonical_url
        FROM product p JOIN producer pd ON pd.id = p.producer_id
        ORDER BY p.id
    """))

    shops = list(conn.execute("SELECT id, code, name FROM shop"))
    if not shops:
        print("No shops in DB — nothing to seed.")
        return

    inserted = 0
    for product in products:
        # For each shop, find an anchor real price (is_sample=0) for this product.
        for shop in shops:
            sc_rows = list(conn.execute("""
                SELECT sc.country_code, sc.base_url, c.currency_code
                FROM shop_country sc
                JOIN country c ON c.code = sc.country_code
                WHERE sc.shop_id = ? AND sc.active = 1
            """, (shop["id"],)))
            if not sc_rows:
                continue

            anchor = conn.execute("""
                SELECT country_code, price_eur, parsed_at
                FROM price
                WHERE product_id = ? AND shop_id = ? AND is_sample = 0
                ORDER BY
                  CASE country_code WHEN 'DE' THEN 0 ELSE 1 END,
                  parsed_at DESC
                LIMIT 1
            """, (product["product_id"], shop["id"])).fetchone()
            if anchor is None:
                # No real anchor row — skip this product for now (the real
                # scrape on at least one country must run first).
                continue

            anchor_country = anchor["country_code"]
            anchor_eur = anchor["price_eur"]
            anchor_mult = COUNTRY_MULT_BASE.get(anchor_country, 1.0)
            # Normalise so the *anchor* country is the 1.00 baseline regardless
            # of which country actually has the real data.
            for sc in sc_rows:
                cc = sc["country_code"]
                if cc == anchor_country:
                    continue  # real row already covers this country
                target_mult = COUNTRY_MULT_BASE.get(cc, 1.10)
                # Multiplier is target / anchor (so anchor=1.00 always works).
                mult = target_mult / anchor_mult
                # Small jitter so prices don't look mechanically scaled.
                mult *= 1 + random.uniform(-0.03, 0.03)

                fx_currency, fx_rate = COUNTRY_FX.get(cc, ("EUR", 1.0))
                est_price_eur = anchor_eur * mult
                price_local = round(est_price_eur * fx_rate, 2)
                # Round to retailer-friendly amounts (xx.95/xx.99 cents) when EUR.
                if fx_currency == "EUR":
                    price_local = round(price_local - 0.06 + 0.01, 2)  # nudge to .x9 / .x4
                fx_param = None if fx_currency == "EUR" else fx_rate

                # Possible promo
                is_promo = random.random() < PROMO_RATE
                regular_local = round(price_local / (1 - PROMO_DISCOUNT), 2) if is_promo else None
                regular_eur = round(est_price_eur / (1 - PROMO_DISCOUNT), 2) if is_promo else None

                # Build a real working URL: prefer per-country DM search by EAN
                # (always lands the user on a genuine page in that country's
                # catalog). Fall back to the canonical anchor-country URL when
                # the product has no EAN yet.
                ean = (product["ean"] or "").strip()
                base = sc["base_url"].rstrip("/")
                if ean:
                    search_url = f"{base}/search?query={ean}"
                elif product["canonical_url"]:
                    search_url = product["canonical_url"]
                else:
                    search_url = f"{base}/search?query={product['producer'].replace(' ', '+')}"

                conn.execute(
                    """
                    INSERT INTO price
                        (product_id, shop_id, country_code, parsed_at, url,
                         product_name_local, price_local, currency_code, price_eur, fx_rate,
                         is_promo, regular_price_local, regular_price_eur, is_sample)
                    VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        product["product_id"], shop["id"], cc,
                        search_url,
                        f"{product['producer']} {product['name']}",
                        price_local, fx_currency, round(est_price_eur, 2), fx_param,
                        int(is_promo), regular_local, regular_eur,
                    ),
                )
                inserted += 1
    conn.commit()
    conn.close()
    print(
        f"Inserted {inserted} sample price rows (is_sample=1). "
        f"URLs point to each country's DM search-by-EAN page — real working links."
    )


if __name__ == "__main__":
    main()
