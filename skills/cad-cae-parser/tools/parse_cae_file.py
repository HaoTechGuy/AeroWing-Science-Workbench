#!/usr/bin/env python3
"""CAD/CAE summary parser for AeroWing.

BDF/OP2 use pyNastran when available so the summary is built from the real
finite-element model/result objects. Text scanners remain as fallbacks and for
formats that do not need a heavyweight reader in the minimal workbench.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

VERSION = "0.2.0"
BDF_NODE_CARDS = {"GRID", "GRID*"}
BDF_ELEMENT_PREFIXES = ("CQUAD", "CTRIA", "CBAR", "CBEAM", "CROD", "CTETRA", "CHEXA", "CPENTA", "RBE", "CONM")
BDF_PROPERTY_PREFIXES = ("PSHELL", "PCOMP", "PBAR", "PBEAM", "PROD", "PSOLID", "PBUSH")
BDF_MATERIAL_PREFIXES = ("MAT",)
BDF_LOAD_PREFIXES = ("FORCE", "MOMENT", "PLOAD", "GRAV", "TEMP", "ACCEL")
BDF_CONSTRAINT_PREFIXES = ("SPC", "MPC")


def read_text(path: Path, limit_bytes: int = 32 * 1024 * 1024) -> str:
    data = path.read_bytes()[:limit_bytes]
    for encoding in ("utf-8", "utf-8-sig", "gb18030", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def base_summary(path: Path, backend: str = "lightweight") -> dict[str, Any]:
    stat = path.stat()
    return {
        "metadata": {
            "schema": "AeroWingModel",
            "parser": "cad-cae-parser",
            "parser_version": VERSION,
            "parser_backend": backend,
            "file_name": path.name,
            "extension": path.suffix.lower(),
            "size_bytes": stat.st_size,
        },
        "geometry": {},
        "mesh": {"nodes": None, "elements": None, "element_types": {}},
        "materials": {},
        "loads": {},
        "results": {},
        "checks": [],
    }


def append_fallback_check(model: dict[str, Any], reason: str) -> None:
    model["metadata"]["parser_backend"] = "lightweight-fallback"
    model["checks"].append({"severity": "low", "message": f"pyNastran unavailable or could not read this file: {reason}"})


def type_counter(values: Iterable[Any]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for value in values:
        card_type = getattr(value, "type", None) or value.__class__.__name__
        counts[str(card_type)] += 1
    return counts


def count_nested_cards(container: Any) -> tuple[int, dict[str, int]]:
    if not container:
        return 0, {}
    flattened: list[Any] = []
    if isinstance(container, dict):
        values = container.values()
    else:
        values = container
    for value in values:
        if isinstance(value, (list, tuple, set)):
            flattened.extend(value)
        else:
            flattened.append(value)
    return len(flattened), dict(type_counter(flattened))


def parse_bdf_with_pynastran(path: Path) -> dict[str, Any]:
    from pyNastran.bdf.bdf import BDF

    model = base_summary(path, "pyNastran")
    bdf = BDF(debug=False, log=None, mode="msc")
    # pyNastran logs to stdout on some warnings; keep API responses JSON-only.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        bdf.read_bdf(str(path), xref=False, validate=False, punch=False)

    element_types = type_counter(bdf.elements.values())
    property_types = type_counter(bdf.properties.values())
    material_cards = {
        **{f"materials.{k}": v for k, v in type_counter(bdf.materials.values()).items()},
        **{f"thermal_materials.{k}": v for k, v in type_counter(getattr(bdf, "thermal_materials", {}).values()).items()},
        **{f"creep_materials.{k}": v for k, v in type_counter(getattr(bdf, "creep_materials", {}).values()).items()},
    }
    load_count, load_cards = count_nested_cards(getattr(bdf, "loads", {}))
    dload_count, dload_cards = count_nested_cards(getattr(bdf, "dloads", {}))
    spc_count, spc_cards = count_nested_cards(getattr(bdf, "spcs", {}))
    mpc_count, mpc_cards = count_nested_cards(getattr(bdf, "mpcs", {}))

    model["mesh"].update(
        {
            "nodes": len(bdf.nodes),
            "elements": len(bdf.elements),
            "element_types": dict(element_types),
            "properties": dict(property_types),
            "properties_count": len(bdf.properties),
            "coords": len(getattr(bdf, "coords", {})),
            "rigid_elements": len(getattr(bdf, "rigid_elements", {})),
            "masses": len(getattr(bdf, "masses", {})),
            "aero_panels": len(getattr(bdf, "caeros", {})),
        }
    )
    model["materials"] = {"cards": material_cards, "count": sum(material_cards.values())}
    model["loads"] = {
        "load_cards": load_cards,
        "dload_cards": dload_cards,
        "constraint_cards": {**{f"SPC.{k}": v for k, v in spc_cards.items()}, **{f"MPC.{k}": v for k, v in mpc_cards.items()}},
        "load_count": load_count + dload_count,
        "constraint_count": spc_count + mpc_count,
        "subcases": len(getattr(getattr(bdf, "case_control_deck", None), "subcases", {}) or {}),
    }
    model["geometry"] = {
        "coordinate_systems": len(getattr(bdf, "coords", {})),
        "aero_surfaces": len(getattr(bdf, "caeros", {})),
        "splines": len(getattr(bdf, "splines", {})),
    }

    if model["mesh"]["elements"] and not model["materials"]["count"]:
        model["checks"].append({"severity": "high", "message": "Elements found but pyNastran did not read any material cards."})
    if model["mesh"]["elements"] and not model["mesh"]["properties_count"]:
        model["checks"].append({"severity": "medium", "message": "Elements found but pyNastran did not read any property cards."})
    if not model["loads"]["constraint_count"]:
        model["checks"].append({"severity": "medium", "message": "No SPC/MPC constraints were read; verify boundary conditions."})
    return model


def summarize_result_bucket(bucket: Any) -> dict[str, Any]:
    if not bucket:
        return {"count": 0, "subcases": []}
    subcases = sorted([str(key) for key in bucket.keys()]) if isinstance(bucket, dict) else []
    return {"count": len(bucket), "subcases": subcases[:20], "truncated": len(subcases) > 20}


def parse_op2(path: Path) -> dict[str, Any]:
    try:
        from pyNastran.op2.op2 import OP2

        op2 = OP2(debug=False, log=None)
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            op2.read_op2(str(path), build_dataframe=False, skip_undefined_matrices=True)
        model = base_summary(path, "pyNastran")
        grid_points = getattr(op2, "grid_point_weight", None)
        result_attrs = {
            "displacements": "displacements",
            "velocities": "velocities",
            "accelerations": "accelerations",
            "eigenvectors": "eigenvectors",
            "spc_forces": "spc_forces",
            "mpc_forces": "mpc_forces",
            "grid_point_forces": "grid_point_forces",
            "cquad4_stress": "cquad4_stress",
            "ctria3_stress": "ctria3_stress",
            "cbar_force": "cbar_force",
            "cbeam_force": "cbeam_force",
            "rod_stress": "rod_stress",
            "solid_stress": "solid_stress",
        }
        results = {label: summarize_result_bucket(getattr(op2, attr, {})) for label, attr in result_attrs.items() if getattr(op2, attr, {})}
        model["results"] = {
            "result_tables": results,
            "table_count": len(results),
            "matrices": sorted(list(getattr(op2, "matrices", {}).keys()))[:20],
            "grid_point_weight": bool(grid_points),
        }
        model["mesh"] = {"nodes": None, "elements": None, "element_types": {}}
        if not results:
            model["checks"].append({"severity": "medium", "message": "OP2 read succeeded, but no common structural result tables were found."})
        return model
    except Exception as exc:  # pragma: no cover - depends on optional binary reader
        model = parse_text_result(path)
        append_fallback_check(model, str(exc))
        return model


def first_bdf_field(line: str) -> str:
    stripped = line.strip()
    if not stripped or stripped.startswith(("$", "#")):
        return ""
    if "," in stripped:
        return stripped.split(",", 1)[0].strip().upper()
    return stripped.split(None, 1)[0].strip().upper()


def parse_bdf_lightweight(path: Path) -> dict[str, Any]:
    model = base_summary(path, "lightweight")
    text = read_text(path)
    cards: Counter[str] = Counter()
    for line in text.splitlines():
        card = first_bdf_field(line)
        if card:
            cards[card] += 1

    element_cards = {k: v for k, v in cards.items() if k.startswith(BDF_ELEMENT_PREFIXES)}
    property_cards = {k: v for k, v in cards.items() if k.startswith(BDF_PROPERTY_PREFIXES)}
    material_cards = {k: v for k, v in cards.items() if k.startswith(BDF_MATERIAL_PREFIXES)}
    load_cards = {k: v for k, v in cards.items() if k.startswith(BDF_LOAD_PREFIXES)}
    constraint_cards = {k: v for k, v in cards.items() if k.startswith(BDF_CONSTRAINT_PREFIXES)}

    model["mesh"].update({"nodes": sum(cards[c] for c in BDF_NODE_CARDS), "elements": sum(element_cards.values()), "element_types": element_cards, "properties": property_cards})
    model["materials"] = {"cards": material_cards, "count": sum(material_cards.values())}
    model["loads"] = {"load_cards": load_cards, "constraint_cards": constraint_cards, "load_count": sum(load_cards.values()), "constraint_count": sum(constraint_cards.values())}
    if model["mesh"]["elements"] and not model["materials"]["count"]:
        model["checks"].append({"severity": "high", "message": "Element cards found but no MAT* material cards were detected."})
    if model["mesh"]["elements"] and not property_cards:
        model["checks"].append({"severity": "medium", "message": "Element cards found but no common property cards were detected."})
    if not constraint_cards:
        model["checks"].append({"severity": "medium", "message": "No SPC/MPC constraint cards detected; verify boundary conditions."})
    return model


def parse_bdf(path: Path) -> dict[str, Any]:
    try:
        return parse_bdf_with_pynastran(path)
    except Exception as exc:
        model = parse_bdf_lightweight(path)
        append_fallback_check(model, str(exc))
        return model


def parse_inp(path: Path) -> dict[str, Any]:
    model = base_summary(path, "lightweight")
    text = read_text(path)
    section = None
    counts: defaultdict[str, int] = defaultdict(int)
    element_types: Counter[str] = Counter()
    materials: list[str] = []
    sets: Counter[str] = Counter()

    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("**"):
            continue
        if line.startswith("*"):
            keyword = line.split(",", 1)[0].strip().upper()
            section = keyword
            counts[keyword] += 1
            if keyword == "*ELEMENT":
                match = re.search(r"TYPE\s*=\s*([^,\s]+)", line, re.I)
                element_types[match.group(1).upper() if match else "UNKNOWN"] += 0
            if keyword == "*MATERIAL":
                match = re.search(r"NAME\s*=\s*([^,]+)", line, re.I)
                materials.append(match.group(1).strip() if match else f"MATERIAL_{len(materials)+1}")
            if keyword in {"*NSET", "*ELSET", "*SURFACE"}:
                sets[keyword] += 1
            continue
        if section == "*NODE":
            counts["node_rows"] += 1
        elif section == "*ELEMENT":
            counts["element_rows"] += 1
            if element_types:
                last_type = next(reversed(element_types))
                element_types[last_type] += 1

    loads = {k: v for k, v in counts.items() if k in {"*BOUNDARY", "*CLOAD", "*DLOAD", "*DSLOAD", "*TEMPERATURE"}}
    model["mesh"].update({"nodes": counts["node_rows"], "elements": counts["element_rows"], "element_types": dict(element_types), "sets": dict(sets)})
    model["materials"] = {"names": materials, "count": len(materials)}
    model["loads"] = {"keyword_counts": loads, "steps": counts["*STEP"]}
    if counts["element_rows"] and not materials:
        model["checks"].append({"severity": "high", "message": "Elements found but no *MATERIAL sections detected."})
    if not loads:
        model["checks"].append({"severity": "medium", "message": "No common Abaqus load or boundary keywords detected."})
    return model


def parse_stl(path: Path) -> dict[str, Any]:
    model = base_summary(path, "lightweight")
    data = path.read_bytes()
    head = data[:256].decode("latin-1", errors="ignore").lower()
    if head.lstrip().startswith("solid") and b"facet normal" in data[:1024 * 1024]:
        text = data.decode("latin-1", errors="ignore")
        facets = len(re.findall(r"\bfacet\s+normal\b", text, re.I))
        vertices = len(re.findall(r"\bvertex\b", text, re.I))
        stl_type = "ascii"
    else:
        facets = int.from_bytes(data[80:84], "little") if len(data) >= 84 else 0
        vertices = facets * 3 if facets else None
        stl_type = "binary"
    model["geometry"] = {"format": f"{stl_type} STL", "triangles": facets, "vertices_declared": vertices}
    model["mesh"].update({"nodes": vertices, "elements": facets, "element_types": {"TRIA3": facets} if facets else {}})
    model["checks"].append({"severity": "low", "message": "STL stores tessellated geometry only; materials, loads, and constraints are not expected."})
    return model


def parse_vtk(path: Path) -> dict[str, Any]:
    model = base_summary(path, "lightweight")
    text = read_text(path)
    upper = text.upper()
    points = cells = point_data = cell_data = None
    match = re.search(r"\bPOINTS\s+(\d+)", upper)
    if match:
        points = int(match.group(1))
    match = re.search(r"\bCELLS\s+(\d+)", upper)
    if match:
        cells = int(match.group(1))
    match = re.search(r"\bPOINT_DATA\s+(\d+)", upper)
    if match:
        point_data = int(match.group(1))
    match = re.search(r"\bCELL_DATA\s+(\d+)", upper)
    if match:
        cell_data = int(match.group(1))
    if path.suffix.lower() in {".vtu", ".vtp", ".vti"}:
        points_match = re.search(r"NumberOfPoints\s*=\s*['\"](\d+)", text)
        cells_match = re.search(r"NumberOfCells\s*=\s*['\"](\d+)", text)
        points = int(points_match.group(1)) if points_match else points
        cells = int(cells_match.group(1)) if cells_match else cells
    model["mesh"].update({"nodes": points, "elements": cells, "element_types": {}})
    model["results"] = {"point_data_count": point_data, "cell_data_count": cell_data}
    model["checks"].append({"severity": "low", "message": "VTK files are usually mesh/result containers; verify source solver metadata separately."})
    return model


def parse_text_result(path: Path) -> dict[str, Any]:
    model = base_summary(path, "lightweight")
    text = read_text(path)
    upper = text.upper()
    markers = {"displacement": upper.count("DISPLACEMENT"), "stress": upper.count("STRESS"), "strain": upper.count("STRAIN"), "eigenvalue": upper.count("EIGENVALUE"), "grid_point": upper.count("GRID POINT")}
    model["results"] = {"markers": {k: v for k, v in markers.items() if v}}
    if not model["results"]["markers"]:
        model["checks"].append({"severity": "low", "message": "No common structural result markers detected in the text file."})
    return model


def parse_file(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix in {".bdf", ".dat", ".nas"}:
        return parse_bdf(path)
    if suffix == ".op2":
        return parse_op2(path)
    if suffix == ".inp":
        return parse_inp(path)
    if suffix == ".stl":
        return parse_stl(path)
    if suffix in {".vtk", ".vtu", ".vtp", ".vti"}:
        return parse_vtk(path)
    if suffix in {".f06", ".pch", ".csv", ".txt"}:
        return parse_text_result(path)
    model = base_summary(path, "unsupported")
    model["checks"].append({"severity": "medium", "message": f"Unsupported extension '{suffix}'. Add an adapter or export to STEP/STL/BDF/INP/VTK."})
    return model



def base_mesh_payload(path: Path, backend: str) -> dict[str, Any]:
    return {
        "metadata": {
            "schema": "AeroWingMesh",
            "parser": "cad-cae-parser",
            "parser_version": VERSION,
            "parser_backend": backend,
            "file_name": path.name,
            "extension": path.suffix.lower(),
        },
        "vertices": [],
        "faces": [],
        "lines": [],
        "element_types": {},
        "checks": [],
    }


MAX_PREVIEW_FACES = 40_000


def finalize_mesh_payload(payload: dict[str, Any], max_faces: int = MAX_PREVIEW_FACES) -> dict[str, Any]:
    vertices = payload.get("vertices") or []
    faces = payload.get("faces") or []
    lines = payload.get("lines") or []
    metadata = payload.get("metadata") or {}
    original_vertices = int(metadata.get("original_vertices_hint") or len(vertices))
    original_faces = int(metadata.get("original_faces_hint") or len(faces))
    original_lines = int(metadata.get("original_lines_hint") or len(lines))
    downsampled = bool(metadata.get("downsampled"))

    if len(faces) > max_faces:
        step = max(1, (len(faces) + max_faces - 1) // max_faces)
        faces = faces[::step][:max_faces]
        # Dense remap keeps large previews compact and avoids sending unused STL vertices.
        used: dict[int, int] = {}
        next_vertices: list[list[float]] = []

        def remap(index: int) -> int | None:
            if index < 0 or index >= len(vertices):
                return None
            if index not in used:
                used[index] = len(next_vertices)
                next_vertices.append(vertices[index])
            return used[index]

        remapped_faces: list[list[int]] = []
        for face in faces:
            remapped = [remap(int(index)) for index in face]
            if all(index is not None for index in remapped):
                remapped_faces.append([int(index) for index in remapped if index is not None])

        remapped_lines: list[list[int]] = []
        for line in lines:
            remapped = [remap(int(index)) for index in line]
            if all(index is not None for index in remapped):
                remapped_lines.append([int(index) for index in remapped if index is not None])

        payload["vertices"] = next_vertices
        payload["faces"] = remapped_faces
        payload["lines"] = remapped_lines
        downsampled = True
        payload["checks"].append({
            "severity": "low",
            "message": f"3D preview was downsampled from {original_faces:,} to {len(remapped_faces):,} faces for interactive display.",
        })

    payload["metadata"].update({
        "original_vertices": original_vertices,
        "original_faces": original_faces,
        "original_lines": original_lines,
        "preview_vertices": len(payload.get("vertices") or []),
        "preview_faces": len(payload.get("faces") or []),
        "preview_lines": len(payload.get("lines") or []),
        "downsampled": downsampled,
        "max_preview_faces": max_faces,
    })
    return payload


def parse_bdf_mesh(path: Path) -> dict[str, Any]:
    from pyNastran.bdf.bdf import BDF

    payload = base_mesh_payload(path, "pyNastran")
    bdf = BDF(debug=False, log=None, mode="msc")
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        bdf.read_bdf(str(path), xref=False, validate=False, punch=False)

    node_ids = sorted(bdf.nodes.keys())
    node_index = {node_id: index for index, node_id in enumerate(node_ids)}
    for node_id in node_ids:
        node = bdf.nodes[node_id]
        xyz = getattr(node, "xyz", [0.0, 0.0, 0.0])
        payload["vertices"].append([float(xyz[0]), float(xyz[1]), float(xyz[2])])

    element_types: Counter[str] = Counter()
    unsupported: Counter[str] = Counter()
    for elem in bdf.elements.values():
        elem_type = str(getattr(elem, "type", elem.__class__.__name__))
        element_types[elem_type] += 1
        ids = [node_index[nid] for nid in getattr(elem, "node_ids", []) if nid in node_index]
        if elem_type in {"CTRIA3", "CTRIAR"} and len(ids) >= 3:
            payload["faces"].append(ids[:3])
        elif elem_type in {"CQUAD4", "CQUADR"} and len(ids) >= 4:
            payload["faces"].append(ids[:4])
        elif elem_type in {"CBAR", "CBEAM", "CROD", "CONROD"} and len(ids) >= 2:
            payload["lines"].append(ids[:2])
        else:
            unsupported[elem_type] += 1
    payload["element_types"] = dict(element_types)
    if unsupported:
        payload["checks"].append({"severity": "low", "message": f"Unsupported element shapes skipped in 3D preview: {dict(unsupported)}"})
    return payload


def parse_stl_mesh(path: Path) -> dict[str, Any]:
    payload = base_mesh_payload(path, "lightweight")
    data = path.read_bytes()
    vertices: list[list[float]] = []
    faces: list[list[int]] = []
    head = data[:256].decode("latin-1", errors="ignore").lower()
    if head.lstrip().startswith("solid") and b"facet normal" in data[:1024 * 1024]:
        text = data.decode("latin-1", errors="ignore")
        for match in re.finditer(r"vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)", text):
            vertices.append([float(match.group(1)), float(match.group(2)), float(match.group(3))])
        faces = [[i, i + 1, i + 2] for i in range(0, len(vertices) - 2, 3)]
    elif len(data) >= 84:
        import struct

        count = int.from_bytes(data[80:84], "little")
        step = max(1, (count + MAX_PREVIEW_FACES - 1) // MAX_PREVIEW_FACES)
        selected_face_indices = range(0, count, step)
        for face_index in selected_face_indices:
            if len(faces) >= MAX_PREVIEW_FACES:
                break
            offset = 84 + face_index * 50
            if offset + 50 > len(data):
                break
            base = len(vertices)
            vertex_offset = offset + 12
            for _vertex in range(3):
                x, y, z = struct.unpack_from("<fff", data, vertex_offset)
                vertices.append([float(x), float(y), float(z)])
                vertex_offset += 12
            faces.append([base, base + 1, base + 2])
        payload["metadata"].update({
            "original_vertices_hint": count * 3,
            "original_faces_hint": count,
            "downsampled": step > 1,
        })
        if step > 1:
            payload["checks"].append({
                "severity": "low",
                "message": f"Binary STL preview was sampled while reading from {count:,} to {len(faces):,} faces for interactive display.",
            })
    payload["vertices"] = vertices
    payload["faces"] = faces
    payload["element_types"] = {"TRIA3": len(faces)}
    return payload


def parse_vtk_mesh(path: Path) -> dict[str, Any]:
    payload = base_mesh_payload(path, "lightweight")
    text = read_text(path)
    tokens = text.replace("\r", "\n").split()
    upper = [token.upper() for token in tokens]
    vertices: list[list[float]] = []
    faces: list[list[int]] = []
    lines: list[list[int]] = []
    try:
        points_i = upper.index("POINTS")
        point_count = int(tokens[points_i + 1])
        cursor = points_i + 3
        for i in range(point_count):
            vertices.append([float(tokens[cursor + i * 3]), float(tokens[cursor + i * 3 + 1]), float(tokens[cursor + i * 3 + 2])])
        cells_i = upper.index("CELLS")
        cell_count = int(tokens[cells_i + 1])
        cursor = cells_i + 3
        cell_sizes: Counter[str] = Counter()
        for _ in range(cell_count):
            n = int(tokens[cursor])
            ids = [int(tokens[cursor + j + 1]) for j in range(n)]
            cursor += n + 1
            if n == 2:
                lines.append(ids)
                cell_sizes["LINE2"] += 1
            elif n in {3, 4}:
                faces.append(ids)
                cell_sizes["TRIA3" if n == 3 else "QUAD4"] += 1
            else:
                cell_sizes[f"POLY{n}"] += 1
        payload["element_types"] = dict(cell_sizes)
    except Exception as exc:
        payload["checks"].append({"severity": "medium", "message": f"Could not parse legacy ASCII VTK mesh: {exc}"})
    payload["vertices"] = vertices
    payload["faces"] = faces
    payload["lines"] = lines
    return payload


def parse_mesh_file(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix in {".bdf", ".dat", ".nas"}:
        try:
            return finalize_mesh_payload(parse_bdf_mesh(path))
        except Exception as exc:
            payload = base_mesh_payload(path, "pyNastran-failed")
            payload["checks"].append({"severity": "medium", "message": f"BDF mesh export failed: {exc}"})
            return finalize_mesh_payload(payload)
    if suffix == ".stl":
        return finalize_mesh_payload(parse_stl_mesh(path))
    if suffix == ".vtk":
        return finalize_mesh_payload(parse_vtk_mesh(path))
    payload = base_mesh_payload(path, "unsupported")
    payload["checks"].append({"severity": "medium", "message": f"3D mesh preview is not implemented for '{suffix}' yet."})
    return finalize_mesh_payload(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize CAD/CAE files into AeroWingModel JSON.")
    parser.add_argument("file", type=Path, help="CAD/CAE file path")
    parser.add_argument("--json", dest="json_path", type=Path, help="Optional JSON output path")
    parser.add_argument("--mesh-json", action="store_true", help="Export renderable mesh JSON instead of model summary")
    args = parser.parse_args()

    if not args.file.exists():
        raise SystemExit(f"File not found: {args.file}")
    model = parse_mesh_file(args.file) if args.mesh_json else parse_file(args.file)
    payload = json.dumps(model, ensure_ascii=False, indent=2)
    if args.json_path:
        args.json_path.parent.mkdir(parents=True, exist_ok=True)
        args.json_path.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
