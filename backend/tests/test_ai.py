import json
import logging
from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.routes import ai

SECRET = "sk-ant-SECRET-1234567890"
BODY = {"system": "sys", "messages": [{"role": "user", "content": "hi"}]}


def install(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    monkeypatch.setattr(
        ai, "get_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


def ok_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "model": "claude-sonnet-5-5",
            "content": [
                {"type": "text", "text": "Merhaba "},
                {"type": "tool_use", "id": "x", "name": "n", "input": {}},
                {"type": "text", "text": "dünya"},
            ],
            "usage": {"input_tokens": 11, "output_tokens": 7},
        },
    )


def test_status_with_and_without_env(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert client.get("/api/ai/status").json() == {
        "server_key": False,
        "default_model": "claude-sonnet-5-5",
    }
    monkeypatch.setenv("ANTHROPIC_API_KEY", SECRET)
    r = client.get("/api/ai/status")
    assert r.json()["server_key"] is True
    assert SECRET not in r.text


def test_chat_503_without_key(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    install(monkeypatch, ok_handler)
    r = client.post("/api/ai/chat", json=BODY)
    assert r.status_code == 503
    assert r.json()["detail"] == ai.NO_KEY_DETAIL


def test_chat_success_forwards_request(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "env-key")
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return ok_handler(request)

    install(monkeypatch, handler)
    r = client.post(
        "/api/ai/chat",
        json={**BODY, "max_tokens": 100},
        headers={"x-api-key": SECRET},
    )
    assert r.status_code == 200
    assert r.json() == {
        "text": "Merhaba dünya",
        "model": "claude-sonnet-5-5",
        "usage": {"input_tokens": 11, "output_tokens": 7},
    }
    req = seen["req"]
    assert str(req.url) == "https://api.anthropic.com/v1/messages"
    assert req.method == "POST"
    assert req.headers["x-api-key"] == SECRET
    assert req.headers["anthropic-version"] == "2023-06-01"
    assert req.headers["content-type"] == "application/json"
    assert json.loads(req.content) == {
        "model": "claude-sonnet-5-5",
        "max_tokens": 100,
        "system": "sys",
        "messages": [{"role": "user", "content": "hi"}],
    }


def test_chat_uses_env_key_and_defaults(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "env-key")
    seen: dict[str, httpx.Request] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["req"] = request
        return ok_handler(request)

    install(monkeypatch, handler)
    assert client.post("/api/ai/chat", json=BODY).status_code == 200
    assert seen["req"].headers["x-api-key"] == "env-key"
    assert json.loads(seen["req"].content)["max_tokens"] == 1500


@pytest.mark.parametrize(
    ("provider_status", "expected", "detail"),
    [(401, 401, "API anahtarı geçersiz"), (429, 429, None), (400, 400, "bad model"), (500, 502, None)],
)
def test_error_mapping(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    provider_status: int,
    expected: int,
    detail: str | None,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            provider_status, json={"error": {"type": "x", "message": "bad model"}}
        )

    install(monkeypatch, handler)
    r = client.post("/api/ai/chat", json=BODY, headers={"x-api-key": SECRET})
    assert r.status_code == expected
    if detail:
        assert r.json()["detail"] == detail


def test_timeout_maps_to_504(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    install(monkeypatch, handler)
    r = client.post("/api/ai/chat", json=BODY, headers={"x-api-key": SECRET})
    assert r.status_code == 504


def test_connection_error_maps_to_502(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    install(monkeypatch, handler)
    r = client.post("/api/ai/chat", json=BODY, headers={"x-api-key": SECRET})
    assert r.status_code == 502


@pytest.mark.parametrize(
    "body",
    [
        {"system": "s", "messages": []},
        {"system": "s", "messages": [{"role": "assistant", "content": "x"}]},
        {"system": "x" * 60_001, "messages": [{"role": "user", "content": "x"}]},
        {"system": "s", "messages": [{"role": "system", "content": "x"}]},
        {"system": "s", "messages": [{"role": "user", "content": "x" * 20_001}]},
        {"system": "s", "messages": [{"role": "user", "content": "x"}] * 41},
        {**BODY, "max_tokens": 5000},
        {**BODY, "max_tokens": 0},
    ],
)
def test_validation_422(client: TestClient, monkeypatch: pytest.MonkeyPatch, body: dict) -> None:
    install(monkeypatch, ok_handler)
    r = client.post("/api/ai/chat", json=body, headers={"x-api-key": SECRET})
    assert r.status_code == 422


def test_key_never_leaks(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    responses = []

    # provider echoes the key in its 400 message
    install(
        monkeypatch,
        lambda req: httpx.Response(400, json={"error": {"message": f"bad key {SECRET}"}}),
    )
    responses.append(client.post("/api/ai/chat", json=BODY, headers={"x-api-key": SECRET}))
    for status in (401, 429, 500):
        install(monkeypatch, lambda req, s=status: httpx.Response(s, text=SECRET))
        responses.append(client.post("/api/ai/chat", json=BODY, headers={"x-api-key": SECRET}))

    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout(SECRET, request=request)

    install(monkeypatch, boom)
    responses.append(client.post("/api/ai/chat", json=BODY, headers={"x-api-key": SECRET}))
    install(monkeypatch, ok_handler)
    responses.append(client.post("/api/ai/chat", json=BODY, headers={"x-api-key": SECRET}))
    monkeypatch.setenv("ANTHROPIC_API_KEY", SECRET)
    responses.append(client.get("/api/ai/status"))

    for r in responses:
        assert SECRET not in r.text
    assert SECRET not in caplog.text
