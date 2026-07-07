"""Agent tool for the aircraft geometry audit skill."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from langchain.tools import ToolRuntime, tool

logger = logging.getLogger(__name__)


def _configurable(runtime: ToolRuntime) -> dict[str, Any]:
    return (runtime.config or {}).get("configurable", {})


def _workspace_root(runtime: ToolRuntime) -> Path | None:
    configurable = _configurable(runtime)
    workspace_path = configurable.get("internagents_workspace_path")
    if isinstance(workspace_path, str) and workspace_path.strip():
        return Path(workspace_path).expanduser().resolve()
    return None


def _selected_file_path(runtime: ToolRuntime) -> str | None:
    configurable = _configurable(runtime)
    value = configurable.get("internagents_selected_file_path")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _resolve_app_root() -> Path:
    graph_root = os.environ.get("INTERNAGENTS_GRAPH_ROOT")
    if graph_root:
        return Path(graph_root).expanduser().resolve()
    return Path(__file__).resolve().parent.parent


def _resolve_python(app_root: Path) -> str:
    if os.name == "nt":
        candidates = [
            app_root / ".venv" / "Scripts" / "python.exe",
            app_root / "venv" / "Scripts" / "python.exe",
        ]
    else:
        candidates = [
            app_root / ".venv" / "bin" / "python",
            app_root / "venv" / "bin" / "python",
        ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return "python"


def _resolve_target_file(path: str | None, runtime: ToolRuntime) -> Path:
    candidate = (path or _selected_file_path(runtime) or "").strip()
    if not candidate:
        raise ValueError(
            "No geometry file path was provided and no file is currently selected. "
            "Select a file in the workspace or pass a path explicitly."
        )

    workspace_root = _workspace_root(runtime)
    candidate_path = Path(candidate).expanduser()
    if candidate_path.is_absolute():
        resolved = candidate_path.resolve()
        if workspace_root is not None:
            try:
                resolved.relative_to(workspace_root)
            except ValueError as exc:
                raise ValueError(
                    "The requested geometry file is outside the active workspace."
                ) from exc
        return resolved

    if workspace_root is not None:
        resolved = (workspace_root / candidate_path).resolve()
        try:
            resolved.relative_to(workspace_root)
        except ValueError as exc:
            raise ValueError(
                "The requested geometry file is outside the active workspace."
            ) from exc
        return resolved

    return candidate_path.resolve()


def _run_audit(file_path: Path, markdown: bool) -> str:
    app_root = _resolve_app_root()
    audit_script = (
        app_root / "skills" / "aircraft-geometry-audit" / "tools" / "audit_geometry.py"
    )
    if not audit_script.exists():
        raise FileNotFoundError(
            f"Aircraft geometry audit script not found: {audit_script}"
        )

    args = [_resolve_python(app_root), str(audit_script), str(file_path)]
    if markdown:
        args.append("--markdown")
    try:
        completed = subprocess.run(
            args,
            cwd=app_root,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={
                **os.environ,
                "PYTHONUTF8": "1",
                "PYTHONIOENCODING": "utf-8",
            },
        )
    except subprocess.CalledProcessError as exc:
        stdout = (exc.stdout or "").strip()
        stderr = (exc.stderr or "").strip()
        details = "\n".join(
            part
            for part in (
                f"stdout:\n{stdout[-4000:]}" if stdout else "",
                f"stderr:\n{stderr[-4000:]}" if stderr else "",
            )
            if part
        )
        raise RuntimeError(
            "Aircraft geometry audit subprocess failed"
            f" with exit code {exc.returncode}."
            + (f"\n{details}" if details else "")
        ) from exc
    return completed.stdout


def _report_path(file_path: Path, runtime: ToolRuntime) -> Path | None:
    workspace_root = _workspace_root(runtime)
    if workspace_root is None:
        return None
    report_dir = workspace_root / "out" / "geometry-audits"
    report_dir.mkdir(parents=True, exist_ok=True)
    return report_dir / f"{file_path.stem}.geometry-audit.md"


def run_aircraft_geometry_audit(
    file_path: Path,
    *,
    workspace_root: Path | None = None,
    requested_path: str | None = None,
    selected_file_used: bool = False,
    save_report: bool = True,
    thread_id: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    logger.info(
        "audit_aircraft_geometry.start requested_path=%r resolved_file=%s selected_file_used=%s save_report=%s thread_id=%s run_id=%s",
        requested_path,
        file_path,
        selected_file_used,
        save_report,
        thread_id,
        run_id,
    )

    try:
        if not file_path.exists():
            raise FileNotFoundError(f"Geometry file not found: {file_path}")

        audit_payload = json.loads(_run_audit(file_path, markdown=False))
        markdown_report = _run_audit(file_path, markdown=True)

        report_path = None
        if save_report and workspace_root is not None:
            report_dir = workspace_root / "out" / "geometry-audits"
            report_dir.mkdir(parents=True, exist_ok=True)
            report_path = report_dir / f"{file_path.stem}.geometry-audit.md"
            report_path.write_text(markdown_report, encoding="utf-8")

        result = {
            "file": str(file_path),
            "selectedFileUsed": selected_file_used,
            "audit": audit_payload,
            "reportMarkdown": markdown_report,
            "reportPath": str(report_path) if report_path is not None else None,
        }
        quality = audit_payload.get("quality")
        mesh = audit_payload.get("mesh")
        readiness = audit_payload.get("readiness")
        if not isinstance(quality, dict):
            quality = {}
        if not isinstance(mesh, dict):
            mesh = {}
        if not isinstance(readiness, dict):
            readiness = {}
        logger.info(
            "audit_aircraft_geometry.success file=%s selected_file_used=%s watertight=%s triangles=%s cfd_ready=%s fem_ready=%s report_path=%s thread_id=%s run_id=%s",
            file_path,
            selected_file_used,
            quality.get("watertight"),
            mesh.get("triangles") or mesh.get("surface_faces"),
            readiness.get("cfd_surface_prep"),
            readiness.get("fem_reference_geometry"),
            result["reportPath"],
            thread_id,
            run_id,
        )
        return result
    except Exception:
        logger.exception(
            "audit_aircraft_geometry.failed requested_path=%r resolved_file=%s selected_file_used=%s thread_id=%s run_id=%s",
            requested_path,
            file_path,
            selected_file_used,
            thread_id,
            run_id,
        )
        raise


@tool("audit_aircraft_geometry")
def audit_aircraft_geometry(
    runtime: ToolRuntime,
    path: str | None = None,
    save_report: bool = True,
) -> dict[str, Any]:
    """Audit an aircraft geometry or mesh file and return readiness metrics.

    Use this for STL/OBJ/PLY/VTK/VTU/INP geometry review, especially when the
    user asks whether a model is suitable for CFD, FEM, visualization, or 3D printing.
    If `path` is omitted, the currently selected workspace file is used.
    """

    configurable = _configurable(runtime)
    requested_path = path
    selected_file_used = path is None
    run_id = configurable.get("run_id")
    thread_id = configurable.get("thread_id")

    file_path = _resolve_target_file(path, runtime)
    return run_aircraft_geometry_audit(
        file_path,
        workspace_root=_workspace_root(runtime),
        requested_path=requested_path,
        selected_file_used=selected_file_used,
        save_report=save_report,
        thread_id=thread_id,
        run_id=run_id,
    )


def aircraft_geometry_audit_tools() -> list[Any]:
    return [audit_aircraft_geometry]
