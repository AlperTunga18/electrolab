import logging
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.parts import models

SECRET = "MOUSER-KEY-SECRET-123456"
CID, CSEC = "nexar-id-ABC", "nexar-SECRET-XYZ"


def install(monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]) -> None:
    monkeypatch.setattr(models, "get_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


MOUSER_OK = {
    "Errors": [],
    "SearchResults": {
        "NumberOfResult": 1,
        "Parts": [{
            "ManufacturerPartNumber": "1N4148", "MouserPartNumber": "512-1N4148", "Manufacturer": "onsemi",
            "Description": "Diode", "DataSheetUrl": "https://example.com/ds.pdf",
            "ProductDetailUrl": "https://www.mouser.com/ProductDetail/x", "AvailabilityInStock": "12,345",
            "PriceBreaks": [{"Quantity": 1, "Price": "$0.10", "RawPrice": 0.1, "Currency": "USD"},
                            {"Quantity": 100, "Price": "$0.05", "Currency": "USD"}],
        }],
    },
}


def test_mouser_ok_and_no_leak(client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    seen: list[httpx.Request] = []

    def h(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=MOUSER_OK)

    install(monkeypatch, h)
    caplog.set_level(logging.DEBUG)
    r = client.get("/api/parts/search", params={"provider": "mouser", "q": "1N4148"}, headers={"x-mouser-api-key": SECRET})
    assert r.status_code == 200
    assert seen[0].url.params["apiKey"] == SECRET
    d = r.json()["results"][0]
    assert d["provider"] == "mouser" and d["mpn"] == "1N4148" and d["fetched_at"]
    o = d["offers"][0]
    assert o["stock"] == 12345 and o["distributor"] == "Mouser"
    assert o["price_breaks"] == [{"qty": 1, "price": 0.1, "currency": "USD"}]  # price w/o RawPrice dropped
    assert d["datasheet_urls"] == ["https://example.com/ds.pdf"]
    assert SECRET not in r.text and SECRET not in caplog.text


def test_mouser_key_missing(client: TestClient) -> None:
    r = client.get("/api/parts/search", params={"provider": "mouser", "q": "x"})
    assert r.status_code == 401 and "gerekli" in r.json()["detail"]


@pytest.mark.parametrize("code,expect", [(401, 401), (403, 401), (429, 429), (500, 502)])
def test_mouser_status_map(client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, code: int, expect: int) -> None:
    install(monkeypatch, lambda req: httpx.Response(code, text=f"bad {SECRET}"))
    caplog.set_level(logging.DEBUG)
    r = client.get("/api/parts/search", params={"provider": "mouser", "q": "x"}, headers={"x-mouser-api-key": SECRET})
    assert r.status_code == expect
    assert SECRET not in r.text and SECRET not in caplog.text


def test_mouser_errors_array_and_network(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    body = {"Errors": [{"Code": "InvalidCredentials", "Message": "Invalid unique identifier key"}], "SearchResults": None}
    install(monkeypatch, lambda req: httpx.Response(200, json=body))
    h = {"x-mouser-api-key": SECRET}
    p = {"provider": "mouser", "q": "x"}
    assert client.get("/api/parts/search", params=p, headers=h).status_code == 401

    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"fail {SECRET}")

    install(monkeypatch, boom)
    r = client.get("/api/parts/search", params=p, headers=h)
    assert r.status_code == 502 and SECRET not in r.text

    def slow(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("t")

    install(monkeypatch, slow)
    assert client.get("/api/parts/search", params=p, headers=h).status_code == 504


NEXAR_BODY = {"data": {"supSearch": {"results": [{"part": {
    "mpn": "LM339", "manufacturer": {"name": "TI"}, "shortDescription": "Comparator",
    "bestDatasheet": {"url": "https://example.com/lm339.pdf"},
    "sellers": [{"company": {"name": "DigiKey"}, "offers": [
        {"sku": "296-1", "inventoryLevel": 500, "clickUrl": "https://octopart.com/click/x",
         "prices": [{"quantity": 1, "price": 0.5, "currency": "USD"}, {"quantity": 10, "price": 0.4, "currency": "USD"}]}]}],
}}]}}}


def nexar_handler(calls: list[httpx.Request], gql: Callable[[httpx.Request], httpx.Response]) -> Callable[[httpx.Request], httpx.Response]:
    def h(req: httpx.Request) -> httpx.Response:
        calls.append(req)
        if str(req.url) == "https://identity.nexar.com/connect/token":
            return httpx.Response(200, json={"access_token": "TOKEN-123", "expires_in": 86400, "token_type": "Bearer"})
        assert str(req.url) == "https://api.nexar.com/graphql"
        return gql(req)

    return h


NH = {"x-nexar-client-id": CID, "x-nexar-client-secret": CSEC}
NP = {"provider": "nexar", "q": "LM339"}


def test_nexar_ok_no_leak(client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    calls: list[httpx.Request] = []
    install(monkeypatch, nexar_handler(calls, lambda req: httpx.Response(200, json=NEXAR_BODY)))
    caplog.set_level(logging.DEBUG)
    r = client.get("/api/parts/search", params=NP, headers=NH)
    assert r.status_code == 200
    assert b"grant_type=client_credentials" in calls[0].content and b"scope=supply.domain" in calls[0].content
    assert calls[1].headers["authorization"] == "Bearer TOKEN-123"
    d = r.json()["results"][0]
    assert d["mpn"] == "LM339" and d["manufacturer"] == "TI" and d["datasheet_urls"] == ["https://example.com/lm339.pdf"]
    assert d["offers"][0]["distributor"] == "DigiKey" and d["offers"][0]["stock"] == 500
    assert len(d["offers"][0]["price_breaks"]) == 2
    for s in (CSEC, CID, "TOKEN-123"):
        assert s not in r.text and s not in caplog.text


def test_nexar_missing_keys(client: TestClient) -> None:
    assert client.get("/api/parts/search", params=NP).status_code == 401
    assert client.get("/api/parts/search", params=NP, headers={"x-nexar-client-id": CID}).status_code == 401


def test_nexar_bad_credentials_and_429(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, lambda req: httpx.Response(400, json={"error": "invalid_client"}))
    r = client.get("/api/parts/search", params=NP, headers=NH)
    assert r.status_code == 401 and CSEC not in r.text
    calls: list[httpx.Request] = []
    install(monkeypatch, nexar_handler(calls, lambda req: httpx.Response(429)))
    assert client.get("/api/parts/search", params=NP, headers=NH).status_code == 429
    install(monkeypatch, nexar_handler(calls, lambda req: httpx.Response(401)))
    assert client.get("/api/parts/search", params=NP, headers=NH).status_code == 401


def test_nexar_datasheet_field_retry(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    n = {"i": 0}

    def gql(req: httpx.Request) -> httpx.Response:
        n["i"] += 1
        if n["i"] == 1:
            assert b"bestDatasheet" in req.content
            return httpx.Response(200, json={"data": None, "errors": [{"message": "plan"}]})
        assert b"bestDatasheet" not in req.content
        body = {"data": {"supSearch": {"results": [{"part": {"mpn": "X", "manufacturer": {"name": "M"}, "shortDescription": "d", "sellers": []}}]}}}
        return httpx.Response(200, json=body)

    install(monkeypatch, nexar_handler([], gql))
    r = client.get("/api/parts/search", params=NP, headers=NH)
    assert r.status_code == 200 and r.json()["results"][0]["datasheet_urls"] == [] and r.json()["notes"]


def test_nexar_network_error(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("x")

    install(monkeypatch, boom)
    assert client.get("/api/parts/search", params=NP, headers=NH).status_code == 502


def test_providers_and_unsupported(client: TestClient) -> None:
    ids = {p["id"]: p["status"] for p in client.get("/api/parts/providers").json()}
    assert ids == {"nexar": "available", "mouser": "available", "snapeda": "planned", "lcsc": "unsupported"}
    assert client.get("/api/parts/search", params={"provider": "lcsc", "q": "x"}).status_code == 400
