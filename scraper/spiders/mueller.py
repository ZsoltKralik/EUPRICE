"""Müller spider — the second pan-EU drugstore retailer.

Müller operates in DE, AT, CH, and (with mixed online-shop coverage) HU, SI,
CZ, IT. Adding it to EUPRICE gives every shared country two independent
retailer witnesses on every EAN — turning DM's "the retailer says this
gtin13 is X" into "DM and Müller both observe gtin13 = X".

Identity gotcha
---------------
Müller's product-detail JSON-LD exposes a `gtin` field, but it carries the
internal Markant article id (e.g. 42428978) — NOT the canonical retail EAN-13.
The actual EAN-13 lives elsewhere on the page: encoded into the product image
filenames as a zero-padded 14-digit string (e.g.
`Markant_42428978_DetailView_04005900917133_F_s01_v11.jpg` → strip the leading
zero → EAN-13 4005900917133).

We extract the EAN-13 from those image URLs and use it as the identity signal.
This is unusual but defensible:
    * The image filename is the retailer's *own* product-packshot file.
    * It is not user-editable metadata — it's part of the product's static
      asset chain.
    * The same EAN appears in 6-9 different image variants per page, so a
      mis-encoding by Müller would have to be consistent across all variants
      to escape detection.

Strict matcher (mirrors `dm.py`)
--------------------------------
For each (product, country):
    (a) EAN-13 found in any of the page's product image filenames equals the
        seed EAN — strongest match, accept (pack-guard still gates).
    (b) Müller-internal SKU id at the end of the URL slug matches the seed
        product's canonical Müller URL (when one exists). Same playbook as
        DM's `/p/d/<sku>/` cross-country anchor.

If neither (a) nor (b) holds, return None. No silent text-search fallback.

Pack-guard
----------
We reuse DM's pack-guard verbatim — same multi-pack patterns, same
bidirectional unit-category check, same ±15 % size tolerance — by composition:
calling `DMSpider._passes_pack_check` rather than re-implementing it.
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
from .dm import DMSpider

log = logging.getLogger(__name__)

# Müller URL conventions verified across mueller.de / .at / .ch:
#   search:   /search/?q=<query>
#   detail:   /p/<slug>-<numeric-sku>/  (e.g. /p/nivea-creme-dose-6554624526/)
SEARCH_URL_TEMPLATE = "{base}/search/?q={q}"

# Catch /p/<slug>-<sku>/ where sku is 6+ digits (verified IDs are 10 digits, but
# we allow 6+ to be safe for future drift).
PRODUCT_LINK_RE = re.compile(r"^/p/[a-z0-9\-]+-(\d{6,})/?$", re.IGNORECASE)

# Müller-internal SKU id captured from canonical URL like /p/<slug>-6554624526/.
# We persist this in product.canonical_url (anchor-country page) when bootstrapping.
_MUELLER_SKU_RE = re.compile(r"/p/[a-z0-9\-]+-(\d{6,})/?", re.IGNORECASE)


def _extract_mueller_sku(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    m = _MUELLER_SKU_RE.search(url)
    return m.group(1) if m else None


# Müller embeds the EAN-13 in product image filenames as a zero-padded
# 14-digit string. Pattern is `_(\d{14})_` in segments like:
#   Markant_42428978_DetailView_04005900917133_F_s01_v11.jpg
# We're lenient: 13 or 14 digits, surrounded by non-digit boundaries.
# A check-digit validation in `_eans_from_jsonld_images` then rejects
# false positives like the Markant id (42428978) zero-padded to 13.
_IMAGE_EAN_RE = re.compile(r"(?<!\d)0?(\d{13})(?!\d)")


def _is_valid_ean13(ean: str) -> bool:
    """Standard GS1 EAN-13 check-digit validation.

    Multiply each of the first 12 digits by 1 or 3 alternately (3 on
    every even position from the left, counting from 1), sum, and the
    13th digit should make the total a multiple of 10.
    """
    if not ean or len(ean) != 13 or not ean.isdigit():
        return False
    total = 0
    for i, ch in enumerate(ean[:12]):
        total += int(ch) * (3 if i % 2 else 1)
    check = (10 - total % 10) % 10
    return check == int(ean[12])


def _eans_from_jsonld_images(images, markant_id: Optional[str] = None) -> set[str]:
    """Return every check-digit-valid EAN-13 we can lift out of image URLs.

    Müller's product image filenames embed the EAN-13 as a zero-padded
    14-digit string (e.g. `_04005900917133_`). The Markant article id
    (8 digits) is also zero-padded to 13 (`_00000042428978_`) in many
    filenames — and ~10 % of random Markant ids happen to also pass the
    EAN-13 check-digit algorithm.

    Filters that together kill the false positives:

      1. **Check-digit validity** (GS1 algorithm) — required for any EAN-13.
      2. **Explicit Markant-id exclusion** — when the JSON-LD exposes
         a `gtin` field (the Markant article id, ~8 digits), reject any
         candidate equal to it zero-padded to 13 or 8. This is the primary
         disambiguator between real EAN-13s and Markant-id false-positives.

    Note: we previously rejected all candidates with 4+ leading zeros, but
    that breaks for products with GTIN-8 EANs (e.g. small-package
    deodorant SKUs where Nivea = 42495277 → EAN-13 form 0000042495277).
    The Markant-id exclusion above does the disambiguation more precisely.
    """
    out: set[str] = set()
    if not images:
        return out
    if isinstance(images, (str, dict)):
        images = [images]
    markant_padded = markant_id.zfill(13) if markant_id else None
    for img in images:
        if isinstance(img, dict):
            url = img.get("url") or img.get("contentUrl") or img.get("@id")
        else:
            url = img
        if not isinstance(url, str):
            continue
        # Grab the basename so a 13-digit substring of the host or a
        # CDN cache-buster can't false-positive.
        basename = url.rsplit("/", 1)[-1]
        for m in _IMAGE_EAN_RE.finditer(basename):
            candidate = m.group(1)
            if not _is_valid_ean13(candidate):
                continue
            if markant_padded and candidate == markant_padded:
                continue
            # Strip leading zeros to canonical form — matches DM's JSON-LD
            # which exposes the bare GTIN-8 / GTIN-12 / GTIN-13 without
            # zero-padding. So a Müller image filename containing
            # `_0000042495277_` becomes the EAN string "42495277", which
            # equals what DM's JSON-LD gtin field carries.
            canonical = candidate.lstrip("0") or "0"
            out.add(canonical)
    return out


class MuellerSpider(Spider):
    """Strict-matching Müller spider modeled on DMSpider."""

    shop_code = "mueller"

    def scrape(self, product: ProductSpec, sc: ShopCountry) -> Optional[ScrapedPrice]:
        seed_sku = _extract_mueller_sku(product.canonical_url)

        def _try_candidate(url: str, scrape_variants_too: bool) -> Optional[ScrapedPrice]:
            """Fetch a candidate URL, apply strict acceptance, optionally walk
            sibling variants if the size doesn't match the seed."""
            try:
                candidate = self._scrape_detail(url, sc)
            except Exception as e:  # noqa: BLE001
                log.warning("Müller %s: detail fetch failed for %s: %s", sc.country_code, url, e)
                return None
            if not candidate:
                return None
            if DMSpider._passes_pack_check(candidate.product_name_local, product):
                if candidate.ean == product.ean:
                    log.info("Müller %s: EAN-matched %s", sc.country_code, url)
                    return candidate
                cand_sku = _extract_mueller_sku(candidate.url)
                if seed_sku and cand_sku == seed_sku:
                    log.info(
                        "Müller %s: SKU-matched %s (seed sku=%s, image-ean=%s)",
                        sc.country_code, candidate.url, seed_sku, candidate.ean,
                    )
                    return candidate
                return None
            # Pack-check failed. If sibling-variant resolution is enabled,
            # try every variant (?itemId=NNN) link on the page — Müller groups
            # all sizes of one product on one URL, switching variant via
            # query param. A different size variant might pass.
            if not scrape_variants_too:
                return None
            try:
                res = self.fetcher.get(url)
                variant_links = self._extract_variant_links(res.html, sc.base_url)
            except Exception as e:  # noqa: BLE001
                log.debug("Müller %s: variant fetch failed for %s: %s", sc.country_code, url, e)
                return None
            for v_url, v_size in variant_links:
                if v_url == url:
                    continue
                log.info("Müller %s: trying variant %s (%s)", sc.country_code, v_url, v_size)
                resolved = _try_candidate(v_url, scrape_variants_too=False)
                if resolved:
                    return resolved
            log.info(
                "Müller %s: rejecting %s — pack mismatch and no matching variant",
                sc.country_code, url,
            )
            return None

        # Phase 1: EAN search if we know it (we always will for cross-country
        # passes; only the anchor-country bootstrap runs without).
        if product.ean:
            for url in self._search(product.ean, sc)[:5]:
                hit = _try_candidate(url, scrape_variants_too=True)
                if hit:
                    return hit

            # Try the brand-name search too — Müller's EAN index occasionally
            # 404s for products that exist under a title-search.
            for url in self._search(product.search_hint, sc)[:6]:
                hit = _try_candidate(url, scrape_variants_too=True)
                if hit:
                    return hit

            log.info(
                "Müller %s: no page carries EAN %s or SKU %s for %r",
                sc.country_code, product.ean, seed_sku, product.search_hint,
            )
            return None

        # Phase 2 (bootstrap on anchor country without EAN): fall back to
        # scored text search. Same logic as DM: pack-guard + producer-token +
        # ≥0.5 name overlap.
        urls = self._search(product.search_hint, sc)
        best: Optional[tuple[float, ScrapedPrice]] = None
        for url in urls[:8]:
            try:
                candidate = self._scrape_detail(url, sc)
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "Müller %s: bootstrap detail failed for %s: %s",
                    sc.country_code, url, e,
                )
                continue
            if not candidate:
                continue
            if not DMSpider._passes_pack_check(candidate.product_name_local, product):
                continue
            score = DMSpider._match_score(candidate.product_name_local, product)
            if best is None or score > best[0]:
                best = (score, candidate)
        if best and best[0] >= 0.5:
            return best[1]
        log.info(
            "Müller %s: no candidate scored well for %r (best=%.2f, no EAN seed)",
            sc.country_code, product.search_hint, best[0] if best else 0.0,
        )
        return None

    # ----------------------------------------------------------------- search

    def _search(self, query: str, sc: ShopCountry) -> list[str]:
        url = SEARCH_URL_TEMPLATE.format(base=sc.base_url.rstrip("/"), q=quote_plus(query))
        try:
            res = self.fetcher.get(url)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "Müller %s: static search GET failed (%s); trying rendered",
                sc.country_code, e,
            )
            try:
                res = self.fetcher.get_rendered(url)
            except Exception as e2:  # noqa: BLE001
                log.warning("Müller %s: rendered also failed: %s", sc.country_code, e2)
                return []
        urls = self._extract_product_urls(res.html, sc.base_url)
        if not urls:
            try:
                res = self.fetcher.get_rendered(url)
                urls = self._extract_product_urls(res.html, sc.base_url)
            except Exception as e:  # noqa: BLE001
                log.debug("Müller %s: rendered retry failed: %s", sc.country_code, e)
        return urls

    @staticmethod
    def _extract_product_urls(html: str, base_url: str) -> list[str]:
        """Pull every /p/<slug>-<sku>/ href out of the search-result HTML.

        Müller's search uses Next.js client-side hydration, so the static HTML
        may be sparse — but it still embeds the top results as <a href="/p/..."/>
        for SEO. If the static HTML has zero matches the caller falls back to
        the rendered backend.
        """
        tree = HTMLParser(html)
        seen: set[str] = set()
        out: list[str] = []
        for node in tree.css("a[href]"):
            href = node.attributes.get("href")
            if not href:
                continue
            # Allow absolute or relative product URLs
            if href.startswith("http"):
                # Only same-origin
                if base_url.rstrip("/") not in href:
                    continue
                path = href[len(base_url.rstrip("/")):]
            else:
                path = href
            # /p/<slug>-<sku>/ OR /p/<slug>-<sku>
            m = PRODUCT_LINK_RE.match(path.split("?", 1)[0].rstrip("/") + "/")
            if not m:
                continue
            full = urljoin(base_url, path)
            if full in seen:
                continue
            seen.add(full)
            out.append(full)
        return out

    # ----------------------------------------------------------------- detail

    # Müller renders the size as: <span class="bold">30 ml</span> inside an
    # "Inhalt: …" cell. The size is critically absent from the JSON-LD name,
    # so the pack-guard depends on us extracting it from HTML and grafting it
    # onto the candidate name before the size-tolerance check runs.
    _INHALT_RE = re.compile(
        r'Inhalt[^<]*<[^>]*>\s*(\d+[,.]?\d*\s*'
        r'(?:ml|l(?:iter)?|g(?:ramm)?|kg|st(?:ü|u)ck|stk\.?|st\.?(?!\w)|'
        r'pcs?|pieces?|tabs?))\s*<',
        re.IGNORECASE,
    )
    # Fallback: any `<span class="bold">NN unit</span>` near the top of the page.
    _SPAN_BOLD_SIZE_RE = re.compile(
        r'class="[^"]*bold[^"]*"\s*>\s*(\d+[,.]?\d*\s*(?:ml|l|g|kg|st(?:ü|u)ck|stk\.?))\s*<',
        re.IGNORECASE,
    )

    # Müller groups all pack-size variants of one product under the same
    # /p/<slug>-<sku>/ URL; the active variant is selected via `?itemId=NNN`.
    # The page renders sibling-variant anchors as
    #     <a … href="/p/nivea-creme-dose-6554624526/?itemId=268468">150 ml</a>
    # We harvest all of these so the spider can re-fetch the variant that
    # matches the seed size when the default landing doesn't.
    _VARIANT_LINK_RE = re.compile(
        r'href="(/p/[a-z0-9\-]+-\d+/\?itemId=\d+)"[^>]*>'
        r'\s*(\d+[,.]?\d*\s*(?:ml|l|g|kg|st(?:ü|u)ck|stk\.?|pcs?|pieces?|tabs?))',
        re.IGNORECASE,
    )

    @classmethod
    def _extract_size_string(cls, html: str) -> Optional[str]:
        m = cls._INHALT_RE.search(html)
        if m:
            return m.group(1)
        m = cls._SPAN_BOLD_SIZE_RE.search(html)
        if m:
            return m.group(1)
        return None

    @classmethod
    def _extract_variant_links(cls, html: str, base_url: str) -> list[tuple[str, str]]:
        """Return [(absolute_url, size_string), …] for every pack-size variant
        on the page. Used when the default landing variant doesn't match the
        seed size — we can re-fetch the matching variant via ?itemId=NNN."""
        out: list[tuple[str, str]] = []
        seen: set[str] = set()
        for m in cls._VARIANT_LINK_RE.finditer(html):
            href = m.group(1)
            size = m.group(2).strip()
            if href in seen:
                continue
            seen.add(href)
            full = urljoin(base_url, href)
            out.append((full, size))
        return out

    def _scrape_detail(self, url: str, sc: ShopCountry) -> Optional[ScrapedPrice]:
        res = self.fetcher.get(url)
        if res.status_code != 200 or not res.html:
            return None
        data = self._extract_jsonld_product(res.html)
        if data is None:
            res = self.fetcher.get_rendered(url)
            data = self._extract_jsonld_product(res.html)
        if data is None:
            log.debug("Müller %s: no JSON-LD product on %s", sc.country_code, url)
            return None

        # offers can be a list of Offer or a single Offer
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

        # Critical: append the HTML-rendered Inhalt: NN unit to the candidate
        # name so the pack-guard's size-tolerance check sees it. Müller's
        # JSON-LD `name` field omits the size, which would otherwise let
        # multi-size variants (30 ml vs 150 ml Nivea Creme) silently match.
        size_str = self._extract_size_string(res.html)
        if size_str:
            name = f"{name} {size_str}"

        # The EAN-13 lives in the image filenames, not in the JSON-LD `gtin`
        # (which is the Markant article id). Pass the Markant id so the
        # extractor can exclude its zero-padded form.
        markant_id = data.get("gtin")
        markant_str = str(markant_id) if markant_id is not None else None
        ean_candidates = _eans_from_jsonld_images(data.get("image"), markant_str)
        ean = next(iter(ean_candidates), None)  # take any — should be unique per page

        image_val = data.get("image")
        if isinstance(image_val, list):
            image_url = image_val[0] if image_val else None
        elif isinstance(image_val, dict):
            image_url = image_val.get("url") or image_val.get("contentUrl")
        else:
            image_url = image_val
        if image_url is not None:
            image_url = str(image_url)

        # Promo: Müller's JSON-LD doesn't expose a ListPrice; HTML strike-through
        # is the only signal we can rely on.
        regular_price = self._extract_regular_price(res.html, price_local)
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
            raw={"jsonld_offers": offers, "markant_id": data.get("gtin")},
            raw_html_sha256=res.sha256,
            raw_html_path=res.archive_path,
        )

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _extract_jsonld_product(html: str) -> Optional[dict]:
        """Find the @type=Product JSON-LD object on a Müller detail page."""
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
    def _extract_regular_price(cls, html: str, current: float) -> Optional[float]:
        """Best-effort: HTML strike-through markers for a non-promo reference price."""
        tree = HTMLParser(html)
        candidates = [
            ".price__strike", ".strike", ".price-strike",
            "[data-testid*='strike']", "[data-cy*='strike']",
            "del", "s.price", "del.price",
        ]
        for sel in candidates:
            for node in tree.css(sel):
                p = cls._parse_price(node.text(strip=True))
                if p is not None and p > current:
                    return p
        return None


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
