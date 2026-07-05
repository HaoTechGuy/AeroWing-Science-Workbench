#!/usr/bin/env python3
"""Aircraft geometry audit for AeroWing Science Workbench."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

VERSION = "0.2.0"
TRIMESH_EXTENSIONS = {".stl", ".obj", ".ply", ".glb", ".gltf"}
MESHIO_EXTENSIONS = {".vtk", ".vtu", ".vtp", ".inp", ".stl", ".obj", ".ply"}


def finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except Exception:
        return None
    return number if math.isfinite(number) else None


def rounded(value: Any, digits: int = 6) -> float | None:
    number = finite_float(value)
    return round(number, digits) if number is not None else None


def base_payload(path: Path, backend: str) -> dict[str, Any]:
    stat = path.stat()
    return {
        "metadata": {
            "schema": "AeroWingGeometryAudit",
            "tool": "aircraft-geometry-audit",
            "tool_version": VERSION,
            "backend": backend,
            "file_name": path.name,
            "extension": path.suffix.lower(),
            "size_bytes": stat.st_size,
        },
        "dimensions": {},
        "mesh": {},
        "quality": {},
        "readiness": {},
        "checks": [],
    }


def bbox_metrics(points: np.ndarray) -> dict[str, Any]:
    if points.size == 0:
        return {}
    points = np.asarray(points, dtype=float)
    mins = np.nanmin(points, axis=0)
    maxs = np.nanmax(points, axis=0)
    extents = maxs - mins
    diag = float(np.linalg.norm(extents))
    sorted_extents = sorted([float(x) for x in extents], reverse=True)
    slenderness = sorted_extents[0] / sorted_extents[-1] if sorted_extents[-1] > 0 else None
    return {
        "min": [rounded(x) for x in mins],
        "max": [rounded(x) for x in maxs],
        "length_x": rounded(extents[0]),
        "span_y": rounded(extents[1]),
        "height_z": rounded(extents[2]),
        "diagonal": rounded(diag),
        "centroid_bbox": [rounded(x) for x in ((mins + maxs) / 2.0)],
        "bounding_box": {"min": [rounded(x) for x in mins], "max": [rounded(x) for x in maxs]},
        "slenderness_ratio": rounded(slenderness, 3),
    }




def edge_topology_counts(faces: np.ndarray) -> dict[str, int | None]:
    """Count boundary and non-manifold edges for triangular surface meshes."""
    if len(faces) == 0:
        return {"edges": 0, "boundary_edges": 0, "non_manifold_edges": 0}
    triangles = np.asarray(faces[:, :3], dtype=np.int64)
    edges = np.concatenate(
        [
            triangles[:, [0, 1]],
            triangles[:, [1, 2]],
            triangles[:, [2, 0]],
        ],
        axis=0,
    )
    edges.sort(axis=1)
    _unique, counts = np.unique(edges, axis=0, return_counts=True)
    return {
        "edges": int(len(counts)),
        "boundary_edges": int(np.count_nonzero(counts == 1)),
        "non_manifold_edges": int(np.count_nonzero(counts > 2)),
    }

def triangle_degenerate_count(vertices: np.ndarray, faces: np.ndarray) -> int:
    if len(vertices) == 0 or len(faces) == 0:
        return 0
    triangles = vertices[faces[:, :3]]
    areas = 0.5 * np.linalg.norm(np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]), axis=1)
    tolerance = max(float(np.nanmax(areas)) * 1e-12, 1e-18) if len(areas) else 1e-18
    return int(np.count_nonzero(areas <= tolerance))


def readiness(payload: dict[str, Any]) -> None:
    mesh = payload["mesh"]
    quality = payload["quality"]
    checks = payload["checks"]
    triangles = int(mesh.get("triangles") or mesh.get("surface_faces") or 0)
    points = int(mesh.get("points") or 0)
    watertight = quality.get("watertight")
    degenerate = int(quality.get("degenerate_faces") or 0)
    non_manifold = int(quality.get("non_manifold_edges") or 0)
    boundary_edges = int(quality.get("boundary_edges") or 0)
    topology_clean = non_manifold == 0 and boundary_edges == 0

    payload["readiness"] = {
        "visualization": points > 0 and (triangles > 0 or bool(mesh.get("cell_types"))),
        "cfd_surface_prep": bool(watertight) and degenerate == 0 and topology_clean,
        "fem_reference_geometry": points > 0 and degenerate == 0,
        "printing_or_volume": bool(watertight) and topology_clean and bool(payload["dimensions"].get("diagonal")),
    }
    if watertight is False:
        checks.append({"severity": "high", "message": "Mesh is not watertight; volume, CFD volume meshing, and 3D printing may fail."})
    if degenerate:
        checks.append({"severity": "medium", "message": f"Detected {degenerate:,} degenerate triangular faces; repair before solver use."})
    if non_manifold:
        checks.append({"severity": "high", "message": f"Detected {non_manifold:,} non-manifold edges; repair topology before CFD/FEM meshing."})
    if boundary_edges:
        checks.append({"severity": "medium", "message": f"Detected {boundary_edges:,} boundary/open edges; model is likely not closed."})
    if points > 500_000 or triangles > 500_000:
        checks.append({"severity": "medium", "message": "Large mesh detected; use cached previews, decimation, or server-side jobs for interactive workflows."})
    if payload["metadata"]["extension"] == ".stl":
        checks.append({"severity": "low", "message": "STL has no materials, loads, constraints, or exact CAD features; use it as tessellated geometry only."})


def audit_with_trimesh(path: Path) -> dict[str, Any]:
    import trimesh

    loaded = trimesh.load(path, force="mesh", process=False)
    if isinstance(loaded, trimesh.Scene):
        mesh = trimesh.util.concatenate(tuple(loaded.geometry.values()))
    else:
        mesh = loaded
    payload = base_payload(path, "trimesh")
    vertices = np.asarray(mesh.vertices, dtype=float)
    faces = np.asarray(mesh.faces, dtype=np.int64) if getattr(mesh, "faces", None) is not None else np.empty((0, 3), dtype=np.int64)
    payload["dimensions"] = bbox_metrics(vertices)
    payload["mesh"] = {
        "points": int(len(vertices)),
        "surface_faces": int(len(faces)),
        "triangles": int(len(faces)),
        "cell_types": {"triangle": int(len(faces))} if len(faces) else {},
    }
    topology_mesh = mesh.copy()
    topology_mesh.merge_vertices()
    topology_faces = np.asarray(topology_mesh.faces, dtype=np.int64) if getattr(topology_mesh, "faces", None) is not None else faces
    topology = edge_topology_counts(topology_faces)
    payload["quality"] = {
        "watertight": bool(getattr(mesh, "is_watertight", False)),
        "winding_consistent": bool(getattr(mesh, "is_winding_consistent", False)),
        "euler_number": int(mesh.euler_number) if getattr(mesh, "euler_number", None) is not None else None,
        "surface_area": rounded(getattr(mesh, "area", None)),
        "volume": rounded(getattr(mesh, "volume", None)) if getattr(mesh, "is_watertight", False) else None,
        "degenerate_faces": triangle_degenerate_count(vertices, faces) if len(faces) else 0,
        **topology,
    }
    readiness(payload)
    return payload


def audit_with_meshio(path: Path) -> dict[str, Any]:
    import meshio

    mesh = meshio.read(path)
    payload = base_payload(path, "meshio")
    points = np.asarray(mesh.points, dtype=float)
    cell_types: dict[str, int] = {}
    triangles: np.ndarray | None = None
    for block in mesh.cells:
        cell_types[block.type] = cell_types.get(block.type, 0) + int(len(block.data))
        if block.type == "triangle" and triangles is None:
            triangles = np.asarray(block.data, dtype=np.int64)
    payload["dimensions"] = bbox_metrics(points)
    payload["mesh"] = {
        "points": int(len(points)),
        "cells": int(sum(cell_types.values())),
        "triangles": int(cell_types.get("triangle", 0)),
        "cell_types": cell_types,
        "point_data": sorted(mesh.point_data.keys()),
        "cell_data": sorted(mesh.cell_data.keys()),
    }
    topology = edge_topology_counts(triangles) if triangles is not None else {"edges": None, "boundary_edges": None, "non_manifold_edges": None}
    payload["quality"] = {
        "watertight": None,
        "surface_area": None,
        "volume": None,
        "degenerate_faces": triangle_degenerate_count(points, triangles) if triangles is not None else 0,
        **topology,
    }
    readiness(payload)
    return payload


def audit_geometry(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    errors: list[str] = []
    if suffix in TRIMESH_EXTENSIONS:
        try:
            return audit_with_trimesh(path)
        except Exception as exc:
            errors.append(f"trimesh: {exc}")
    if suffix in MESHIO_EXTENSIONS:
        try:
            payload = audit_with_meshio(path)
            if errors:
                payload["checks"].append({"severity": "low", "message": "; ".join(errors)})
            return payload
        except Exception as exc:
            errors.append(f"meshio: {exc}")
    payload = base_payload(path, "unsupported")
    payload["checks"].append({"severity": "medium", "message": f"Unsupported or unreadable geometry format: {suffix}. {'; '.join(errors)}"})
    return payload


def to_markdown(payload: dict[str, Any]) -> str:
    lines = [f"# Geometry Audit: {payload['metadata']['file_name']}", ""]
    lines.append(f"Backend: `{payload['metadata']['backend']}`")
    dims = payload.get("dimensions", {})
    mesh = payload.get("mesh", {})
    quality = payload.get("quality", {})
    lines += ["", "## Dimensions", ""]
    for key in ["length_x", "span_y", "height_z", "diagonal", "slenderness_ratio", "min", "max"]:
        lines.append(f"- {key}: {dims.get(key, '-')}")
    lines += ["", "## Mesh", ""]
    for key, value in mesh.items():
        lines.append(f"- {key}: {value}")
    lines += ["", "## Quality", ""]
    for key, value in quality.items():
        lines.append(f"- {key}: {value}")
    lines += ["", "## Readiness", ""]
    for key, value in payload.get("readiness", {}).items():
        lines.append(f"- {key}: {'OK' if value else 'Needs review'}")
    if payload.get("checks"):
        lines += ["", "## Checks", ""]
        for check in payload["checks"]:
            lines.append(f"- [{check.get('severity', 'info')}] {check.get('message')}")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit aircraft geometry and mesh readiness.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--markdown", action="store_true", help="Emit Markdown instead of JSON")
    args = parser.parse_args()
    if not args.file.exists():
        raise SystemExit(f"File not found: {args.file}")
    payload = audit_geometry(args.file)
    if args.markdown:
        print(to_markdown(payload), end="")
    else:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
