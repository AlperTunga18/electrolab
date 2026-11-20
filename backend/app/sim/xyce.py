import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .base import EngineUnavailable, SimEngine


class XyceEngine(SimEngine):
    id = "xyce"
    name = "Xyce"
    kind = "analog"
    license = "GPL-3.0"
    notes = "Parallel SPICE-compatible simulator (adapter skeleton)."
    binary = "xyce"

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        exe = shutil.which(self.binary)
        if exe is None:
            raise EngineUnavailable("xyce not installed")
        timeout = float(request.get("timeout_s", 30.0))
        with tempfile.TemporaryDirectory(prefix="electrolab_") as tmp:
            tmpdir = Path(tmp)
            (tmpdir / "netlist.cir").write_text(str(request["netlist"]), encoding="utf-8")
            try:
                proc = subprocess.run(
                    [exe, "netlist.cir"], cwd=tmpdir, capture_output=True, text=True, timeout=timeout
                )
            except subprocess.TimeoutExpired:
                return {"ok": False, "log": f"timeout after {timeout}s", "raw_files": []}
            raw = sorted(p.name for p in tmpdir.iterdir() if p.name != "netlist.cir")
            return {"ok": proc.returncode == 0, "log": proc.stdout + proc.stderr, "raw_files": raw}
