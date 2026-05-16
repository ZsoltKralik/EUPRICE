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

    # DM URL pattern: https://www.dm.<tld>/p/d/<NNNN>/<slug>
    # The internal SKU id is the same across all DM country domains for the
    # same physical product. e.g. Nivea Soft Creme 200 ml jar is /p/d/1441732/
    # on dm.de, dm.at, dm.ro, dm.si — even though the JSON-LD gtin13 sometimes
    # differs by country.
    _DM_SKU_RE = re.compile(r"/p/d/(\d+)/", re.IGNORECASE)

    @classmethod
    def _extract_dm_sku(cls, url: Optional[str]) -> Optional[str]:
        if not url:
            return None
        m = cls._DM_SKU_RE.search(url)
        return m.group(1) if m else None

    def scrape(self, product: ProductSpec, sc: ShopCountry) -> Optional[ScrapedPrice]:
        """Find this product on the shop's country site and return its price.

        Strict methodology — to keep cross-country price comparisons honest, a
        row is inserted ONLY when one of these acceptance criteria is met,
        from strongest to weakest:

          (a) The candidate page's JSON-LD gtin13 equals the seed EAN. Hard
              identity match; pack-guard is a safety net only.

          (b) The candidate URL contains the same DM internal SKU id as the
              seed's canonical_url (the anchor-country page). DM uses one
              `/p/d/<NNNN>/` id per physical product across all country
              domains; same SKU id is a strong "same product" signal even
              when the JSON-LD EAN happens to differ. Pack-guard still
              required so multi-pack variants are rejected.

          (c) No seed EAN exists at all — we fall back to scored text search.
              This runs only on the anchor-country bootstrap before any EAN
              is known.

        We do NOT accept "looked plausible, EAN/SKU didn't match" fallbacks.
        Missing observations are correct when no country page actually carries
        the seed identity.
        """
        seed_sku = self._extract_dm_sku(product.canonical_url)

        # Phase 1: EAN search if we know the EAN.
        if product.ean:
            ean_urls = self._search(product.ean, sc)
            sku_match: Optional[ScrapedPrice] = None
            for url in ean_urls[:5]:
                try:
                    candidate = self._scrape_detail(url, sc)
                except Exception as e:  # noqa: BLE001
                    log.warning("DM %s: EAN detail fetch failed for %s: %s",
                                sc.country_code, url, e)
                    continue
                if not candidate:
                    continue
                # Pack-guard first — multi-pack/wrong-size variants are rejected
                # even on otherwise-perfect identity matches.
                if not self._passes_pack_check(candidate.product_name_local, product):
                    log.info("DM %s: rejecting %s — pack mismatch (%s)",
                             sc.country_code, url, candidate.product_name_local[:60])
                    continue
                # (a) EAN identity match — strongest signal, return immediately.
                if candidate.ean == product.ean:
                    log.info("DM %s: EAN-matched %s", sc.country_code, url)
                    return candidate
                # (b) DM internal SKU match — accept if no EAN candidate emerges.
                cand_sku = self._extract_dm_sku(candidate.url)
                if seed_sku and cand_sku == seed_sku and sku_match is None:
                    sku_match = candidate

            # Try text search too — DM's site search sometimes prefers country
            # title over EAN index, and the EAN/SKU criteria still apply.
            urls = self._search(product.search_hint, sc)
            for url in urls[:8]:
                try:
                    candidate = self._scrape_detail(url, sc)
                except Exception as e:  # noqa: BLE001
                    log.warning("DM %s: detail fetch failed for %s: %s",
                                sc.country_code, url, e)
                    continue
                if not candidate:
                    continue
                if not self._passes_pack_check(candidate.product_name_local, product):
                    continue
                if candidate.ean == product.ean:
                    log.info("DM %s: EAN-matched via text search %s",
                             sc.country_code, url)
                    return candidate
                cand_sku = self._extract_dm_sku(candidate.url)
                if seed_sku and cand_sku == seed_sku and sku_match is None:
                    sku_match = candidate

            if sku_match is not None:
                log.info("DM %s: DM-SKU-matched %s (seed sku=%s, scraped ean=%s)",
                         sc.country_code, sku_match.url, seed_sku, sku_match.ean)
                return sku_match

            log.info("DM %s: no page carries EAN %s or DM sku %s — skipping (was %r)",
                     sc.country_code, product.ean, seed_sku, product.search_hint)
            return None

        # Phase 2: seed has no EAN at all — fall back to scored text search.
        # This path runs only on the anchor-country bootstrap before the EAN
        # is known. Pack-guard + producer-token + ≥0.5 name overlap required.
        urls = self._search(product.search_hint, sc)
        if not urls:
            log.info("DM %s: no candidates for %r (no seed EAN)",
                     sc.country_code, product.search_hint)
            return None

        best: Optional[tuple[float, ScrapedPrice]] = None
        for url in urls[:8]:
            try:
                candidate = self._scrape_detail(url, sc)
            except Exception as e:  # noqa: BLE001
                log.warning("DM %s: detail fetch failed for %s: %s",
                            sc.country_code, url, e)
                continue
            if not candidate:
                continue
            if not self._passes_pack_check(candidate.product_name_local, product):
                log.debug("DM %s: %s pack-rejected (%s)",
                          sc.country_code, url, candidate.product_name_local[:60])
                continue
            score = self._match_score(candidate.product_name_local, product)
            log.debug("DM %s: candidate %s scored %.2f (%s)",
                      sc.country_code, url, score, candidate.product_name_local)
            if best is None or score > best[0]:
                best = (score, candidate)
        if best is not None and best[0] >= 0.5:
            return best[1]
        log.info("DM %s: no candidate scored well for %r (best=%.2f)",
                 sc.country_code, product.search_hint,
                 best[0] if best else 0.0)
        return None

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

    # ---------------------------------------------------------------- pack guard

    # Explicit multi-pack / variant indicators in the scraped product name.
    # When the seed is a single standard unit, seeing any of these means we've
    # matched the wrong SKU (e.g. seed wants 4.8g Labello, scrape returned
    # 2x4.8g; seed wants 80ct wipes, scrape returned the 15ct travel size).
    # Catches both single-digit ("2x80", "3x100") and multi-digit ("12x80",
    # "30x19,25"). Negative lookbehind on digits/decimals prevents matching the
    # leading digits of a single bigger number.
    _MULTI_PACK_NUM_RE = re.compile(
        r"(?<![\d.,])(?:[2-9]|[1-9]\d+)\s*[x×]\s*\d", re.IGNORECASE,
    )
    _MULTI_PACK_WORD_RE = re.compile(
        r"\b(duopack|doppelpack|twin\s*pack|nachf(ü|u)llpack|refill\s*pack|"
        r"tripack|big\s*pack|economy\s*pack|family\s*pack|"
        r"reiseg(?:r(?:ö|o)(?:ß|ss)e|rosse)|travel\s*size|mini[-\s]?pack|sample\s*size)\b",
        re.IGNORECASE,
    )
    _UNIT_PATTERNS = {
        "ml": r"ml",
        "g": r"g",
        # Piece-count abbreviations across the EU languages we scrape. The
        # (?!\w) lookahead stops "Sticks", "Stripes" etc. from matching the
        # bare "st". Includes:
        #   stück/stuck/stk/st (DE/AT)
        #   ks (CZ/SK)            kom (HR)        kos (SI)
        #   szt (PL)              buc (RO)        db (HU)
        #   бр / бр. (BG, Cyrillic)
        #   pcs / pc / tabs / pieces (EN)
        "piece": r"(?:st(?:ü|u)ck|stk\.?|st\.?(?!\w)|ks|kos|kom|szt|buc|db|бр\.?|pieces?|pcs?|tabs?)",
    }
    # Category-specific patterns. A "category" is one of {volume, weight, piece};
    # within volume ml↔l and within weight g↔kg are convertible, but crossing
    # the boundary (ml vs g vs piece) is a hard mismatch.
    _VOLUME_RE = re.compile(r"(?<![\d.,])\d+[,.]?\d*\s*(?:ml|l(?:iter)?)\b", re.IGNORECASE)
    _WEIGHT_RE = re.compile(r"(?<![\d.,])\d+[,.]?\d*\s*(?:g(?:ramm)?|kg)\b", re.IGNORECASE)
    # Piece marker pattern must NOT pull in the trailing "l" in "100 ml" as
    # "l" alone, so we keep this list explicit and the ml/g patterns above
    # gate the "volume vs weight vs piece" decision.
    _PIECE_RE = re.compile(
        r"(?<![\d.,])\d+[,.]?\d*\s*"
        r"(?:st(?:ü|u)ck|stk\.?|st\.?(?!\w)|ks|kos|kom|szt|buc|db|бр\.?|pieces?|pcs?|tabs?)\b",
        re.IGNORECASE,
    )

    @classmethod
    def _seed_category(cls, unit: str) -> str:
        u = (unit or "").lower()
        if u in ("ml", "l"):
            return "volume"
        if u in ("g", "kg"):
            return "weight"
        if u == "piece":
            return "piece"
        return "other"

    @classmethod
    def _scrape_categories(cls, name: str) -> set[str]:
        cats: set[str] = set()
        if cls._VOLUME_RE.search(name):
            cats.add("volume")
        if cls._WEIGHT_RE.search(name):
            cats.add("weight")
        if cls._PIECE_RE.search(name):
            cats.add("piece")
        return cats

    @classmethod
    def _passes_pack_check(cls, scrape_name: str, product: ProductSpec) -> bool:
        """Reject candidates whose pack structure clearly differs from the seed.

        Three checks:
          1. Multi-pack indicators ("2x4,8 g", "Duopack", "Doppelpack", etc.) —
             any of these means we've matched a multi-unit pack while the seed
             is for a single unit.
          2. Unit-category mismatch — if the seed is volume (ml/l), the scrape
             must not be exclusively weight or piece. Symmetric for weight and
             piece seeds. This catches "200 ml face cream → 100 g soap bar" and
             "80 ct wipes → 250 ml baby shampoo".
          3. Same-category size mismatch — within the same category, the scrape
             number must be within ±15 % of the seed.

        If the scrape carries NO numeric unit at all (e.g. a generic title), we
        trust the rest of the scoring and return True.
        """
        if not scrape_name:
            return True
        if cls._MULTI_PACK_NUM_RE.search(scrape_name) or cls._MULTI_PACK_WORD_RE.search(scrape_name):
            return False
        if not (product.size_value and product.size_unit):
            return True

        seed_cat = cls._seed_category(product.size_unit)
        scrape_cats = cls._scrape_categories(scrape_name)

        # Unit-category mismatch (bidirectional): if the scrape carries unit
        # categories AND none of them includes the seed's category, the
        # candidate is the wrong kind of product.
        if seed_cat in ("volume", "weight", "piece") and scrape_cats and seed_cat not in scrape_cats:
            return False

        # Same-category size tolerance: normalize seed to ml / g / piece and
        # extract candidate numbers in the same canonical units.
        seed_v = float(product.size_value)
        seed_u = product.size_unit.lower()
        if seed_u == "l":
            seed_v *= 1000.0
            seed_u = "ml"
        elif seed_u == "kg":
            seed_v *= 1000.0
            seed_u = "g"

        if seed_u == "ml":
            nums = cls._extract_volume_ml(scrape_name)
        elif seed_u == "g":
            nums = cls._extract_weight_g(scrape_name)
        elif seed_u == "piece":
            nums = cls._extract_piece_counts(scrape_name)
        else:
            nums = []

        if not nums:
            return True
        best_diff = min(abs(n - seed_v) / max(seed_v, 1e-6) for n in nums)
        return best_diff <= 0.15

    @staticmethod
    def _extract_volume_ml(name: str) -> list[float]:
        out: list[float] = []
        for n, unit in re.findall(
            r"(?<![\d.,])(\d+[,.]?\d*)\s*(ml|l(?:iter)?)\b", name, re.IGNORECASE,
        ):
            v = float(n.replace(",", "."))
            out.append(v * 1000.0 if unit.lower().startswith("l") else v)
        return out

    @staticmethod
    def _extract_weight_g(name: str) -> list[float]:
        out: list[float] = []
        for n, unit in re.findall(
            r"(?<![\d.,])(\d+[,.]?\d*)\s*(g(?:ramm)?|kg)\b", name, re.IGNORECASE,
        ):
            v = float(n.replace(",", "."))
            out.append(v * 1000.0 if unit.lower() == "kg" else v)
        return out

    @staticmethod
    def _extract_piece_counts(name: str) -> list[float]:
        out: list[float] = []
        pat = (r"(?<![\d.,])(\d+[,.]?\d*)\s*"
               r"(?:st(?:ü|u)ck|stk\.?|st\.?(?!\w)|ks|kos|kom|szt|buc|db|бр\.?|pieces?|pcs?|tabs?)\b")
        for n in re.findall(pat, name, re.IGNORECASE):
            out.append(float(n.replace(",", ".")))
        return out

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
