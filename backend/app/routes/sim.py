from fastapi import APIRouter, HTTPException

from ..models import EngineInfo, SimRunRequest, SimRunResponse
from ..sim import REGISTRY, EngineUnavailable

router = APIRouter(prefix="/api/sim", tags=["sim"])


@router.get("/engines", response_model=list[EngineInfo])
def list_engines() -> list[EngineInfo]:
    return [EngineInfo(**e.describe()) for e in REGISTRY.values()]


@router.post("/run", response_model=SimRunResponse)
def run_sim(req: SimRunRequest) -> SimRunResponse:
    engine = REGISTRY.get(req.engine)
    if engine is None:
        raise HTTPException(404, f"unknown engine: {req.engine}")
    try:
        result = engine.run({"netlist": req.netlist, "timeout_s": req.timeout_s})
    except EngineUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return SimRunResponse(ok=bool(result["ok"]), log=str(result["log"]), engine=engine.id)
