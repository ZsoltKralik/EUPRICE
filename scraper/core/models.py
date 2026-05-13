"""Data models shared between the orchestrator, spiders, and the DB layer."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ProductSpec(BaseModel):
    """One row from data/products.csv — the curated list of things to track."""
    producer: str
    name: str
    size_value: Optional[float] = None
    size_unit: Optional[str] = None
    category: str
    subcategory: Optional[str] = None
    search_hint: str
    ean: Optional[str] = None
    notes: Optional[str] = None


class ShopCountry(BaseModel):
    """A shop's presence in a country, joined from the DB."""
    shop_id: int
    shop_code: str
    shop_name: str
    country_code: str
    country_name: str
    base_url: str
    currency_code: str
    vat_standard_rate: float
    vat_food_rate: Optional[float] = None


class ScrapedPrice(BaseModel):
    """One observation from a spider. The DB layer turns this into a `price` row."""
    # What the spider found on the page
    url: str
    product_name_local: str
    price_local: float                          # current shelf price (VAT-inclusive) in local currency
    currency_code: str
    ean: Optional[str] = None                   # JSON-LD gtin13, if discovered
    image_url: Optional[str] = None             # JSON-LD image, if present

    # Promo
    is_promo: bool = False
    regular_price_local: Optional[float] = None  # non-promo reference price (in local currency)

    # Bookkeeping
    parsed_at: datetime = datetime.utcnow()
    raw: Optional[dict] = None
    raw_html_sha256: Optional[str] = None
    raw_html_path: Optional[str] = None
