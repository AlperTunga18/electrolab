# ElectroLab 3D backend

FastAPI + stdlib sqlite3.

## Setup (Windows)

    py -3.11 -m venv .venv
    .venv\Scripts\python -m pip install -r requirements.txt

## Run

    uvicorn app.main:app --reload --port 8000

(with the venv active, or `.venv\Scripts\python -m uvicorn ...`)

DB: `data/electrolab.db` (override with env `ELECTROLAB_DB`).

## Test

    .venv\Scripts\python -m pytest

## Simulators

`GET /api/sim/engines` reports honest availability. Engines need their binary on PATH
(`ngspice`, `xyce`, `iverilog` + `vvp`). Missing binary: `POST /api/sim/run` returns 503.
Renode and QEMU are planned only.
