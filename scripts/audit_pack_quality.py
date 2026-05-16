"""Audit every price row for product-identity drift between the seed and scrape.

Five classes of suspect rows are flagged:

  MULTI    Multi-pack indicators in the scraped name (2x..., duopack, twin pack, etc.).
  REFILL   Refill / travel-size / mini variants (Nachfüllpack, Reisegröße, Mini, Travel).
  SIZE     Parsed size from the scraped name diverges from seed by more than ±15 %.
  BRAND    Producer name is absent from the scraped name (suggests wrong SKU entirely).
  EAN_DIFF Scraped EAN differs from product's canonical EAN (most likely a variant).

The output is human-readable plus a CSV at audit_report.csv for follow-up.
Exit code: 0 if no suspects, 1 otherwise (CI-friendly).
"""
from __future__ import annotations

import csv
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "db" / "eu_prices.db"
REPORT = ROOT / "audit_report.csv"

# Multi-pack: any N>=2 followed by x/× and a digit. Single-digit AND multi-digit
# (e.g. "12x80" is a 12-pack). Negative lookbehind/ahead prevents matching the
# leading digit of a larger number ("256xpieces" wouldn't match here).
MULTI_PACK_NUM_RE = re.compile(
    r"(?<![\d.,])(?:[2-9]|[1-9]\d+)\s*[x×]\s*\d", re.IGNORECASE,
)
MULTI_PACK_WORD_RE = re.compile(
    r"\b(duopack|doppelpack|twin\s*pack|nachf(ü|u)llpack|refill\s*pack|"
    r"tripack|big\s*pack|jumbopack|gro(ß|ss)packung|grosspack|economy\s*pack|"
    r"family\s*pack|vorrats(packung|pack)?)\b",
    re.IGNORECASE,
)
REFILL_RE = re.compile(
    r"\b(reiseg(?:r(?:ö|o)(?:ß|ss)e|rosse)|travel\s*size|mini[-\s]?pack|sample\s*size|"
    r"probierset|sachet)\b",
    re.IGNORECASE,
)

UNIT_PATS = {
    "ml": r"ml",
    "l":  r"l(?:iter)?",
    "g":  r"g(?:ramm)?",
    "kg": r"kg",
    "piece": r"(?:st(?:ü|u)ck|stk\.?|st\.?(?!\w)|ks|kos|kom|szt|buc|db|бр\.?|pieces?|pcs?|tabs?)",
}

# Bidirectional category detection — same patterns used by the spider's
# pack-guard so audit and ingest agree on what counts as a category mismatch.
VOLUME_RE = re.compile(r"(?<![\d.,])\d+[,.]?\d*\s*(?:ml|l(?:iter)?)\b", re.IGNORECASE)
WEIGHT_RE = re.compile(r"(?<![\d.,])\d+[,.]?\d*\s*(?:g(?:ramm)?|kg)\b", re.IGNORECASE)
PIECE_RE = re.compile(
    r"(?<![\d.,])\d+[,.]?\d*\s*"
    r"(?:st(?:ü|u)ck|stk\.?|st\.?(?!\w)|ks|kos|kom|szt|buc|db|бр\.?|pieces?|pcs?|tabs?)\b",
    re.IGNORECASE,
)


def seed_category(unit: str) -> str:
    u = (unit or "").lower()
    if u in ("ml", "l"):
        return "volume"
    if u in ("g", "kg"):
        return "weight"
    if u == "piece":
        return "piece"
    return "other"


def scrape_categories(name: str) -> set[str]:
    cats: set[str] = set()
    if VOLUME_RE.search(name):
        cats.add("volume")
    if WEIGHT_RE.search(name):
        cats.add("weight")
    if PIECE_RE.search(name):
        cats.add("piece")
    return cats


def parse_total_size(name: str, unit: str) -> list[float]:
    """All numeric values in `name` followed by the given unit alias."""
    pat = rf"(\d+[,.]?\d*)\s*{UNIT_PATS.get(unit.lower(), re.escape(unit))}\b"
    return [float(m.replace(",", ".")) for m in re.findall(pat, name, re.IGNORECASE)]


def seed_size_canonical(value: float, unit: str) -> tuple[float, str]:
    u = unit.lower()
    if u == "l":
        return value * 1000.0, "ml"
    if u == "kg":
        return value * 1000.0, "g"
    return value, u


def audit() -> int:
    if not DB.exists():
        print(f"DB not found at {DB}", file=sys.stderr)
        return 2
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    rows = list(conn.execute("""
        SELECT v.product_id, v.country_code, v.product_name, v.product_name_local,
               v.ean, v.scraped_ean, v.size_value, v.size_unit,
               p.canonical_url, v.url,
               pd.name AS producer
        FROM v_latest_prices v
        JOIN product p   ON p.id = v.product_id
        JOIN producer pd ON pd.id = p.producer_id
    """))

    # DM internal-SKU id matcher — same `/p/d/<NNNN>/` across country domains
    # is strong evidence that DM treats the page as the same physical product
    # even when the JSON-LD gtin13 happens to differ between countries.
    DM_SKU_RE = re.compile(r"/p/d/(\d+)/", re.IGNORECASE)
    def dm_sku(url):
        if not url:
            return None
        m = DM_SKU_RE.search(url)
        return m.group(1) if m else None

    suspects: list[dict] = []
    by_class: dict[str, int] = {}

    for r in rows:
        name = r["product_name_local"] or ""
        producer = r["producer"]
        flags: list[tuple[str, str]] = []

        # EAN_DIFF — the scraped page's JSON-LD gtin13 differs from the seed
        # canonical EAN AND the DM internal SKU also differs. We allow a
        # scraped EAN difference when the DM `/p/d/<sku>/` id matches the
        # anchor page's SKU; that's the retailer's own "same product" claim.
        canon = (r["ean"] or "").strip()
        scraped = (r["scraped_ean"] or "").strip()
        seed_sku = dm_sku(r["canonical_url"])
        row_sku = dm_sku(r["url"])
        sku_matches = bool(seed_sku and row_sku and seed_sku == row_sku)
        if canon and scraped and canon != scraped and not sku_matches:
            flags.append((
                "EAN_DIFF",
                f"scraped EAN {scraped} != canonical {canon} (DM SKU also differs: "
                f"{row_sku} vs {seed_sku})",
            ))
        elif canon and not scraped:
            # Pre-migration row inserted before scraped_ean was stored.
            # Surface but don't gate CI on it — these can be re-scraped to fill in.
            flags.append(("EAN_MISSING", "scraped EAN unknown (pre-migration row)"))

        # MULTI / REFILL — string-pattern based
        if MULTI_PACK_NUM_RE.search(name) or MULTI_PACK_WORD_RE.search(name):
            flags.append(("MULTI", "multi-pack marker in scraped name"))
        if REFILL_RE.search(name):
            flags.append(("REFILL", "refill / travel / mini marker"))

        # SIZE / CATEGORY — same-category divergence > 15 %, OR a unit-category
        # mismatch (seed in ml, scrape only in g; or seed in piece, scrape only
        # in ml; etc.). The category check is the cousin of MULTI: it catches
        # whole-product-line mismatches (cream → soap, wipes → shampoo).
        if r["size_value"] and r["size_unit"]:
            seed_cat = seed_category(r["size_unit"])
            scrape_cats = scrape_categories(name)
            if seed_cat in ("volume", "weight", "piece") and scrape_cats and seed_cat not in scrape_cats:
                flags.append((
                    "CATEGORY",
                    f"seed is {seed_cat} ({r['size_value']:g}{r['size_unit']}) "
                    f"but scrape units are {sorted(scrape_cats)}",
                ))
            seed_v, seed_u = seed_size_canonical(r["size_value"], r["size_unit"])
            parsed = parse_total_size(name, seed_u)
            if parsed:
                best_diff = min(abs(p - seed_v) / max(seed_v, 1e-6) for p in parsed)
                if best_diff > 0.15:
                    flags.append((
                        "SIZE",
                        f"name has {parsed} {seed_u} vs seed {seed_v:g} {seed_u}",
                    ))

        # BRAND — producer name absent from scraped product name
        prod_tok = re.split(r"\s+", producer.lower())[0].replace("'", "")
        name_low = name.lower().replace("'", "")
        if prod_tok and len(prod_tok) > 2 and prod_tok not in name_low:
            flags.append(("BRAND", f"producer {producer!r} not in scraped name"))

        # TOKEN_MISS — significant seed tokens missing from the scraped name.
        # Catches wrong-product-line cases (e.g. Always Ultra → Always Discreet:
        # 'ultra' missing). Numeric tokens are treated as a separate dimension
        # via SIZE check, so we strip them here. Common stopwords too.
        seed_name = r["product_name"] or ""
        STOP = {"original", "naturkosmetik", "pflege", "creme", "shampoo", "the", "und"}
        def _norm(s): return re.sub(r"[^a-zäöüß0-9]+", " ", (s or "").lower())
        seed_tokens = {
            t for t in _norm(seed_name).split()
            if len(t) >= 4 and not t.isdigit() and t not in STOP
        }
        if seed_tokens:
            scrape_low = _norm(name)
            missing = {t for t in seed_tokens if t not in scrape_low}
            if len(missing) / len(seed_tokens) > 0.5:
                flags.append((
                    "TOKEN_MISS",
                    f"seed tokens missing from scrape: {sorted(missing)}",
                ))

        if not flags:
            continue
        for cls, detail in flags:
            by_class[cls] = by_class.get(cls, 0) + 1
        suspects.append({
            "product_id": r["product_id"],
            "country": r["country_code"],
            "producer": producer,
            "seed_name": r["product_name"],
            "seed_size": f"{r['size_value']}{r['size_unit']}",
            "scraped_name": name,
            "flags": ", ".join(f"{c}" for c, _ in flags),
            "detail": " | ".join(d for _, d in flags),
            "url": r["url"],
        })

    # Print summary table
    print(f"Audited {len(rows)} latest-price rows.")
    print(f"{len(suspects)} suspects flagged "
          + " / ".join(f"{c}={n}" for c, n in sorted(by_class.items())))
    print()
    if suspects:
        # Group by product
        suspects.sort(key=lambda s: (s["product_id"], s["country"]))
        last_pid = None
        for s in suspects:
            if s["product_id"] != last_pid:
                print(f"\nproduct #{s['product_id']} {s['producer']} {s['seed_name']} "
                      f"({s['seed_size']}):")
                last_pid = s["product_id"]
            print(f"  [{s['flags']:<14}] {s['country']}  {s['scraped_name'][:70]}")
            print(f"     -> {s['detail']}")
            print(f"     {s['url']}")

    # Write CSV for follow-up
    if suspects:
        with REPORT.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(suspects[0].keys()))
            w.writeheader()
            w.writerows(suspects)
        print(f"\nCSV written: {REPORT}")
    conn.close()
    return 0 if not suspects else 1


if __name__ == "__main__":
    sys.exit(audit())
