import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .base import EngineUnavailable, SimEngine


class NgspiceEngine(SimEngine):
    id = "ngspice"
    name = "ngspice"
    kind = "analog"
    license = "BSD-3-Clause"
    notes = "Batch-mode SPICE analog simulation."
    binary = "ngspice"

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        exe = shutil.which(self.binary)
        if exe is None:
            raise EngineUnavailable("ngspice not installed")
        timeout = float(request.get("timeout_s", 30.0))
        with tempfile.TemporaryDirectory(prefix="electrolab_") as tmp:
            tmpdir = Path(tmp)
            (tmpdir / "netlist.cir").write_text(str(request["netlist"]), encoding="utf-8")
            try:
                proc = subprocess.run(
                    [exe, "-b", "-o", "out.log", "netlist.cir"],
                    cwd=tmpdir, capture_output=True, text=True, timeout=timeout,
                )
            except subprocess.TimeoutExpired:
                return {"ok": False, "log": f"timeout after {timeout}s", "raw_files": []}
            log_file = tmpdir / "out.log"
            log = log_file.read_text(encoding="utf-8", errors="replace") if log_file.exists() else ""
            log += proc.stdout + proc.stderr
            raw = sorted(p.name for p in tmpdir.iterdir() if p.name not in ("netlist.cir", "out.log"))
            return {"ok": proc.returncode == 0, "log": log, "raw_files": raw}
