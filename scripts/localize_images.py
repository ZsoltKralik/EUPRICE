"""Download any remote product images to web/public/images/<product_id>.jpg.

Rationale: when the DM spider captures a product, the JSON-LD `image` field is
the retailer's CDN URL (e.g. products.dm-static.com). We want to serve those
from our own /public dir so the web app doesn't depend on third-party CDNs
that may rotate URLs or block hotlinking.

Idempotent: products whose image_url is already a /images/* relative path are
skipped. Products with no image_url at all are skipped (nothing to download).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"
IMAGES_DIR = ROOT / "web" / "public" / "images"
HEADERS = {
    "User-Agent": "EUPRICE-research/0.1 (contact: euprice@example.org)",
}


def main() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = list(conn.execute("""
        SELECT id, image_url FROM product
        WHERE image_url IS NOT NULL AND image_url LIKE 'http%'
    """))
    if not rows:
        print("No remote image URLs to localize. Nothing to do.")
        return

    print(f"Localizing {len(rows)} remote image(s)...")
    with httpx.Client(headers=HEADERS, timeout=30.0, follow_redirects=True) as client:
        for r in rows:
            url = r["image_url"]
            dest = IMAGES_DIR / f"{r['id']}.jpg"
            try:
                resp = client.get(url)
            except httpx.HTTPError as e:
                print(f"  ! product {r['id']}: download failed ({e})")
                continue
            if resp.status_code != 200 or not resp.content:
                print(f"  ! product {r['id']}: HTTP {resp.status_code}, skipping")
                continue
            dest.write_bytes(resp.content)
            conn.execute(
                "UPDATE product SET image_url = ? WHERE id = ?",
                (f"/images/{r['id']}.jpg", r["id"]),
            )
            print(f"  + product {r['id']}: {len(resp.content)//1024} KB <- {url[:60]}…")
    conn.commit()
    conn.close()
    print(f"\nAll remote image URLs in DB now point to /images/<id>.jpg")


if __name__ == "__main__":
    main()
