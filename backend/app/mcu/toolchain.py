import base64
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

FQBN: dict[str, str] = {
    "uno": "arduino:avr:uno",
    "nano": "arduino:avr:nano:cpu=atmega328",
    "mega": "arduino:avr:mega",
    "esp32": "esp32:esp32:esp32",
    "pico": "rp2040:rp2040:rpipico",
}
AVR_BOARDS = {"uno", "nano", "mega"}
ARTIFACT_EXTS = (".bin", ".uf2")

_DIAG_RE = re.compile(
    r"sketch\.ino:(?P<line>\d+):(?:\d+:)?\s*(?P<sev>error|warning):\s*(?P<msg>.*)"
)


class ToolchainUnavailable(Exception):
    pass


class CompileTimeout(Exception):
    pass


def _version(exe: str) -> str | None:
    try:
        proc = subprocess.run([exe, "version"], capture_output=True, text=True, timeout=5)
    except (subprocess.SubprocessError, OSError):
        return None
    out = (proc.stdout or proc.stderr).strip()
    return out.splitlines()[0] if out else None


def list_toolchains() -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    cli = shutil.which("arduino-cli")
    entry: dict[str, Any] = {
        "id": "arduino-cli", "name": "Arduino CLI",
        "available": cli is not None,
        "status": "available" if cli else "not_installed",
        "notes": "Compiles AVR, ESP32 and RP2040 sketches.",
    }
    if cli:
        entry["path"] = cli
        ver = _version(cli)
        if ver:
            entry["version"] = ver
    result.append(entry)

    pio = shutil.which("pio") or shutil.which("platformio")
    entry = {
        "id": "platformio", "name": "PlatformIO",
        "available": pio is not None,
        "status": "available" if pio else "not_installed",
        "notes": "Detected only; not used by /api/mcu/compile yet.",
    }
    if pio:
        entry["path"] = pio
    result.append(entry)

    for tid, name in (("esp-idf", "ESP-IDF"), ("renode", "Renode"), ("qemu", "QEMU")):
        result.append({
            "id": tid, "name": name, "available": False,
            "status": "planned", "notes": "Planned; not integrated.",
        })
    return result


def parse_diagnostics(log: str) -> list[dict[str, Any]]:
    diags: list[dict[str, Any]] = []
    for raw in log.splitlines():
        m = _DIAG_RE.search(raw)
        if m:
            diags.append({
                "line": int(m.group("line")),
                "message": m.group("msg").strip(),
                "severity": m.group("sev"),
            })
    return diags


def compile_sketch(board: str, source: str, timeout_s: float) -> dict[str, Any]:
    exe = shutil.which("arduino-cli")
    if exe is None:
        raise ToolchainUnavailable("arduino-cli not installed")
    fqbn = FQBN[board]
    with tempfile.TemporaryDirectory(prefix="electrolab_mcu_") as tmp:
        root = Path(tmp)
        sketch_dir = root / "sketch"
        out_dir = root / "out"
        sketch_dir.mkdir()
        (sketch_dir / "sketch.ino").write_text(source, encoding="utf-8")
        cmd = [exe, "--no-color", "compile", "--fqbn", fqbn, "--output-dir", str(out_dir), str(sketch_dir)]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired as exc:
            raise CompileTimeout(f"compile timeout after {timeout_s}s") from exc
        log = (proc.stdout or "") + (proc.stderr or "")
        ok = proc.returncode == 0
        hex_text: str | None = None
        artifact: str | None = None
        uf2_b64: str | None = None
        if ok and out_dir.is_dir():
            if board in AVR_BOARDS:
                hex_file = out_dir / "sketch.ino.hex"
                if hex_file.is_file():
                    hex_text = hex_file.read_text(encoding="utf-8", errors="replace")
            else:
                for p in sorted(out_dir.iterdir()):
                    if p.is_file() and p.suffix in ARTIFACT_EXTS:
                        artifact = p.name
                        break
                uf2_file = out_dir / "sketch.ino.uf2"
                if board == "pico" and uf2_file.is_file():
                    uf2_b64 = base64.b64encode(uf2_file.read_bytes()).decode("ascii")
        return {
            "ok": ok, "board": board, "fqbn": fqbn, "log": log,
            "hex": hex_text, "artifact": artifact, "uf2_b64": uf2_b64,
            "diagnostics": parse_diagnostics(log),
        }
