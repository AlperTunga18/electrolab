import os
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

router = APIRouter(prefix="/api/ai", tags=["ai"])

DEFAULT_MODEL = "claude-sonnet-5-5"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
NO_KEY_DETAIL = (
    "API anahtarı yok: Ayarlar → Yapay zekâ bölümüne anahtar girin "
    "veya sunucuda ANTHROPIC_API_KEY ayarlayın"
)


def get_client() -> httpx.AsyncClient:
    """Overridable factory so tests never touch the network."""
    return httpx.AsyncClient(timeout=60)


class AiStatus(BaseModel):
    server_key: bool
    default_model: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20_000)


class ChatRequest(BaseModel):
    model: str = DEFAULT_MODEL
    system: str = Field(max_length=60_000)
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    max_tokens: int = Field(default=1500, ge=1, le=4096)

    @field_validator("messages")
    @classmethod
    def _first_is_user(cls, v: list[ChatMessage]) -> list[ChatMessage]:
        if v[0].role != "user":
            raise ValueError("first message must have role 'user'")
        return v


class Usage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class ChatResponse(BaseModel):
    text: str
    model: str
    usage: Usage


@router.get("/status", response_model=AiStatus)
def status() -> AiStatus:
    return AiStatus(
        server_key=bool(os.environ.get("ANTHROPIC_API_KEY")),
        default_model=DEFAULT_MODEL,
    )


def _provider_message(resp: httpx.Response, key: str) -> str:
    msg = "Geçersiz istek"
    try:
        data: Any = resp.json()
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict) and isinstance(err.get("message"), str):
            msg = err["message"]
    except ValueError:
        pass
    return msg.replace(key, "***") if key else msg


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    x_api_key: str | None = Header(default=None),
) -> ChatResponse:
    key = x_api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(503, NO_KEY_DETAIL)

    body = {
        "model": req.model,
        "max_tokens": req.max_tokens,
        "system": req.system,
        "messages": [m.model_dump() for m in req.messages],
    }
    headers = {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    try:
        async with get_client() as client:
            resp = await client.post(ANTHROPIC_URL, headers=headers, json=body)
    except httpx.TimeoutException:
        raise HTTPException(504, "Sağlayıcı zaman aşımına uğradı") from None
    except httpx.HTTPError:
        raise HTTPException(502, "Sağlayıcıya ulaşılamadı") from None

    if resp.status_code == 401:
        raise HTTPException(401, "API anahtarı geçersiz")
    if resp.status_code == 429:
        raise HTTPException(429, "İstek sınırı aşıldı, biraz sonra tekrar deneyin")
    if resp.status_code == 400:
        raise HTTPException(400, _provider_message(resp, key))
    if resp.status_code != 200:
        raise HTTPException(502, f"Sağlayıcı hatası ({resp.status_code})")

    try:
        data = resp.json()
        text = "".join(
            b.get("text", "")
            for b in data.get("content", [])
            if isinstance(b, dict) and b.get("type") == "text"
        )
        usage = data.get("usage") or {}
        return ChatResponse(
            text=text,
            model=str(data.get("model", req.model)),
            usage=Usage(
                input_tokens=int(usage.get("input_tokens", 0)),
                output_tokens=int(usage.get("output_tokens", 0)),
            ),
        )
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(502, "Sağlayıcı yanıtı çözümlenemedi") from None
