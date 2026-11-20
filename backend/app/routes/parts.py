from fastapi import APIRouter, Header, HTTPException, Query

from ..parts import mouser, nexar
from ..parts.models import PartsError, ProviderInfo, SearchResponse

router = APIRouter(prefix="/api/parts", tags=["parts"])

PROVIDERS = [
    ProviderInfo(id="nexar", name="Octopart / Nexar", status="available",
                 note="Kendi Nexar client id + secret anahtarınız gerekli (resmî GraphQL API)."),
    ProviderInfo(id="mouser", name="Mouser", status="available",
                 note="Kendi Mouser Search API anahtarınız gerekli (resmî API)."),
    ProviderInfo(id="snapeda", name="SnapEDA / SnapMagic", status="planned",
                 note="API onay gerektiriyor ve herkese açık net dokümanı doğrulanamadı; planlı."),
    ProviderInfo(id="lcsc", name="LCSC", status="unsupported",
                 note="resmi API yok, desteklenmiyor."),
]


@router.get("/providers", response_model=list[ProviderInfo])
def providers() -> list[ProviderInfo]:
    return PROVIDERS


@router.get("/search", response_model=SearchResponse)
async def search(
    provider: str = Query(...),
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=10, ge=1, le=25),
    x_nexar_client_id: str | None = Header(default=None),
    x_nexar_client_secret: str | None = Header(default=None),
    x_mouser_api_key: str | None = Header(default=None),
) -> SearchResponse:
    """Keys come only from request headers; never read from env, logged or stored."""
    try:
        if provider == "nexar":
            return await nexar.search(q.strip(), x_nexar_client_id, x_nexar_client_secret, limit)
        if provider == "mouser":
            return await mouser.search(q.strip(), x_mouser_api_key, limit)
    except PartsError as e:
        raise HTTPException(e.status, e.detail) from None
    raise HTTPException(400, "Desteklenmeyen sağlayıcı (resmî API yok veya planlı)")
