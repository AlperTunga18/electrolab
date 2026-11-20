import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routes import ai, mcu, parts, projects, sim

VERSION = "0.1.0"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(title="ElectroLab 3D", version=VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(projects.router)
app.include_router(sim.router)
app.include_router(mcu.router)
app.include_router(ai.router)
app.include_router(parts.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": VERSION}


@app.websocket("/ws/health")
async def ws_health(ws: WebSocket) -> None:
    await ws.accept()
    await ws.send_json({"type": "hello"})
    try:
        while True:
            text = await ws.receive_text()
            try:
                msg: Any = json.loads(text)
            except json.JSONDecodeError:
                await ws.send_json({"type": "error", "error": "invalid json"})
                continue
            payload = msg if isinstance(msg, dict) else {"data": msg}
            await ws.send_json({**payload, "type": "echo"})
    except WebSocketDisconnect:
        pass
