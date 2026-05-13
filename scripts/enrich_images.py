"""Populate product.image_url from Open Beauty Facts (with Open Food Facts fallback).

For each product, search by "{producer} {name}", grab the first hit with a front
image, download it to web/public/images/<product_id>.jpg, and set image_url to
"/images/<product_id>.jpg" so the web app serves it from its own /public dir
(no hotlinking, no rate-limit risk on view).

Also opportunistically attaches the EAN if OBF returns one and our row is missing it.

Re-run safe: re-runs the search and overwrites any /images/*.jpg + DB image_url.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional

import httpx

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"
IMAGES_DIR = ROOT / "web" / "public" / "images"

OBF_SEARCH = "https://world.openbeautyfacts.org/cgi/search.pl"
OFF_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl"
HEADERS = {
    "User-Agent": (
        "EUPRICE-research/0.1 "
        "(cross-EU price comparison case study; contact: euprice@example.org)"
    ),
}


def _score(candidate_name: str, seed_tokens: set[str]) -> float:
    if not candidate_name or not seed_tokens:
        return 0.0
    norm = candidate_name.lower().replace(",", " ").replace("-", " ").replace("'", "")
    cand_tokens = {t for t in norm.split() if len(t) > 2}
    if not cand_tokens:
        return 0.0
    return len(seed_tokens & cand_tokens) / len(seed_tokens)


def search_open_facts(
    client: httpx.Client, query: str, seed_tokens: set[str], food: bool = False,
) -> Optional[dict]:
    """Return the highest-scoring candidate with an image. None if best score < 0.4."""
    base = OFF_SEARCH if food else OBF_SEARCH
    try:
        r = client.get(
            base,
            params={
                "search_terms": query,
                "search_simple": 1,
                "action": "process",
                "json": 1,
                "page_size": 12,
            },
            headers=HEADERS,
            timeout=25.0,
        )
    except httpx.HTTPError as e:
        print(f"    HTTP error on search {query!r}: {e}")
        return None
    if r.status_code != 200:
        return None
    try:
        data = r.json()
    except Exception:
        return None

    best: Optional[tuple[float, dict]] = None
    for p in data.get("products") or []:
        img = p.get("image_front_url") or p.get("image_url")
        if not img:
            continue
        name = p.get("product_name") or ""
        score = _score(name, seed_tokens)
        if best is None or score > best[0]:
            best = (score, {"name": name, "image_url": img, "score": score})
    if best is None or best[0] < 0.4:
        return None
    return best[1]


def download(client: httpx.Client, url: str, dest: Path) -> bool:
    try:
        r = client.get(url, headers=HEADERS, timeout=30.0, follow_redirects=True)
    except httpx.HTTPError as e:
        print(f"    HTTP error on download: {e}")
        return False
    if r.status_code != 200 or not r.content:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(r.content)
    return True


def main() -> None:
    if not DB.exists():
        raise SystemExit(f"DB not found at {DB}")
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = list(conn.execute("""
        SELECT p.id, pd.name AS producer, p.name, p.category, p.ean
        FROM product p JOIN producer pd ON pd.id = p.producer_id
        ORDER BY p.id
    """))
    print(f"Enriching images for {len(rows)} products.\n")

    # Wipe EANs we previously auto-attached: the loose matching tagged the wrong SKUs.
    # Real scrapes will repopulate canonical EANs from retailer JSON-LD.
    cleared = conn.execute("UPDATE product SET ean = NULL WHERE ean IS NOT NULL").rowcount
    if cleared:
        print(f"Cleared {cleared} previously-attached EANs.\n")

    enriched = 0
    with httpx.Client() as client:
        for r in rows:
            full_query = f"{r['producer']} {r['name']}"
            seed_tokens = {
                t for t in (
                    full_query.lower()
                    .replace(",", " ").replace("-", " ").replace("'", "")
                    .split()
                ) if len(t) > 2
            }
            is_food = (r["category"] or "").lower() == "food"
            # Two attempts: full query, then first two words. No producer-only fallback —
            # that grabs any SKU from the brand and gives wrong images.
            queries = [full_query, " ".join(full_query.split()[:2])]
            res = None
            for q in queries:
                res = search_open_facts(client, q, seed_tokens, food=is_food)
                if res is None and not is_food:
                    res = search_open_facts(client, q, seed_tokens, food=True)
                if res is not None:
                    break
            if res is None:
                # Clear any stale image_url left over from a previous looser run.
                conn.execute("UPDATE product SET image_url = NULL WHERE id = ?", (r["id"],))
                print(f"  - {full_query[:50]:<50}  no confident match")
                continue

            dest = IMAGES_DIR / f"{r['id']}.jpg"
            if not download(client, res["image_url"], dest):
                print(f"  - {full_query[:50]:<50}  download failed")
                continue

            local_path = f"/images/{r['id']}.jpg"
            conn.execute(
                "UPDATE product SET image_url = ? WHERE id = ?",
                (local_path, r["id"]),
            )
            print(f"  + {full_query[:50]:<50}  <- {res['name'][:32]}  (score {res['score']:.2f})")
            enriched += 1

    conn.commit()
    conn.close()
    print(f"\nEnriched {enriched}/{len(rows)} products.")
    print("Next: re-run `python scripts/export_for_web.py` so the JSON snapshots pick up the new image_url paths.")


if __name__ == "__main__":
    main()
