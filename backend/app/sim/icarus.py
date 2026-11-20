import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .base import EngineUnavailable, SimEngine


class IcarusEngine(SimEngine):
    id = "icarus"
    name = "Icarus Verilog"
    kind = "digital"
    license = "GPL-2.0"
    notes = "Verilog simulation via iverilog + vvp; 'netlist' is Verilog source."
    binary = "iverilog"

    def available(self) -> bool:
        return shutil.which("iverilog") is not None and shutil.which("vvp") is not None

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        iverilog, vvp = shutil.which("iverilog"), shutil.which("vvp")
        if iverilog is None or vvp is None:
            raise EngineUnavailable("icarus verilog (iverilog/vvp) not installed")
        timeout = float(request.get("timeout_s", 30.0))
        with tempfile.TemporaryDirectory(prefix="electrolab_") as tmp:
            tmpdir = Path(tmp)
            (tmpdir / "design.v").write_text(str(request["netlist"]), encoding="utf-8")
            try:
                comp = subprocess.run(
                    [iverilog, "-o", "sim.vvp", "design.v"],
                    cwd=tmpdir, capture_output=True, text=True, timeout=timeout,
                )
                if comp.returncode != 0:
                    return {"ok": False, "log": comp.stdout + comp.stderr, "raw_files": []}
                proc = subprocess.run(
                    [vvp, "sim.vvp"], cwd=tmpdir, capture_output=True, text=True, timeout=timeout
                )
            except subprocess.TimeoutExpired:
                return {"ok": False, "log": f"timeout after {timeout}s", "raw_files": []}
            raw = sorted(p.name for p in tmpdir.iterdir() if p.name not in ("design.v", "sim.vvp"))
            return {"ok": proc.returncode == 0, "log": comp.stderr + proc.stdout + proc.stderr, "raw_files": raw}
