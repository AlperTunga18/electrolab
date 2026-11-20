import shutil
from abc import ABC, abstractmethod
from typing import Any, ClassVar, Literal


class EngineUnavailable(Exception):
    """Raised when an engine binary is not installed."""


class SimEngine(ABC):
    id: ClassVar[str]
    name: ClassVar[str]
    kind: ClassVar[Literal["analog", "digital", "mcu"]]
    license: ClassVar[str] = ""
    notes: ClassVar[str] = ""
    planned: ClassVar[bool] = False
    binary: ClassVar[str] = ""

    def available(self) -> bool:
        return not self.planned and bool(self.binary) and shutil.which(self.binary) is not None

    def describe(self) -> dict[str, Any]:
        avail = self.available()
        status = "planned" if self.planned else ("available" if avail else "not_installed")
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "available": avail,
            "status": status,
            "license": self.license,
            "notes": self.notes,
        }

    @abstractmethod
    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        """Run simulation. Must raise EngineUnavailable if not installed."""


REGISTRY: dict[str, SimEngine] = {}


def register(engine: SimEngine) -> SimEngine:
    REGISTRY[engine.id] = engine
    return engine
