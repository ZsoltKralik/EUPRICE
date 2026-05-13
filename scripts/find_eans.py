"""Find canonical EAN-13 codes for products via Open Beauty Facts / Open Food Facts.

Strategy:
    1. For each product, generate multiple progressively-broader search queries.
    2. For every hit from OBF/OFF, score by (a) token overlap with the seed name
       and (b) pack-size agreement (e.g. seed says 400 ml, candidate's `quantity`
       field should parse to 400 ml).
    3. Accept the highest-scoring candidate only if score >= AUTO_THRESHOLD AND
       its EAN is well-formed (8-13 digits) AND no other product in the DB owns it.
    4. Print a table with status per product (auto / review / none).

This is read-only against the network and write-only to the `product.ean` column.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Optional

import httpx

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"

OBF_SEARCH = "https://world.openbeautyfacts.org/cgi/search.pl"
OFF_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl"
HEADERS = {
    "User-Agent": "EUPRICE-research/0.1 (cross-EU price comparison; contact: euprice@example.org)",
}

AUTO_THRESHOLD = 0.65   # combined score above which we auto-commit the EAN
SIZE_TOL_PCT = 0.10     # ±10 % size tolerance


def normalize(s: str) -> str:
    return (s or "").lower().replace(",", " ").replace("-", " ").replace("'", "")


def tokens(s: str) -> set[str]:
    return {t for t in normalize(s).split() if len(t) > 2}


_QUANTITY_RE = re.compile(r"(\d+[.,]?\d*)\s*(ml|l|g|kg|cl)\b", re.IGNORECASE)


def parse_quantity(s: str) -> Optional[tuple[float, str]]:
    if not s:
        return None
    m = _QUANTITY_RE.search(s)
    if not m:
        return None
    v = float(m.group(1).replace(",", "."))
    u = m.group(2).lower()
    # normalize to ml or g for comparison
    if u == "l":
        v *= 1000; u = "ml"
    elif u == "cl":
        v *= 10; u = "ml"
    elif u == "kg":
        v *= 1000; u = "g"
    return v, u


def size_score(seed_v: Optional[float], seed_u: Optional[str], cand_qty: Optional[str]) -> float:
    """1.0 if exact, ~0.5 if same unit different value, 0.0 if mismatched."""
    if seed_v is None or not seed_u:
        return 0.5  # unknown — neutral
    parsed = parse_quantity(cand_qty or "")
    if parsed is None:
        return 0.4  # candidate has no parseable size — small penalty
    cand_v, cand_u = parsed
    # Normalize seed to ml/g/piece
    su = seed_u.lower()
    sv = seed_v
    if su == "l":
        sv = seed_v * 1000; su = "ml"
    elif su == "kg":
        sv = seed_v * 1000; su = "g"
    if su != cand_u:
        return 0.1
    if abs(cand_v - sv) / max(sv, 1e-6) <= SIZE_TOL_PCT:
        return 1.0
    return 0.3


def search(client: httpx.Client, query: str, food: bool = False) -> list[dict]:
    base = OFF_SEARCH if food else OBF_SEARCH
    try:
        r = client.get(
            base,
            params={
                "search_terms": query,
                "search_simple": 1,
                "action": "process",
                "json": 1,
                "page_size": 20,
            },
            headers=HEADERS,
            timeout=25.0,
        )
    except httpx.HTTPError:
        return []
    if r.status_code != 200:
        return []
    try:
        data = r.json()
    except Exception:
        return []
    return data.get("products") or []


def score_candidate(seed_row: sqlite3.Row, cand: dict) -> float:
    seed_full = f"{seed_row['producer']} {seed_row['name']}"
    seed_tokens = tokens(seed_full)
    if not seed_tokens:
        return 0.0
    cand_text = " ".join(
        filter(None, [cand.get("product_name"), cand.get("brands"), cand.get("generic_name")])
    )
    cand_tokens = tokens(cand_text)
    if not cand_tokens:
        return 0.0
    name_score = len(seed_tokens & cand_tokens) / len(seed_tokens)
    ss = size_score(seed_row["size_value"], seed_row["size_unit"],
                    cand.get("quantity") or cand.get("product_quantity"))
    # Producer name must appear, hard penalty otherwise
    producer_tokens = tokens(seed_row["producer"])
    producer_present = bool(producer_tokens & cand_tokens)
    base = 0.65 * name_score + 0.35 * ss
    return base if producer_present else base * 0.3


def find_ean_for(client: httpx.Client, seed_row: sqlite3.Row) -> Optional[dict]:
    """Returns best {ean, name, score, source, quantity} or None."""
    seed_full = f"{seed_row['producer']} {seed_row['name']}"
    queries = [
        seed_full,
        " ".join(seed_full.split()[:3]),
        " ".join(seed_full.split()[:2]),
    ]
    is_food = (seed_row["category"] or "").lower() == "food"
    best: Optional[tuple[float, dict, str]] = None
    seen_eans: set[str] = set()
    for q in queries:
        for source, food_flag in (("OBF", is_food), ("OFF", True)) if not is_food else (("OFF", True),):
            for cand in search(client, q, food=food_flag):
                ean = (cand.get("code") or "").strip()
                if not ean.isdigit() or not (8 <= len(ean) <= 14):
                    continue
                if ean in seen_eans:
                    continue
                seen_eans.add(ean)
                s = score_candidate(seed_row, cand)
                if best is None or s > best[0]:
                    best = (s, {
                        "ean": ean,
                        "name": cand.get("product_name") or "",
                        "quantity": cand.get("quantity") or "",
                        "score": s,
                        "source": source,
                    }, q)
    if best is None:
        return None
    return best[1]


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"DB not found at {DB}")
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = list(conn.execute("""
        SELECT p.id, pd.name AS producer, p.name, p.size_value, p.size_unit, p.category, p.ean
        FROM product p JOIN producer pd ON pd.id = p.producer_id
        ORDER BY p.id
    """))

    print(f"Looking up EANs for {len(rows)} products via Open Beauty Facts / Open Food Facts\n")
    print(f"{'id':>3}  {'product':<50} {'score':>5}  {'EAN':<14}  {'matched':<32}  status")
    print("-" * 130)

    auto = review = none = 0
    with httpx.Client() as client:
        for r in rows:
            res = find_ean_for(client, r)
            label = f"{r['producer']} {r['name']}"[:50]
            if res is None:
                print(f"{r['id']:>3}  {label:<50} {'--':>5}  {'(no match)':<14}  {'-':<32}  none")
                none += 1
                continue
            status = "auto" if res["score"] >= AUTO_THRESHOLD else "review"
            print(f"{r['id']:>3}  {label:<50} {res['score']:>5.2f}  {res['ean']:<14}  "
                  f"{res['name'][:32]:<32}  {status}")
            if status == "auto":
                # Don't clobber an EAN already owned by another product
                taken = conn.execute(
                    "SELECT id FROM product WHERE ean = ? AND id <> ?", (res["ean"], r["id"])
                ).fetchone()
                if taken is None:
                    conn.execute(
                        "UPDATE product SET ean = ? WHERE id = ?", (res["ean"], r["id"])
                    )
                    auto += 1
                else:
                    print(f"      (EAN already owned by product {taken['id']}, skipping)")
                    review += 1
            else:
                review += 1
    conn.commit()
    conn.close()

    print()
    print(f"Summary: {auto} auto-committed, {review} need review, {none} no match.")
    print("Re-run scripts/export_for_web.py to refresh the JSON snapshot.")


if __name__ == "__main__":
    main()
