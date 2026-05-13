"""Eurostat REST API fetcher for Price Level Indices (PLI).

Dataset: prc_ppp_ind  (Price level indices for actual individual consumption)
   - na_item = PLI_EU27_2020 (PLI relative to EU27 = 100)
   - icp     = consumption category, e.g. CP00 (total), CP01 (food/NA bev), CP12 (misc; incl. personal care)
   - geo     = ISO 3166-1 alpha-2 country code
   - time    = year (YYYY)

API: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_ppp_ind
Returns JSON-stat 2.0 — we parse only the cells we asked for, keeping this dead simple.
"""
from __future__ import annotations

import logging
import sqlite3
from typing import Iterable, Optional

import httpx

from .db import transaction

log = logging.getLogger(__name__)

EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
DATASET = "prc_ppp_ind"

# Eurostat's `ppp_cat` codes (not the textbook CP00/COICOP codes).
# Relevant ones for the EUPRICE case study:
#   A01    Actual individual consumption (the consumer basket as a whole)
#   A0101  Food and non-alcoholic beverages
#   A0105  Household furnishings, equipment, maintenance (drugstore-ish)
#   A0106  Health (closest pre-defined slot for drugstore items)
#   P01    Total goods   (vs P02 = Total services)
DEFAULT_CATEGORIES = ["A01", "A0101", "A0105", "A0106", "P01"]
CATEGORY_LABELS = {
    "A01":   "Actual individual consumption",
    "A0101": "Food and non-alcoholic beverages",
    "A0105": "Household furnishings, equipment",
    "A0106": "Health",
    "P01":   "Total goods",
}


def fetch_pli(
    country_codes: Iterable[str],
    years: Iterable[int],
    categories: Iterable[str] = DEFAULT_CATEGORIES,
    client: Optional[httpx.Client] = None,
) -> list[dict]:
    """Returns a flat list of dicts: {country_code, year, category_code, value}.

    Eurostat's JSON-stat encodes results as a flat array indexed by the product
    of all dimensions, in order — we decode that to (country, year, category, value)
    tuples and drop nulls (countries with no data for that category/year).
    """
    countries = list(country_codes)
    yrs = [str(y) for y in years]
    cats = list(categories)

    url = f"{EUROSTAT_BASE}/{DATASET}"
    params = [
        ("format", "JSON"),
        ("lang", "EN"),
        ("na_item", "PLI_EU27_2020"),
    ]
    for c in countries:
        params.append(("geo", c))
    for y in yrs:
        params.append(("time", y))
    for cat in cats:
        params.append(("ppp_cat", cat))

    owns = client is None
    client = client or httpx.Client(timeout=30.0, follow_redirects=True)
    try:
        log.info("Eurostat: GET %s (%d countries × %d years × %d categories)",
                 DATASET, len(countries), len(yrs), len(cats))
        resp = client.get(url, params=params)
        resp.raise_for_status()
        return _decode_jsonstat(resp.json(), countries, yrs, cats)
    finally:
        if owns:
            client.close()


def _decode_jsonstat(doc: dict, countries: list[str], years: list[str], cats: list[str]) -> list[dict]:
    """Decode the cells we asked for from a JSON-stat 2.0 response."""
    dim = doc.get("dimension") or {}
    id_order = doc.get("id") or list(dim.keys())
    sizes = doc.get("size") or [len(dim[k].get("category", {}).get("index", {})) for k in id_order]
    value_map = doc.get("value") or {}

    # Build per-dimension code lists in the order Eurostat returned them.
    code_lists: dict[str, list[str]] = {}
    for k in id_order:
        idx = dim[k]["category"]["index"]
        # `index` may be {code: position} or [code, code, ...].
        if isinstance(idx, dict):
            ordered = sorted(idx.items(), key=lambda kv: kv[1])
            code_lists[k] = [c for c, _ in ordered]
        else:
            code_lists[k] = list(idx)

    # JSON-stat is row-major: the LAST dimension changes fastest.
    # Decode: rightmost dim = flat % size; then flat //= size; etc.
    out: list[dict] = []
    for flat_idx_s, val in value_map.items():
        if val is None:
            continue
        flat = int(flat_idx_s)
        coords: dict[str, str] = {}
        for k, s in zip(reversed(id_order), reversed(sizes)):
            coords[k] = code_lists[k][flat % s]
            flat //= s
        geo = coords.get("geo")
        time = coords.get("time")
        ppp_cat = coords.get("ppp_cat")
        if geo in countries and time in years and ppp_cat in cats:
            out.append({
                "country_code": geo,
                "year": int(time),
                "category_code": ppp_cat,
                "value": float(val),
            })
    return out


def store_pli(conn: sqlite3.Connection, rows: list[dict]) -> int:
    """Upsert rows into eurostat_pli. Returns count inserted/updated."""
    with transaction(conn):
        for r in rows:
            conn.execute(
                """
                INSERT INTO eurostat_pli
                    (country_code, year, category_code, category_label, value, fetched_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(country_code, year, category_code)
                DO UPDATE SET value = excluded.value,
                              category_label = excluded.category_label,
                              fetched_at = datetime('now')
                """,
                (r["country_code"], r["year"], r["category_code"],
                 CATEGORY_LABELS.get(r["category_code"]), r["value"]),
            )
    return len(rows)
