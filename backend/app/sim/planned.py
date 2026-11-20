from typing import Any

from .base import EngineUnavailable, SimEngine


class PlannedEngine(SimEngine):
    planned = True

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        raise EngineUnavailable(f"{self.name} integration is planned, not implemented")


class RenodeEngine(PlannedEngine):
    id = "renode"
    name = "Renode"
    kind = "mcu"
    license = "MIT"
    notes = "Planned: MCU/SoC emulation."
    binary = "renode"


class QemuEngine(PlannedEngine):
    id = "qemu"
    name = "QEMU"
    kind = "mcu"
    license = "GPL-2.0"
    notes = "Planned: machine emulation."
    binary = "qemu-system-arm"
