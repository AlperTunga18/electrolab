"""Octopart/Nexar adapter (user's own Nexar app credentials).

Official docs / schema (verified):
- Token: POST https://identity.nexar.com/connect/token, form grant_type=client_credentials,
  client_id, client_secret, scope=supply.domain
  https://www.altium.com/documentation/altium-developer-center/octopart/api/authorization
- GraphQL: POST https://api.nexar.com/graphql with Authorization: Bearer <token>;
  field names checked against the public SDL https://api.nexar.com/graphql?sdl
  (supSearch(q, limit), SupPart.mpn/manufacturer{name}/shortDescription/bestDatasheet{url}/
  sellers{company{name} offers{sku inventoryLevel clickUrl prices{quantity price currency}}}).
- bestDatasheet needs a Nexar plan with the DATASHEETS feature; we retry without it on error.
"""
from typing import Any

import httpx

from . import models as m

TOKEN_URL = "https://identity.nexar.com/connect/token"
GRAPHQL_URL = "https://api.nexar.com/graphql"

_SELLERS = """
        sellers(includeBrokers: false) {
          company { name }
          offers { sku inventoryLevel clickUrl prices { quantity price currency } }
        }"""
QUERY_FULL = (
    "query Q($q: String!, $limit: Int) { supSearch(q: $q, limit: $limit) { results { part {"
    " mpn manufacturer { name } shortDescription bestDatasheet { url }" + _SELLERS + " } } } }"
)
QUERY_NO_DS = (
    "query Q($q: String!, $limit: Int) { supSearch(q: $q, limit: $limit) { results { part {"
    " mpn manufacturer { name } shortDescription" + _SELLERS + " } } } }"
)


async def _token(client: httpx.AsyncClient, cid: str, secret: str) -> str:
    try:
        r = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "client_credentials",
                "client_id": cid,
                "client_secret": secret,
                "scope": "supply.domain",
            },
        )
    except httpx.HTTPError as e:
        raise m.network_error(e) from None
    if r.status_code in (400, 401, 403):  # identity server answers 400 invalid_client
        raise m.PartsError(401, "Anahtar geçersiz veya yetkisiz")
    err = m.map_status(r.status_code)
    if err:
        raise err
    try:
        tok = r.json().get("access_token")
    except (ValueError, AttributeError):
        tok = None
    if not isinstance(tok, str) or not tok:
        raise m.PartsError(502, "Sağlayıcı yanıtı çözümlenemedi")
    return tok


async def _gql(client: httpx.AsyncClient, token: str, query: str, q: str, limit: int) -> dict[str, Any]:
    try:
        r = await client.post(
            GRAPHQL_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={"query": query, "variables": {"q": q, "limit": limit}},
        )
    except httpx.HTTPError as e:
        raise m.network_error(e) from None
    err = m.map_status(r.status_code)
    if err:
        raise err
    try:
        body = r.json()
        return body if isinstance(body, dict) else {}
    except ValueError:
        raise m.PartsError(502, "Sağlayıcı yanıtı çözümlenemedi") from None


def _parse(body: dict[str, Any], fetched: str) -> list[m.PartResult]:
    data = body.get("data") or {}
    results = ((data.get("supSearch") or {}).get("results")) or []
    out: list[m.PartResult] = []
    for item in results:
        p = (item or {}).get("part") or {}
        ds = p.get("bestDatasheet") or {}
        offers: list[m.Offer] = []
        for s in p.get("sellers") or []:
            name = ((s or {}).get("company") or {}).get("name") or "?"
            for o in (s or {}).get("offers") or []:
                offers.append(
                    m.Offer(
                        distributor=name,
                        sku=o.get("sku"),
                        stock=o.get("inventoryLevel"),
                        url=o.get("clickUrl"),
                        price_breaks=[
                            m.PriceBreak(qty=int(pr["quantity"]), price=float(pr["price"]), currency=str(pr["currency"]))
                            for pr in o.get("prices") or []
                            if isinstance(pr, dict) and pr.get("quantity") is not None and pr.get("price") is not None
                        ],
                    )
                )
        out.append(
            m.PartResult(
                provider="nexar",
                mpn=str(p.get("mpn") or ""),
                manufacturer=str((p.get("manufacturer") or {}).get("name") or ""),
                description=str(p.get("shortDescription") or ""),
                datasheet_urls=[ds["url"]] if ds.get("url") else [],
                offers=offers,
                fetched_at=fetched,
            )
        )
    return out


async def search(query: str, client_id: str | None, client_secret: str | None, limit: int = 10) -> m.SearchResponse:
    if not client_id or not client_secret:
        raise m.PartsError(401, "API anahtarı gerekli: Nexar client id ve client secret girin")
    notes: list[str] = []
    async with m.get_client() as client:
        token = await _token(client, client_id, client_secret)
        body = await _gql(client, token, QUERY_FULL, query, limit)
        has_data = bool((body.get("data") or {}).get("supSearch"))
        if body.get("errors") and not has_data:
            body = await _gql(client, token, QUERY_NO_DS, query, limit)
            notes.append("Datasheet alanı Nexar planınızda kullanılamadı; datasheet bağlantısı yok.")
        elif body.get("errors"):
            notes.append("Nexar bazı alanlar için uyarı döndürdü; veriler eksik olabilir.")
    if not (body.get("data") or {}).get("supSearch"):
        if body.get("errors"):
            raise m.PartsError(502, "Nexar sorgu hatası döndürdü")
        raise m.PartsError(502, "Sağlayıcı yanıtı çözümlenemedi")
    return m.SearchResponse(provider="nexar", query=query, results=_parse(body, m.now_iso()), notes=notes)
