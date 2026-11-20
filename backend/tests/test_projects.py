from fastapi.testclient import TestClient


def _create(client: TestClient, **kw: object) -> dict[str, object]:
    r = client.post("/api/projects", json={"name": "p1", **kw})
    assert r.status_code == 201
    return dict(r.json())


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json()["status"] == "ok"


def test_crud(client: TestClient) -> None:
    p = _create(client, description="d", data={"a": 1})
    assert p["version"] == 1 and p["data"] == {"a": 1}
    pid = p["id"]
    summ = client.get("/api/projects").json()
    assert len(summ) == 1 and "data" not in summ[0]
    assert client.get(f"/api/projects/{pid}").json()["name"] == "p1"
    u = client.put(f"/api/projects/{pid}", json={"name": "p2"}).json()
    assert u["name"] == "p2" and u["version"] == 2 and u["data"] == {"a": 1}
    assert client.delete(f"/api/projects/{pid}").status_code == 204
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_versions_and_restore(client: TestClient) -> None:
    pid = _create(client, data={"v": 1})["id"]
    client.put(f"/api/projects/{pid}", json={"data": {"v": 2}})
    client.put(f"/api/projects/{pid}", json={"data": {"v": 3}})
    vs = client.get(f"/api/projects/{pid}/versions").json()
    assert [v["version"] for v in vs] == [2, 1]
    r = client.post(f"/api/projects/{pid}/versions/1/restore")
    assert r.status_code == 200
    body = r.json()
    assert body["data"] == {"v": 1} and body["version"] == 4
    assert [v["version"] for v in client.get(f"/api/projects/{pid}/versions").json()] == [3, 2, 1]


def test_404s(client: TestClient) -> None:
    assert client.get("/api/projects/nope").status_code == 404
    assert client.put("/api/projects/nope", json={"name": "x"}).status_code == 404
    assert client.delete("/api/projects/nope").status_code == 404
    assert client.get("/api/projects/nope/versions").status_code == 404
    assert client.post("/api/projects/nope/versions/1/restore").status_code == 404
    pid = _create(client)["id"]
    assert client.post(f"/api/projects/{pid}/versions/99/restore").status_code == 404


def test_ws_health(client: TestClient) -> None:
    with client.websocket_connect("/ws/health") as ws:
        assert ws.receive_json() == {"type": "hello"}
        ws.send_json({"x": 1})
        assert ws.receive_json() == {"type": "echo", "x": 1}
