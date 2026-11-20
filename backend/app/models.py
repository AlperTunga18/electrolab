from typing import Any, Literal

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    data: dict[str, Any] | None = None


class ProjectSummary(BaseModel):
    id: str
    name: str
    description: str
    created_at: str
    updated_at: str
    version: int


class Project(ProjectSummary):
    data: dict[str, Any]


class VersionInfo(BaseModel):
    version: int
    saved_at: str
    name: str


class EngineInfo(BaseModel):
    id: str
    name: str
    kind: Literal["analog", "digital", "mcu"]
    available: bool
    status: Literal["available", "not_installed", "planned"]
    license: str
    notes: str


class SimRunRequest(BaseModel):
    engine: str
    netlist: str
    timeout_s: float = Field(default=30.0, gt=0, le=60)


class SimRunResponse(BaseModel):
    ok: bool
    log: str
    engine: str
