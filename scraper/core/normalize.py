"""Price normalization helpers."""
from __future__ import annotations


def to_eur(price_local: float, rate_per_eur: float) -> float:
    """Convert a shelf price in local currency to EUR.

    rate_per_eur follows the ECB convention: units of local currency per 1 EUR.
    """
    if rate_per_eur <= 0:
        raise ValueError("rate_per_eur must be positive")
    return price_local / rate_per_eur


def strip_vat(price: float, vat_rate: float) -> float:
    """Return the VAT-exclusive price given a VAT-inclusive price.

    vat_rate is the fractional rate (0.20 for 20 %).
    """
    if vat_rate < 0:
        raise ValueError("vat_rate must be non-negative")
    return price / (1.0 + vat_rate)
