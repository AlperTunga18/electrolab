from datetime import UTC, datetime
from typing import Literal

import httpx
from pydantic import BaseModel, Field

Provider = Literal["nexar", "mouser"]


class PriceBreak(BaseModel):
    qty: int
    price: float
    currency: str


class Offer(BaseModel):
    distributor: str
    sku: str | None = None
    stock: int | None = None
    price_breaks: list[PriceBreak] = Field(default_factory=list)
    url: str | None = None


class PartResult(BaseModel):
    provider: Provider
    mpn: str
    manufacturer: str
    description: str
    datasheet_urls: list[str] = Field(default_factory=list)
    offers: list[Offer] = Field(default_factory=list)
    fetched_at: str


class SearchResponse(BaseModel):
    provider: Provider
    query: str
    results: list[PartResult]
    notes: list[str] = Field(default_factory=list)


class ProviderInfo(BaseModel):
    id: str
    name: str
    status: Literal["available", "planned", "unsupported"]
    note: str


class PartsError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def get_client() -> httpx.AsyncClient:
    """Overridable factory so tests never touch the network."""
    return httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=8.0))


def map_status(status: int) -> PartsError | None:
    if status in (401, 403):
        return PartsError(401, "Anahtar geçersiz veya yetkisiz")
    if status == 429:
        return PartsError(429, "İstek sınırı aşıldı, biraz sonra tekrar deneyin")
    if status >= 400:
        return PartsError(502, f"Sağlayıcı hatası ({status})")
    return None


def network_error(exc: Exception) -> PartsError:
    if isinstance(exc, httpx.TimeoutException):
        return PartsError(504, "Sağlayıcı zaman aşımına uğradı")
    return PartsError(502, "Sağlayıcıya ulaşılamadı, internet bağlantınızı kontrol edin")
