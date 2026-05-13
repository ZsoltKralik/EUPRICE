"""Fetch ECB euro reference rates.

ECB publishes daily reference rates at:
    https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
Each rate is "1 EUR = X units of currency" — matches our `fx_rate` column on price.

We fetch once per scrape run and pass the dict to the orchestrator. No caching
table in the DB; the rate used for each conversion is recorded on the price row.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Optional

import httpx

ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
NS = {"gesmes": "http://www.gesmes.org/xml/2002-08-01",
      "ecb": "http://www.ecb.int/vocabulary/2002-08-01/eurofxref"}


def fetch_ecb_daily(client: Optional[httpx.Client] = None) -> tuple[str, dict[str, float]]:
    """Returns (rate_date, {currency_code: units_per_eur}). EUR -> 1.0 always included."""
    owns = client is None
    client = client or httpx.Client(timeout=15.0, follow_redirects=True)
    try:
        resp = client.get(ECB_DAILY_URL)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        cube_day = root.find(".//ecb:Cube/ecb:Cube", NS)
        if cube_day is None:
            raise RuntimeError("ECB feed: missing daily cube")
        rate_date = cube_day.attrib["time"]
        rates: dict[str, float] = {"EUR": 1.0}
        for child in cube_day.findall("ecb:Cube", NS):
            rates[child.attrib["currency"]] = float(child.attrib["rate"])
        # Bulgarian lev is pegged to EUR at 1.95583; ECB sometimes omits it.
        rates.setdefault("BGN", 1.95583)
        return rate_date, rates
    finally:
        if owns:
            client.close()
