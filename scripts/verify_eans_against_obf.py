"""Verify every EAN in the DB against Open Beauty Facts.

OBF (Open Beauty Facts) is a community-maintained EAN-13 → product registry
for cosmetic / personal-care SKUs. It is the closest thing to a free, public,
external check on the identity claims of our scraped data.

What this script does
---------------------
For every `product.ean` in the DB:
    1. Query https://world.openbeautyfacts.org/api/v2/product/<ean>.json
    2. Classify the response:
       - HIT      : OBF has brand and/or product_name. Compare to our DB
                    fields (producer, size_value+size_unit). If they agree,
                    log severity='info' with a confirmation message. If they
                    disagree, log severity='warning' with the discrepancy.
       - STUB     : OBF knows the EAN but has no metadata. Weak positive
                    (someone scanned it once); log severity='info'.
       - MISS     : OBF returns 404 or status!=1. The EAN is simply not in
                    their catalogue yet. Log severity='info'.
       - ERROR    : Transport-level failure; logged but won't classify.
    3. Persist every row to `data_quality_log` (append-only).

Why we log even MISS entries
----------------------------
OBF is not a complete registry; private-label drugstore SKUs (Balea, Dontodent,
Babylove) have low coverage. The point of recording every row — including
"not in OBF" — is to surface the *coverage* itself as data. Visitors and
journalists can then see "4/29 EANs externally verified; 21/29 not yet in OBF"
rather than infer silence as confirmation.

Rate limiting
-------------
OBF asks ~100 req/min for non-app traffic. We use 0.75 s between requests
(~80/min) to stay polite. ~30 EANs takes about 25 seconds.

Usage
-----
    python scripts/verify_eans_against_obf.py
    python scripts/verify_eans_against_obf.py --limit 5     # debug
    python scripts/verify_eans_against_obf.py --dry-run     # don't write
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "db" / "eu_prices.db"
USER_AGENT = "EUPRICE/1.0 (research; https://github.com/ZsoltKralik/EUPRICE)"
OBF_URL_TEMPLATE = "https://world.openbeautyfacts.org/api/v2/product/{ean}.json"
THROTTLE_SECONDS = 0.75

_QUANTITY_NUM_RE = re.compile(r"(\d+[.,]?\d*)\s*(ml|l|g|kg|pcs?|pieces?|st(?:ü|u)ck|stk\.?)", re.IGNORECASE)


def fetch_obf(ean: str, timeout: float = 15.0) -> tuple[str, dict | None, int]:
    """Return (classification, payload_dict_or_None, http_status_for_logs).

    classification ∈ {"hit","stub","miss","error"}
    """
    url = OBF_URL_TEMPLATE.format(ean=ean)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
    except urllib.error.HTTPError as e:
        return ("miss" if e.code == 404 else "error", None, e.code)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        return ("error", {"exception": type(e).__name__, "msg": str(e)[:200]}, 0)
    if data.get("status") != 1:
        return ("miss", data, 200)
    product = data.get("product") or {}
    brand = (product.get("brands") or "").strip()
    name = (product.get("product_name") or product.get("generic_name") or "").strip()
    if brand or name:
        return ("hit", product, 200)
    return ("stub", product, 200)


def normalise_quantity_to_canonical(quantity: str) -> tuple[float, str] | None:
    """Parse OBF quantity string ('200 ml', '90 g', '40 pcs') → (value, canonical_unit).

    Canonical units: 'ml' (volume), 'g' (weight), 'piece' (count).
    """
    if not quantity:
        return None
    m = _QUANTITY_NUM_RE.search(quantity)
    if not m:
        return None
    try:
        v = float(m.group(1).replace(",", "."))
    except ValueError:
        return None
    u = m.group(2).lower()
    if u == "l":
        return (v * 1000.0, "ml")
    if u == "kg":
        return (v * 1000.0, "g")
    if u.startswith(("ml",)):
        return (v, "ml")
    if u.startswith(("g",)):
        return (v, "g")
    return (v, "piece")


def db_canonical(size_value: float | None, size_unit: str | None) -> tuple[float, str] | None:
    if not size_value or not size_unit:
        return None
    u = size_unit.lower()
    v = float(size_value)
    if u == "l":
        return (v * 1000.0, "ml")
    if u == "kg":
        return (v * 1000.0, "g")
    if u in ("ml", "g", "piece"):
        return (v, u)
    return None


def producer_token(producer: str) -> str:
    """First non-trivial token of a producer name, lowercased.

    'Balea med' → 'balea'   'Dontodent' → 'dontodent'   'babylove' → 'babylove'
    """
    if not producer:
        return ""
    parts = producer.lower().split()
    return parts[0] if parts else ""


def compare(product_row: dict, obf: dict) -> tuple[str, str, dict]:
    """Compare DB row to OBF product. Return (severity, message, details).

    severity ∈ {'info','warning'}.
    """
    db_producer = (product_row["producer"] or "").lower()
    db_name = (product_row["name"] or "").lower()
    db_pt = producer_token(product_row["producer"])
    obf_brand = (obf.get("brands") or "").strip()
    obf_name = (obf.get("product_name") or obf.get("generic_name") or "").strip()
    obf_qty = (obf.get("quantity") or "").strip()

    details = {
        "obf_brand": obf_brand,
        "obf_name": obf_name,
        "obf_quantity": obf_qty,
        "db_producer": product_row["producer"],
        "db_name": product_row["name"],
        "db_size": (
            f"{product_row['size_value']:g} {product_row['size_unit']}"
            if product_row["size_value"] else None
        ),
    }

    problems: list[str] = []

    # Brand check: producer token must appear (case-insensitive) somewhere in
    # OBF's brand OR name string. OBF often lists multiple brands comma-separated.
    haystack = f"{obf_brand} {obf_name}".lower()
    if db_pt and db_pt not in haystack:
        # Handle two special aliases. 'Donto dent' (with a space) is how OBF
        # spells 'dontodent'; collapse to compare.
        compressed_haystack = haystack.replace(" ", "")
        if db_pt not in compressed_haystack:
            problems.append(
                f"OBF brand/name {obf_brand!r}/{obf_name!r} doesn't contain producer token {db_pt!r}"
            )

    # Size check: only if both sides parse cleanly. Tolerate ±15 % so a
    # rounded OBF quantity ("400 ml" vs "0,4 l") doesn't false-positive.
    db_canon = db_canonical(product_row["size_value"], product_row["size_unit"])
    obf_canon = normalise_quantity_to_canonical(obf_qty) if obf_qty else None
    if db_canon and obf_canon:
        details["db_canonical"] = f"{db_canon[0]:g} {db_canon[1]}"
        details["obf_canonical"] = f"{obf_canon[0]:g} {obf_canon[1]}"
        # OBF placeholder guard: a "1pcs"/"1 piece"/"1 unit" quantity on a product
        # that DB knows is sold by volume or weight is an uninformative default in
        # the OBF record, NOT a genuine size disagreement. Crowd-sourced OBF entries
        # frequently leave the quantity field at this placeholder. Treat it as
        # informational rather than a warning when brand+name already agree.
        obf_is_placeholder = obf_canon == (1.0, "piece") and db_canon[1] in ("ml", "g")
        if obf_is_placeholder:
            details["obf_quantity_placeholder"] = True
        elif db_canon[1] != obf_canon[1]:
            problems.append(
                f"OBF unit category {obf_canon[1]} differs from DB {db_canon[1]}"
            )
        else:
            spread = abs(obf_canon[0] - db_canon[0]) / max(db_canon[0], 1e-6)
            if spread > 0.15:
                problems.append(
                    f"OBF size {obf_canon[0]:g}{obf_canon[1]} > 15% from DB {db_canon[0]:g}{db_canon[1]}"
                )

    if problems:
        return ("warning", " · ".join(problems), details)
    msg_parts = []
    if obf_brand:
        msg_parts.append(f"brand={obf_brand}")
    if obf_name:
        msg_parts.append(f"name={obf_name}")
    if obf_qty:
        msg_parts.append(f"qty={obf_qty}")
    msg = "OBF confirms " + (", ".join(msg_parts) if msg_parts else "EAN known")
    return ("info", msg, details)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--limit", type=int, default=None, help="Only check first N products")
    ap.add_argument("--dry-run", action="store_true", help="Don't write to data_quality_log")
    args = ap.parse_args(argv)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = list(conn.execute("""
        SELECT p.id, p.ean, pd.name AS producer, p.name, p.size_value, p.size_unit
        FROM product p
        JOIN producer pd ON pd.id = p.producer_id
        WHERE p.ean IS NOT NULL
        ORDER BY p.id
    """))
    if args.limit:
        rows = rows[:args.limit]
    if not rows:
        print("No products with EANs in DB.", file=sys.stderr)
        return 1

    counts = {"hit_confirmed": 0, "hit_warning": 0, "stub": 0, "miss": 0, "error": 0}
    print(f"Checking {len(rows)} EANs against OBF (throttle={THROTTLE_SECONDS}s)...")
    print()
    log_rows: list[tuple] = []

    for i, row in enumerate(rows, 1):
        ean = row["ean"]
        classification, payload, http_code = fetch_obf(ean)
        product_id = row["id"]
        details: dict = {"http_status": http_code, "classification": classification}

        if classification == "miss":
            severity = "info"
            message = "EAN not found in Open Beauty Facts (private-label SKUs often uncatalogued)"
            counts["miss"] += 1
            mark = "MISS"
        elif classification == "error":
            severity = "info"
            message = f"OBF API error: {(payload or {}).get('exception', 'unknown')}"
            details.update(payload or {})
            counts["error"] += 1
            mark = "ERR "
        elif classification == "stub":
            severity = "info"
            message = "EAN known to OBF but no brand/name metadata yet"
            counts["stub"] += 1
            mark = "STUB"
        else:  # hit
            severity, message, cmp_details = compare(dict(row), payload or {})
            details.update(cmp_details)
            if severity == "info":
                counts["hit_confirmed"] += 1
                mark = "OK  "
            else:
                counts["hit_warning"] += 1
                mark = "WARN"

        # Trim payload — we don't need the giant OBF blob, only what we summarised.
        details_json = json.dumps(details, ensure_ascii=False)[:2000]

        print(f"[{i:2d}/{len(rows)}] {mark} {ean} | {row['producer']:20s} {row['name'][:32]:32s} | {message[:80]}")
        log_rows.append((
            "obf", severity, ean, product_id, message, details_json,
        ))
        time.sleep(THROTTLE_SECONDS)

    print()
    print(f"Coverage: {counts['hit_confirmed']} confirmed · {counts['hit_warning']} warning · "
          f"{counts['stub']} stub · {counts['miss']} miss · {counts['error']} error")

    if args.dry_run:
        print("--dry-run: not writing to data_quality_log.")
        return 0

    cur = conn.cursor()
    cur.executemany(
        "INSERT INTO data_quality_log (source, severity, ean, product_id, message, details_json) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        log_rows,
    )
    conn.commit()
    print(f"Wrote {cur.rowcount} rows to data_quality_log.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
