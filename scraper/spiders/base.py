"""Base class for retailer spiders.

A spider takes one product (with a search hint) and one shop-country, and
returns a ScrapedPrice or None. All EUR conversion, VAT stripping, and DB
writes are done by the orchestrator — spiders are pure scrapers.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional

from ..core.fetch import Fetcher
from ..core.models import ProductSpec, ScrapedPrice, ShopCountry

log = logging.getLogger(__name__)


class Spider(ABC):
    shop_code: str = ""  # subclass sets, e.g. "dm"

    def __init__(self, fetcher: Optional[Fetcher] = None) -> None:
        self.fetcher = fetcher or Fetcher(min_delay_seconds=1.5)

    @abstractmethod
    def scrape(self, product: ProductSpec, sc: ShopCountry) -> Optional[ScrapedPrice]:
        """Resolve a product on this shop-country and return what we observed.

        Returns None if the product can't be found. Should not raise on 404 or
        empty-search; only propagate transport-level errors.
        """

    def close(self) -> None:
        self.fetcher.close()
