import shutil

import pytest
from fastapi.testclient import TestClient

NETLIST = "* rc\nV1 in 0 DC 1\nR1 in out 1k\nC1 out 0 1u\n.op\n.end\n"


def test_engines_list(client: TestClient) -> None:
    engines = {e["id"]: e for e in client.get("/api/sim/engines").json()}
    assert {"ngspice", "xyce", "icarus", "renode", "qemu"} <= set(engines)
    assert engines["renode"]["status"] == "planned" and not engines["renode"]["available"]
    for e in engines.values():
        assert e["available"] == (e["status"] == "available")


def test_unknown_engine_404(client: TestClient) -> None:
    assert client.post("/api/sim/run", json={"engine": "zzz", "netlist": "x"}).status_code == 404


def test_planned_engine_503(client: TestClient) -> None:
    assert client.post("/api/sim/run", json={"engine": "renode", "netlist": "x"}).status_code == 503


def test_timeout_bound(client: TestClient) -> None:
    r = client.post("/api/sim/run", json={"engine": "ngspice", "netlist": "x", "timeout_s": 61})
    assert r.status_code == 422


@pytest.mark.skipif(shutil.which("ngspice") is not None, reason="ngspice installed")
def test_ngspice_missing_503(client: TestClient) -> None:
    r = client.post("/api/sim/run", json={"engine": "ngspice", "netlist": NETLIST})
    assert r.status_code == 503 and "not installed" in r.json()["detail"]


@pytest.mark.skipif(shutil.which("ngspice") is None, reason="ngspice not installed")
def test_ngspice_run(client: TestClient) -> None:
    r = client.post("/api/sim/run", json={"engine": "ngspice", "netlist": NETLIST})
    assert r.status_code == 200 and r.json()["engine"] == "ngspice"
