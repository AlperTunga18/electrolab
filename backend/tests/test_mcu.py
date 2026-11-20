import subprocess
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.mcu import toolchain

SRC = "void setup(){}\nvoid loop(){}\n"
HEX = ":00000001FF\n"


def _fake_run_factory(calls: list[Any], returncode: int = 0, stderr: str = "") -> Any:
    def fake_run(cmd: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        calls.append((cmd, kwargs))
        if returncode == 0 and "compile" in cmd:
            out = Path(cmd[cmd.index("--output-dir") + 1])
            out.mkdir(parents=True, exist_ok=True)
            (out / "sketch.ino.hex").write_text(HEX)
        return subprocess.CompletedProcess(cmd, returncode, "", stderr)

    return fake_run


def test_toolchains_shape(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: None)
    items = {t["id"]: t for t in client.get("/api/mcu/toolchains").json()}
    assert set(items) == {"arduino-cli", "platformio", "esp-idf", "renode", "qemu"}
    assert items["arduino-cli"]["status"] == "not_installed"
    assert items["platformio"]["status"] == "not_installed"
    for tid in ("esp-idf", "renode", "qemu"):
        assert items[tid]["status"] == "planned"
    for t in items.values():
        assert t["available"] == (t["status"] == "available")
        assert t["notes"]


def test_toolchains_available_version(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        toolchain.shutil, "which", lambda n: "/x/arduino-cli" if n == "arduino-cli" else None
    )
    monkeypatch.setattr(
        toolchain.subprocess,
        "run",
        lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, "arduino-cli  Version: 1.0\n", ""),
    )
    items = {t["id"]: t for t in client.get("/api/mcu/toolchains").json()}
    assert items["arduino-cli"]["available"] and items["arduino-cli"]["path"] == "/x/arduino-cli"
    assert "1.0" in items["arduino-cli"]["version"]


def test_compile_missing_503(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: None)
    r = client.post("/api/mcu/compile", json={"board": "uno", "source": SRC})
    assert r.status_code == 503 and r.json() == {"detail": "arduino-cli not installed"}


def test_compile_success(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []
    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: "/x/arduino-cli")
    monkeypatch.setattr(toolchain.subprocess, "run", _fake_run_factory(calls))
    r = client.post("/api/mcu/compile", json={"board": "nano", "source": SRC})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] and body["hex"] == HEX and body["artifact"] is None
    assert body["fqbn"] == "arduino:avr:nano:cpu=atmega328" and body["diagnostics"] == []
    cmd, kwargs = calls[0]
    assert isinstance(cmd, list) and not kwargs.get("shell")
    assert cmd[:5] == ["/x/arduino-cli", "--no-color", "compile", "--fqbn", "arduino:avr:nano:cpu=atmega328"]


def test_compile_non_avr_no_hex(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_run(cmd: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        out = Path(cmd[cmd.index("--output-dir") + 1])
        out.mkdir(parents=True, exist_ok=True)
        (out / "sketch.ino.uf2").write_bytes(b"x")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: "/x/arduino-cli")
    monkeypatch.setattr(toolchain.subprocess, "run", fake_run)
    body = client.post("/api/mcu/compile", json={"board": "pico", "source": SRC}).json()
    assert body["ok"] and body["hex"] is None and body["artifact"] == "sketch.ino.uf2"
    assert body["fqbn"] == "rp2040:rp2040:rpipico"


def test_compile_failure_diagnostics(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    err = (
        "/tmp/x/sketch/sketch.ino:3:5: error: 'foo' was not declared in this scope\n"
        "sketch.ino:7:1: warning: unused variable 'y'\n"
        "exit status 1\n"
    )
    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: "/x/arduino-cli")
    monkeypatch.setattr(toolchain.subprocess, "run", _fake_run_factory([], 1, err))
    r = client.post("/api/mcu/compile", json={"board": "uno", "source": SRC})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and body["hex"] is None
    assert body["diagnostics"] == [
        {"line": 3, "message": "'foo' was not declared in this scope", "severity": "error"},
        {"line": 7, "message": "unused variable 'y'", "severity": "warning"},
    ]


def test_compile_timeout_504(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(cmd: Any, **kwargs: Any) -> Any:
        raise subprocess.TimeoutExpired(cmd, 1)

    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: "/x/arduino-cli")
    monkeypatch.setattr(toolchain.subprocess, "run", boom)
    assert client.post("/api/mcu/compile", json={"board": "uno", "source": SRC}).status_code == 504


def test_compile_validation_422(client: TestClient) -> None:
    assert client.post("/api/mcu/compile", json={"board": "zzz", "source": SRC}).status_code == 422
    big = "x" * 200_001
    assert client.post("/api/mcu/compile", json={"board": "uno", "source": big}).status_code == 422
    r = client.post("/api/mcu/compile", json={"board": "uno", "source": SRC, "timeout_s": 181})
    assert r.status_code == 422


def test_compile_pico_returns_uf2_b64(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import base64

    payload = b"UF2\n" + bytes(range(256)) * 2

    def fake_run(cmd: Any, **kwargs: Any) -> subprocess.CompletedProcess[str]:
        out = Path(cmd[cmd.index("--output-dir") + 1])
        out.mkdir(parents=True, exist_ok=True)
        (out / "sketch.ino.bin").write_bytes(b"b")
        (out / "sketch.ino.uf2").write_bytes(payload)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: "/x/arduino-cli")
    monkeypatch.setattr(toolchain.subprocess, "run", fake_run)
    body = client.post("/api/mcu/compile", json={"board": "pico", "source": SRC}).json()
    assert body["ok"] and body["hex"] is None
    assert body["artifact"] == "sketch.ino.bin"  # backwards compatible: first artifact by name
    assert base64.b64decode(body["uf2_b64"]) == payload


def test_compile_other_boards_have_no_uf2(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(toolchain.shutil, "which", lambda _n: "/x/arduino-cli")
    monkeypatch.setattr(toolchain.subprocess, "run", _fake_run_factory([]))
    body = client.post("/api/mcu/compile", json={"board": "uno", "source": SRC}).json()
    assert body["uf2_b64"] is None


def _arduino_cli_has_rp2040() -> bool:
    import shutil

    exe = shutil.which("arduino-cli")
    if exe is None:
        return False
    try:
        out = subprocess.run([exe, "core", "list"], capture_output=True, text=True, timeout=30).stdout
    except (subprocess.SubprocessError, OSError):
        return False
    return "rp2040:rp2040" in out


@pytest.mark.skipif(not _arduino_cli_has_rp2040(), reason="arduino-cli with rp2040:rp2040 core not installed")
def test_compile_pico_real_uf2(client: TestClient) -> None:
    import base64
    import struct

    src = (
        "void setup(){pinMode(25,OUTPUT);} "
        "void loop(){digitalWrite(25,HIGH);delay(500);digitalWrite(25,LOW);delay(500);}"
    )
    body = client.post("/api/mcu/compile", json={"board": "pico", "source": src, "timeout_s": 180}).json()
    assert body["ok"], body["log"]
    raw = base64.b64decode(body["uf2_b64"])
    assert len(raw) % 512 == 0 and len(raw) > 512
    magic0, magic1 = struct.unpack_from("<II", raw, 0)
    assert (magic0, magic1) == (0x0A324655, 0x9E5D5157)
