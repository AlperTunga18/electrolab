from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..mcu import toolchain

router = APIRouter(prefix="/api/mcu", tags=["mcu"])


class ToolchainInfo(BaseModel):
    id: str
    name: str
    available: bool
    status: Literal["available", "not_installed", "planned"]
    path: str | None = None
    version: str | None = None
    notes: str


class CompileRequest(BaseModel):
    board: Literal["uno", "nano", "mega", "esp32", "pico"]
    source: str = Field(max_length=200_000)
    timeout_s: float = Field(default=120.0, gt=0, le=180)


class Diagnostic(BaseModel):
    line: int | None = None
    message: str
    severity: Literal["error", "warning"]


class CompileResponse(BaseModel):
    ok: bool
    board: str
    fqbn: str
    log: str
    hex: str | None = None
    artifact: str | None = None
    uf2_b64: str | None = None
    diagnostics: list[Diagnostic]


@router.get("/toolchains", response_model=list[ToolchainInfo])
def list_toolchains() -> list[ToolchainInfo]:
    return [ToolchainInfo(**t) for t in toolchain.list_toolchains()]


@router.post("/compile", response_model=CompileResponse)
def compile_firmware(req: CompileRequest) -> CompileResponse:
    try:
        result = toolchain.compile_sketch(req.board, req.source, req.timeout_s)
    except toolchain.ToolchainUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    except toolchain.CompileTimeout as exc:
        raise HTTPException(504, str(exc)) from exc
    return CompileResponse(**result)
