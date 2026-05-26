"""Audit cross-retailer EAN agreement.

For every product that has price observations at TWO OR MORE retailers in
at least one shared country, this script verifies the scraped EAN-13 agrees
across retailers. Any disagreement is logged to `data_quality_log` with
severity='warning' (or 'error' when the producer name also disagrees).

Why this matters
----------------
Until Phase A.1, every identity claim in the dataset rested on a single
source: DM's own JSON-LD gtin13. Now that Müller is also a witness, the
two retailers' independently-observed EANs must agree. If they ever don't,
it's a real research finding — either DM or Müller is wrong about that
SKU's identity, and the consumer-price comparison for that row is suspect.

What this script does
---------------------
1. Build the set of (product_id, country_code, shop_code) → (scraped_ean,
   product_name_local) from `price` rows (most recent per cell).
2. For each (product_id, country_code) with ≥2 distinct shops, compare the
   scraped EANs.
3. Classify:
     AGREE       — every retailer in this (product, country) observed the
                   same EAN. Log info row.
     EAN_DIFFER  — retailers observed different EANs. Warning.
     EAN_MISSING — one retailer's scraped_ean is NULL (older row pre-
                   migration 003 or scrape failed mid-way). Info.
4. Roll up: how many products are now cross-retailer verified in ≥1 country.

Output: human-readable summary + appends rows to data_quality_log.
Exit code: 0 if no disagreements, 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="Don't write to data_quality_log")
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    rows = list(conn.execute("""
        SELECT v.product_id, v.country_code, v.shop_code, v.scraped_ean, v.ean,
               v.product_name, v.producer, v.product_name_local
        FROM v_latest_prices v
        WHERE v.is_sample = 0
        ORDER BY v.product_id, v.country_code, v.shop_code
    """))

    # Group by (product_id, country_code) → list of (shop_code, scraped_ean, name)
    grid: dict[tuple[int, str], list[sqlite3.Row]] = {}
    for r in rows:
        key = (r["product_id"], r["country_code"])
        grid.setdefault(key, []).append(r)

    cross_observed = {k: v for k, v in grid.items() if len({r["shop_code"] for r in v}) >= 2}

    print(f"Cross-retailer cells (≥2 shops in same country): {len(cross_observed)}")
    if not cross_observed:
        print()
        print("Nothing to audit. Add a second retailer's prices for a shared country.")
        return 0

    log_rows: list[tuple] = []
    agree, ean_differ, ean_missing = 0, 0, 0
    verified_products: set[int] = set()
    differing_products: set[int] = set()

    print()
    print("Per-cell verification:")
    print()
    for (pid, cc), shops in sorted(cross_observed.items()):
        canonical = shops[0]
        eans = {r["scraped_ean"] for r in shops}
        eans_present = {e for e in eans if e}
        shop_list = ", ".join(sorted(r["shop_code"] for r in shops))
        product_label = f"#{pid} {canonical['producer']:12s} {canonical['product_name'][:28]:28s}"

        if not eans_present:
            ean_missing += 1
            print(f"  ?    {product_label} {cc} [{shop_list}] — no scraped EAN on any retailer")
            log_rows.append((
                "cross_retailer", "info", canonical["ean"], pid,
                f"No scraped EAN at any retailer in {cc}",
                json.dumps({"country": cc, "shops": sorted(r["shop_code"] for r in shops)}),
            ))
        elif len(eans_present) == 1:
            agree += 1
            verified_products.add(pid)
            ean = next(iter(eans_present))
            agrees_with_canonical = ean == canonical["ean"]
            mark = "OK  " if agrees_with_canonical else "OK* "
            tail = "" if agrees_with_canonical else f" (note: differs from canonical {canonical['ean']})"
            print(f"  {mark} {product_label} {cc} [{shop_list}] — all observed EAN {ean}{tail}")
            log_rows.append((
                "cross_retailer", "info", ean, pid,
                f"{len(shops)} retailers agree on EAN {ean} in {cc}",
                json.dumps({
                    "country": cc,
                    "shops": sorted(r["shop_code"] for r in shops),
                    "agrees_with_canonical": agrees_with_canonical,
                }),
            ))
        else:
            ean_differ += 1
            differing_products.add(pid)
            per_shop = {r["shop_code"]: r["scraped_ean"] for r in shops}
            print(f"  WARN {product_label} {cc} [{shop_list}] — disagreement: {per_shop}")
            log_rows.append((
                "cross_retailer", "warning", canonical["ean"], pid,
                f"Retailer EAN disagreement in {cc}: {per_shop}",
                json.dumps({"country": cc, "per_shop": per_shop}),
            ))

    print()
    print(f"Summary: {agree} agree · {ean_differ} differ · {ean_missing} missing")
    print(f"Unique products with ≥1 cross-retailer-verified country: {len(verified_products)}")
    if differing_products:
        print(f"Products with ANY retailer disagreement: {sorted(differing_products)}")

    if args.dry_run:
        print()
        print("--dry-run: not writing to data_quality_log.")
        return 1 if ean_differ else 0

    cur = conn.cursor()
    cur.executemany(
        "INSERT INTO data_quality_log (source, severity, ean, product_id, message, details_json) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        log_rows,
    )
    conn.commit()
    print(f"Wrote {cur.rowcount} cross_retailer rows to data_quality_log.")
    return 1 if ean_differ else 0


if __name__ == "__main__":
    sys.exit(main())
