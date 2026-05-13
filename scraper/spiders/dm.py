"""DM Drogerie Markt spider.

DM operates similar e-commerce platforms across DE, AT, SK, CZ, HU, PL, SI, HR,
RO, BG. Every product detail page embeds JSON-LD with the canonical EAN
(`gtin13`), product name, and offer price — which makes the scrape robust.

Flow:
    1. Hit the country's DM search with the product's search_hint.
    2. Pull candidate product detail URLs from the search HTML.
    3. Fetch the top candidate; parse <script type="application/ld+json">.
    4. Score against producer name; return the first reasonable match.

Tuning notes:
    - Each country's exact search URL may differ; override SEARCH_URL_TEMPLATES.
    - If a country page is fully JS-rendered, the fetcher falls back to a
      headless browser. Spider code doesn't need to care.
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

SEARCH_URL_TEMPLATES: dict[str, str] = {
    "DE": "{base}/search?query={q}",
    "AT": "{base}/search?query={q}",
    "SK": "{base}/search?query={q}",
    "CZ": "{base}/search?query={q}",
    "HU": "{base}/search?query={q}",
    "PL": "{base}/search?query={q}",
    "SI": "{base}/search?query={q}",
    "HR": "{base}/search?query={q}",
    "RO": "{base}/search?query={q}",
    "BG": "{base}/search?query={q}",
}

PRODUCT_CARD_SELECTORS = [
    "a[data-dmid='product-tile-link']",
    "a[data-cy='product-tile']",
    "a.product-tile",
    "a[href*='/p/']",
]


class DMSpider(Spider):
    shop_code = "dm"

    def scrape(self, product: ProductSpec, sc: ShopCountry) -> Optional[ScrapedPrice]:
        urls = self._search(product.search_hint, sc)
        if not urls:
            log.info("DM %s: no candidates for %r", sc.country_code, product.search_hint)
            return None
        # Score each candidate, return the best with a non-trivial score.
        best: Optional[tuple[float, ScrapedPrice]] = None
        for url in urls[:8]:
            try:
                scrape = self._scrape_detail(url, sc)
            except Exception as e:  # noqa: BLE001
                log.warning("DM %s: detail fetch failed for %s: %s", sc.country_code, url, e)
                continue
            if not scrape:
                continue
            score = self._match_score(scrape.product_name_local, product)
            log.debug("DM %s: candidate %s scored %.2f (%s)",
                      sc.country_code, url, score, scrape.product_name_local)
            if best is None or score > best[0]:
                best = (score, scrape)
        if best is None or best[0] < 0.5:
            log.info("DM %s: no candidate scored well for %r (best=%.2f)",
                     sc.country_code, product.search_hint,
                     best[0] if best else 0.0)
            return None
        return best[1]

    # ---------------------------------------------------------------- search
    def _search(self, query: str, sc: ShopCountry) -> list[str]:
        template = SEARCH_URL_TEMPLATES.get(sc.country_code, "{base}/search?query={q}")
        url = template.format(base=sc.base_url.rstrip("/"), q=quote_plus(query))
        try:
            res = self.fetcher.get(url)
        except Exception as e:  # noqa: BLE001
            log.warning("DM %s: search GET failed (%s); trying rendered", sc.country_code, e)
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
                if full in seen:
                    continue
                seen.add(full)
                out.append(full)
        return out

    # ----------------------------------------------------------------- detail
    def _scrape_detail(self, url: str, sc: ShopCountry) -> Optional[ScrapedPrice]:
        res = self.fetcher.get(url)
        if res.status_code != 200 or not res.html:
            return None
        data = self._extract_jsonld_product(res.html)
        if data is None:
            res = self.fetcher.get_rendered(url)
            data = self._extract_jsonld_product(res.html)
        if data is None:
            log.debug("DM %s: no JSON-LD product on %s", sc.country_code, url)
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
        # JSON-LD splits brand and name — combine for human-readable local display
        brand_val = data.get("brand")
        brand_name = brand_val.get("name") if isinstance(brand_val, dict) else brand_val
        if brand_name and isinstance(brand_name, str) and brand_name.lower() not in name.lower():
            name = f"{brand_name} {name}"

        ean = data.get("gtin13") or data.get("gtin") or data.get("sku")
        ean = str(ean).strip() if ean else None
        if ean and not re.fullmatch(r"\d{8,14}", ean):
            ean = None

        regular_price = self._extract_regular_price(offers, res.html, price_local)
        is_promo = regular_price is not None and regular_price > price_local

        image_url = data.get("image")
        if isinstance(image_url, list):
            image_url = image_url[0] if image_url else None
        if isinstance(image_url, dict):
            image_url = image_url.get("url") or image_url.get("contentUrl")
        if image_url is not None:
            image_url = str(image_url)

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

    # ----------------------------------------------------------- promo helpers
    @classmethod
    def _extract_regular_price(cls, offers: dict, html: str, current_price: float) -> Optional[float]:
        """Best-effort: find the non-promo reference price.

        Tries (in order):
          1. JSON-LD `offers.priceSpecification` entries (e.g. "ListPrice")
          2. JSON-LD `offers.highPrice` (AggregateOffer convention)
          3. HTML struck-through price markers (<del>, <s>, .price-original, etc.)
        """
        # 1. priceSpecification — schema.org allows ListPrice / SalePrice pairs
        spec = offers.get("priceSpecification")
        for entry in (spec if isinstance(spec, list) else [spec] if isinstance(spec, dict) else []):
            t = (entry or {}).get("@type", "")
            if isinstance(t, list):
                t = " ".join(t)
            if t and "List" in t:
                p = cls._parse_price(entry.get("price"))
                if p is not None:
                    return p

        # 2. AggregateOffer high/low convention
        hi = cls._parse_price(offers.get("highPrice"))
        if hi is not None and hi > current_price:
            return hi

        # 3. HTML struck-through markers
        tree = HTMLParser(html)
        candidate_selectors = [
            "[data-dmid*='price-original']",
            "[data-dmid*='priceOriginal']",
            "[data-dmid*='strikePrice']",
            ".price-original",
            ".product-price--original",
            "del[itemprop='price']",
            "del .price",
            "del",
            "s.price",
        ]
        for sel in candidate_selectors:
            for node in tree.css(sel):
                p = cls._parse_price(node.text(strip=True))
                if p is not None and p > current_price:
                    return p
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

    # ----------------------------------------------------------------- helpers
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
                    return obj
        return None

    @staticmethod
    def _match_score(scrape_name: str, product: ProductSpec) -> float:
        """Token-overlap score between scraped name and seed (producer + name + size).

        Returns a score in [0, 1]: fraction of seed tokens that appear in the
        scraped product name. Tokens of <=2 chars and pure-digit "filler" are
        skipped so trivial words don't dominate.
        """
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
        # Producer token MUST appear — heavily penalise if missing.
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
