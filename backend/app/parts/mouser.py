"""Mouser Search API adapter (user's own Search API key).

Official docs (verified from the published swagger https://api.mouser.com/api/docs/V1,
UI https://api.mouser.com/api/docs/ui/index):
- POST https://api.mouser.com/api/v1/search/keyword?apiKey=<key>
- body {"SearchByKeywordRequest": {"keyword", "records", "startingRecord", "searchOptions"}}
- response {"Errors": [ErrorEntity], "SearchResults": {"NumberOfResult", "Parts": [MouserPart]}}
- MouserPart: ManufacturerPartNumber, MouserPartNumber, Manufacturer, Description, DataSheetUrl,
  ProductDetailUrl, AvailabilityInStock (string), PriceBreaks[{Quantity, Price (string, with
  currency symbol), RawPrice (double), Currency}]
"""
import re
from typing import Any

import httpx

from . import models as m

URL = "https://api.mouser.com/api/v1/search/keyword"


def _int(v: Any) -> int | None:
    digits = re.sub(r"[^\d]", "", str(v or ""))
    return int(digits) if digits else None


def _parse(parts: list[dict[str, Any]], fetched: str) -> list[m.PartResult]:
    out: list[m.PartResult] = []
    for p in parts:
        pbs: list[m.PriceBreak] = []
        for pb in p.get("PriceBreaks") or []:
            raw = pb.get("RawPrice")
            if raw is None or pb.get("Quantity") is None:
                continue  # never guess a price from the formatted string
            pbs.append(m.PriceBreak(qty=int(pb["Quantity"]), price=float(raw), currency=str(pb.get("Currency") or "")))
        ds = p.get("DataSheetUrl")
        out.append(
            m.PartResult(
                provider="mouser",
                mpn=str(p.get("ManufacturerPartNumber") or ""),
                manufacturer=str(p.get("Manufacturer") or ""),
                description=str(p.get("Description") or ""),
                datasheet_urls=[ds] if ds else [],
                offers=[
                    m.Offer(
                        distributor="Mouser",
                        sku=p.get("MouserPartNumber"),
                        stock=_int(p.get("AvailabilityInStock")),
                        price_breaks=pbs,
                        url=p.get("ProductDetailUrl"),
                    )
                ],
                fetched_at=fetched,
            )
        )
    return out


async def search(query: str, api_key: str | None, limit: int = 10) -> m.SearchResponse:
    if not api_key:
        raise m.PartsError(401, "API anahtarı gerekli: Mouser Search API anahtarını girin")
    body = {"SearchByKeywordRequest": {"keyword": query, "records": limit, "startingRecord": 0, "searchOptions": "None"}}
    try:
        async with m.get_client() as client:
            r = await client.post(URL, params={"apiKey": api_key}, json=body)
    except httpx.HTTPError as e:
        raise m.network_error(e) from None
    err = m.map_status(r.status_code)
    if err:
        raise err
    try:
        data = r.json()
        errors = data.get("Errors") or []
        res = data.get("SearchResults") or {}
        parts = res.get("Parts") or []
    except (ValueError, AttributeError):
        raise m.PartsError(502, "Sağlayıcı yanıtı çözümlenemedi") from None
    if errors:
        codes = " ".join(str(e.get("Code", "")) for e in errors if isinstance(e, dict)).lower()
        if "invalid" in codes:
            raise m.PartsError(401, "Anahtar geçersiz veya yetkisiz")
        if "toomany" in codes or "limit" in codes:
            raise m.PartsError(429, "İstek sınırı aşıldı, biraz sonra tekrar deneyin")
        raise m.PartsError(502, "Mouser hata döndürdü")
    return m.SearchResponse(provider="mouser", query=query, results=_parse(parts, m.now_iso()))
