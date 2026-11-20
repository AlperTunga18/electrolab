import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Response

from ..db import connect
from ..models import Project, ProjectCreate, ProjectSummary, ProjectUpdate, VersionInfo

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _to_project(row: sqlite3.Row) -> Project:
    return Project(
        id=row["id"], name=row["name"], description=row["description"],
        data=json.loads(row["data"]), created_at=row["created_at"],
        updated_at=row["updated_at"], version=row["version"],
    )


def _get_row(conn: sqlite3.Connection, project_id: str) -> sqlite3.Row:
    row: sqlite3.Row | None = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "project not found")
    return row


def _apply(conn: sqlite3.Connection, row: sqlite3.Row, name: str, description: str, data: dict[str, Any]) -> Project:
    # store previous state, then bump version
    conn.execute(
        "INSERT OR REPLACE INTO project_versions (project_id, version, name, description, data, saved_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (row["id"], row["version"], row["name"], row["description"], row["data"], row["updated_at"]),
    )
    conn.execute(
        "UPDATE projects SET name=?, description=?, data=?, updated_at=?, version=version+1 WHERE id=?",
        (name, description, json.dumps(data), _now(), row["id"]),
    )
    conn.commit()
    return _to_project(_get_row(conn, row["id"]))


@router.get("", response_model=list[ProjectSummary])
def list_projects() -> list[ProjectSummary]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT id, name, description, created_at, updated_at, version FROM projects ORDER BY updated_at DESC"
        ).fetchall()
        return [ProjectSummary(**dict(r)) for r in rows]
    finally:
        conn.close()


@router.post("", response_model=Project, status_code=201)
def create_project(body: ProjectCreate) -> Project:
    now = _now()
    pid = str(uuid.uuid4())
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO projects (id, name, description, data, created_at, updated_at, version)"
            " VALUES (?, ?, ?, ?, ?, ?, 1)",
            (pid, body.name, body.description, json.dumps(body.data), now, now),
        )
        conn.commit()
        return _to_project(_get_row(conn, pid))
    finally:
        conn.close()


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: str) -> Project:
    conn = connect()
    try:
        return _to_project(_get_row(conn, project_id))
    finally:
        conn.close()


@router.put("/{project_id}", response_model=Project)
def update_project(project_id: str, body: ProjectUpdate) -> Project:
    conn = connect()
    try:
        row = _get_row(conn, project_id)
        return _apply(
            conn, row,
            body.name if body.name is not None else row["name"],
            body.description if body.description is not None else row["description"],
            body.data if body.data is not None else json.loads(row["data"]),
        )
    finally:
        conn.close()


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str) -> Response:
    conn = connect()
    try:
        _get_row(conn, project_id)
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()
        return Response(status_code=204)
    finally:
        conn.close()


@router.get("/{project_id}/versions", response_model=list[VersionInfo])
def list_versions(project_id: str) -> list[VersionInfo]:
    conn = connect()
    try:
        _get_row(conn, project_id)
        rows = conn.execute(
            "SELECT version, saved_at, name FROM project_versions WHERE project_id = ? ORDER BY version DESC",
            (project_id,),
        ).fetchall()
        return [VersionInfo(**dict(r)) for r in rows]
    finally:
        conn.close()


@router.post("/{project_id}/versions/{version}/restore", response_model=Project)
def restore_version(project_id: str, version: int) -> Project:
    conn = connect()
    try:
        row = _get_row(conn, project_id)
        old: sqlite3.Row | None = conn.execute(
            "SELECT * FROM project_versions WHERE project_id = ? AND version = ?", (project_id, version)
        ).fetchone()
        if old is None:
            raise HTTPException(404, "version not found")
        return _apply(conn, row, old["name"], old["description"], json.loads(old["data"]))
    finally:
        conn.close()
