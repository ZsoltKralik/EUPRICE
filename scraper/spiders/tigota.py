"""Tigotà (Italy) spider.

Tigotà is a major Italian drugstore chain. Same playbook as DM:
    1. site search by product hint (or EAN, if already known from DM)
    2. extract candidate product detail URLs
    3. JSON-LD on detail pages → price + EAN + image
    4. score candidates against the producer name + seed tokens

Key trick: when scraping Tigotà for a product DM has already populated, prefer
searching by EAN. Tigotà's site search accepts numeric EAN queries (most
e-commerce platforms do). EAN search is far more reliable than text search.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional
from urllib.parse import quote_plus, urljoin

from selectolax.parser import HTMLParser

from ..core.fetch import Fetcher
from ..core.models import ProductSpec, ScrapedPrice, ShopCountry
from .base import Spider

log = logging.getLogger(__name__)

# Tigotà runs on a Magento-style platform. Search URL template — verify on first run.
SEARCH_URL_TEMPLATE = "{base}/catalogsearch/result/?q={q}"

PRODUCT_CARD_SELECTORS = [
    "a.product-item-link",                # Magento default
    "a[data-product-id]",
    "a[href*='-tg-']",                    # Tigotà SKU pattern
    "li.product a[href*='/']",
]


class TigotaSpider(Spider):
    shop_code = "tigota"

    def scrape(self, product: ProductSpec, sc: ShopCountry) -> Optional[ScrapedPrice]:
        # Prefer EAN search if we already know it (e.g. from DM scrape).
        query = product.ean if product.ean and re.fullmatch(r"\d{8,14}", product.ean) else product.search_hint
        urls = self._search(query, sc)
        if not urls:
            log.info("Tigotà %s: no candidates for %r", sc.country_code, query)
            return None
        best: Optional[tuple[float, ScrapedPrice]] = None
        for url in urls[:8]:
            try:
                scrape = self._scrape_detail(url, sc)
            except Exception as e:  # noqa: BLE001
                log.warning("Tigotà %s: detail fetch failed for %s: %s", sc.country_code, url, e)
                continue
            if not scrape:
                continue
            # If we searched by EAN and the detail has the same EAN, accept immediately.
            if product.ean and scrape.ean == product.ean:
                return scrape
            score = self._match_score(scrape.product_name_local, product)
            if best is None or score > best[0]:
                best = (score, scrape)
        if best is None or best[0] < 0.5:
            log.info("Tigotà %s: no candidate scored well for %r", sc.country_code, query)
            return None
        return best[1]

    # ---------------------------------------------------------------- search
    def _search(self, query: str, sc: ShopCountry) -> list[str]:
        url = SEARCH_URL_TEMPLATE.format(base=sc.base_url.rstrip("/"), q=quote_plus(query))
        try:
            res = self.fetcher.get(url)
        except Exception as e:  # noqa: BLE001
            log.warning("Tigotà %s: static GET failed (%s); trying rendered", sc.country_code, e)
            res = self.fetcher.get_rendered(url)
        urls = self._extract_product_urls(res.html, sc.base_url)
        if not urls:
            res = self.fetcher.get_rendered(url)
            urls = self._extract_product_urls(res.html, sc.base_url)
        return urls

    @staticmethod
    def _extract_product_urls(html: str, base_url: str) -> list[str]:
        tree = HTMLParser(html)
        seen: set[str] = set()
        out: list[str] = []
        for sel in PRODUCT_CARD_SELECTORS:
            for node in tree.css(sel):
                href = node.attributes.get("href")
                if not href:
                    continue
                full = urljoin(base_url, href)
                # Avoid category/search pages
                if "/catalogsearch/" in full or full.endswith("/"):
                    continue
                if full in seen:
                    continue
                seen.add(full)
                out.append(full)
        return out

    # ---------------------------------------------------------------- detail
    def _scrape_detail(self, url: str, sc: ShopCountry) -> Optional[ScrapedPrice]:
        res = self.fetcher.get(url)
        if res.status_code != 200 or not res.html:
            return None
        data = self._extract_jsonld_product(res.html)
        if data is None:
            res = self.fetcher.get_rendered(url)
            data = self._extract_jsonld_product(res.html)
        if data is None:
            log.debug("Tigotà %s: no JSON-LD product on %s", sc.country_code, url)
            return None

        offers = data.get("offers") or {}
        if isinstance(offers, list):
            offers = offers[0] if offers else {}
        price_raw = offers.get("price")
        if price_raw is None:
            return None
        try:
            price_local = float(str(price_raw).replace(",", "."))
        except ValueError:
            return None

        currency = offers.get("priceCurrency") or sc.currency_code
        name = data.get("name") or ""
        brand_val = data.get("brand")
        brand_name = brand_val.get("name") if isinstance(brand_val, dict) else brand_val
        if brand_name and isinstance(brand_name, str) and brand_name.lower() not in name.lower():
            name = f"{brand_name} {name}"

        ean = data.get("gtin13") or data.get("gtin") or data.get("gtin8") or data.get("sku")
        ean = str(ean).strip() if ean else None
        if ean and not re.fullmatch(r"\d{8,14}", ean):
            ean = None

        image_url = data.get("image")
        if isinstance(image_url, list):
            image_url = image_url[0] if image_url else None
        if isinstance(image_url, dict):
            image_url = image_url.get("url") or image_url.get("contentUrl")
        if image_url is not None:
            image_url = str(image_url)

        # Promo: look for HTML strike-through markers (Magento often uses .old-price / .special-price)
        regular_price = self._extract_regular_price(offers, res.html, price_local)
        is_promo = regular_price is not None and regular_price > price_local

        return ScrapedPrice(
            url=res.url,
            product_name_local=name,
            price_local=price_local,
            currency_code=currency,
            ean=ean,
            image_url=image_url,
            is_promo=is_promo,
            regular_price_local=regular_price if is_promo else None,
            raw={"jsonld_offers": offers},
            raw_html_sha256=res.sha256,
            raw_html_path=res.archive_path,
        )

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _extract_jsonld_product(html: str) -> Optional[dict]:
        tree = HTMLParser(html)
        for node in tree.css("script[type='application/ld+json']"):
            txt = node.text(strip=True)
            if not txt:
                continue
            try:
                data = json.loads(txt)
            except json.JSONDecodeError:
                continue
            for obj in _walk_jsonld(data):
                t = obj.get("@type")
                if t == "Product" or (isinstance(t, list) and "Product" in t):
                    if obj.get("offers"):  # need a price to be useful
                        return obj
        return None

    _PRICE_NUM_RE = re.compile(r"(\d+[.,]\d{1,2}|\d+)")

    @classmethod
    def _parse_price(cls, raw) -> Optional[float]:
        if raw is None:
            return None
        m = cls._PRICE_NUM_RE.search(str(raw))
        if not m:
            return None
        try:
            return float(m.group(1).replace(",", "."))
        except ValueError:
            return None

    @classmethod
    def _extract_regular_price(cls, offers: dict, html: str, current: float) -> Optional[float]:
        # 1. priceSpecification with ListPrice
        spec = offers.get("priceSpecification")
        for entry in (spec if isinstance(spec, list) else [spec] if isinstance(spec, dict) else []):
            t = (entry or {}).get("@type", "")
            if isinstance(t, list):
                t = " ".join(t)
            if t and "List" in t:
                p = cls._parse_price(entry.get("price"))
                if p is not None:
                    return p
        # 2. HTML strike-through (Magento conventions)
        tree = HTMLParser(html)
        for sel in [".old-price .price", ".old-price",
                    "[data-price-type='oldPrice']", "del", "s.price"]:
            for node in tree.css(sel):
                p = cls._parse_price(node.text(strip=True))
                if p is not None and p > current:
                    return p
        return None

    @staticmethod
    def _match_score(scrape_name: str, product: ProductSpec) -> float:
        if not scrape_name:
            return 0.0
        def norm(s: str) -> str:
            return s.lower().replace("'", "").replace("`", "").replace(",", " ").replace("-", " ")
        text = norm(scrape_name)
        seed_str = f"{product.producer} {product.name}"
        if product.size_value and product.size_unit:
            seed_str += f" {product.size_value:g} {product.size_unit}"
        tokens = [t for t in norm(seed_str).split() if len(t) > 2]
        if not tokens:
            return 0.0
        producer_token = norm(product.producer).split()[0]
        producer_present = producer_token in text
        hits = sum(1 for t in tokens if t in text)
        base = hits / len(tokens)
        return base if producer_present else base * 0.2


def _walk_jsonld(data) -> list[dict]:
    out: list[dict] = []
    if isinstance(data, list):
        for item in data:
            out.extend(_walk_jsonld(item))
    elif isinstance(data, dict):
        out.append(data)
        for v in data.values():
            if isinstance(v, (dict, list)):
                out.extend(_walk_jsonld(v))
    return out
