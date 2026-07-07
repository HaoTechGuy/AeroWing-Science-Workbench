"""AeroWing engineering tools exposed to the agent runtime."""

from __future__ import annotations

import importlib.util
import math
import os
import shutil
from pathlib import Path
from typing import Any

from langchain.tools import ToolRuntime, tool


SEA_LEVEL_TEMPERATURE_K = 288.15
SEA_LEVEL_PRESSURE_PA = 101325.0
LAPSE_RATE_K_PER_M = 0.0065
GAMMA_AIR = 1.4
GAS_CONSTANT_AIR = 287.05287
GRAVITY = 9.80665


def _configurable(runtime: ToolRuntime) -> dict[str, Any]:
    return (runtime.config or {}).get("configurable", {})


def _workspace_root(runtime: ToolRuntime) -> Path:
    value = _configurable(runtime).get("internagents_workspace_path")
    if isinstance(value, str) and value.strip():
        return Path(value).expanduser().resolve()
    return Path.cwd().resolve()


def _resolve_workspace_path(path: str, runtime: ToolRuntime) -> Path:
    workspace_root = _workspace_root(runtime)
    candidate = Path(path).expanduser()
    resolved = candidate.resolve() if candidate.is_absolute() else (workspace_root / candidate).resolve()
    try:
        resolved.relative_to(workspace_root)
    except ValueError as exc:
        raise ValueError("Requested path is outside the active workspace.") from exc
    return resolved


def _load_cae_parser_module() -> Any:
    app_root = Path(__file__).resolve().parent.parent
    parser_path = app_root / "skills" / "cad-cae-parser" / "tools" / "parse_cae_file.py"
    if not parser_path.exists():
        raise FileNotFoundError(f"CAE parser script not found: {parser_path}")
    spec = importlib.util.spec_from_file_location("aerowing_parse_cae_file", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load CAE parser script: {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _standard_atmosphere(altitude_m: float) -> dict[str, float]:
    if altitude_m < 0:
        altitude_m = 0.0
    if altitude_m <= 11000:
        temperature = SEA_LEVEL_TEMPERATURE_K - LAPSE_RATE_K_PER_M * altitude_m
        pressure = SEA_LEVEL_PRESSURE_PA * (
            temperature / SEA_LEVEL_TEMPERATURE_K
        ) ** (GRAVITY / (GAS_CONSTANT_AIR * LAPSE_RATE_K_PER_M))
    else:
        temperature = 216.65
        pressure_11km = SEA_LEVEL_PRESSURE_PA * (
            temperature / SEA_LEVEL_TEMPERATURE_K
        ) ** (GRAVITY / (GAS_CONSTANT_AIR * LAPSE_RATE_K_PER_M))
        pressure = pressure_11km * math.exp(
            -GRAVITY * (altitude_m - 11000) / (GAS_CONSTANT_AIR * temperature)
        )
    density = pressure / (GAS_CONSTANT_AIR * temperature)
    speed_of_sound = math.sqrt(GAMMA_AIR * GAS_CONSTANT_AIR * temperature)
    dynamic_viscosity = 1.458e-6 * temperature**1.5 / (temperature + 110.4)
    return {
        "altitude_m": altitude_m,
        "temperature_k": temperature,
        "pressure_pa": pressure,
        "density_kg_m3": density,
        "speed_of_sound_m_s": speed_of_sound,
        "dynamic_viscosity_pa_s": dynamic_viscosity,
    }


def _round_floats(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: _round_floats(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_round_floats(item) for item in value]
    return value


@tool("calculate_flight_condition")
def calculate_flight_condition(
    altitude_m: float,
    runtime: ToolRuntime,
    mach: float | None = None,
    speed_m_s: float | None = None,
    reference_length_m: float | None = None,
    reference_area_m2: float | None = None,
    weight_n: float | None = None,
    load_factor: float = 1.0,
) -> dict[str, Any]:
    """Calculate standard atmosphere, Mach/speed, dynamic pressure, Reynolds number, and required CL."""

    atmosphere = _standard_atmosphere(float(altitude_m))
    if speed_m_s is None:
        if mach is None:
            raise ValueError("Provide either mach or speed_m_s.")
        speed = float(mach) * atmosphere["speed_of_sound_m_s"]
    else:
        speed = float(speed_m_s)
        mach = speed / atmosphere["speed_of_sound_m_s"]

    dynamic_pressure = 0.5 * atmosphere["density_kg_m3"] * speed**2
    reynolds = None
    if reference_length_m and reference_length_m > 0:
        reynolds = (
            atmosphere["density_kg_m3"]
            * speed
            * float(reference_length_m)
            / atmosphere["dynamic_viscosity_pa_s"]
        )
    required_cl = None
    if reference_area_m2 and reference_area_m2 > 0 and weight_n and weight_n > 0:
        required_cl = float(weight_n) * float(load_factor) / (
            dynamic_pressure * float(reference_area_m2)
        )

    return _round_floats(
        {
            "schema": "AeroWingFlightCondition",
            "atmosphere": atmosphere,
            "speed_m_s": speed,
            "mach": mach,
            "dynamic_pressure_pa": dynamic_pressure,
            "reynolds_number": reynolds,
            "required_lift_coefficient": required_cl,
            "load_factor": load_factor,
            "notes": [
                "ISA model is valid for preliminary engineering screening.",
                "Confirm units, reference area, and flight condition source before using for certification work.",
            ],
        }
    )


@tool("review_nastran_structure")
def review_nastran_structure(
    path: str,
    runtime: ToolRuntime,
) -> dict[str, Any]:
    """Review a Nastran BDF/DAT/NAS or OP2 file and summarize structural model completeness."""

    file_path = _resolve_workspace_path(path, runtime)
    if file_path.suffix.lower() not in {".bdf", ".dat", ".nas", ".op2", ".f06", ".pch"}:
        raise ValueError("Nastran structure review supports .bdf, .dat, .nas, .op2, .f06, and .pch files.")

    parser_module = _load_cae_parser_module()
    summary = parser_module.parse_file(file_path)
    mesh = summary.get("mesh") or {}
    materials = summary.get("materials") or {}
    loads = summary.get("loads") or {}
    checks = list(summary.get("checks") or [])

    risk_level = "low"
    if any(check.get("severity") == "high" for check in checks if isinstance(check, dict)):
        risk_level = "high"
    elif any(check.get("severity") == "medium" for check in checks if isinstance(check, dict)):
        risk_level = "medium"

    recommendations = []
    if mesh.get("elements") and not materials.get("count"):
        recommendations.append("Add or verify MAT* material definitions before structural analysis.")
    if mesh.get("elements") and not mesh.get("properties_count") and not mesh.get("properties"):
        recommendations.append("Check shell/solid/beam property cards and element-property linkage.")
    if not loads.get("constraint_count"):
        recommendations.append("Review boundary conditions; no SPC/MPC constraints were detected.")
    if not recommendations:
        recommendations.append("Model summary has no obvious lightweight completeness blockers; run solver-specific validation next.")

    return {
        "schema": "AeroWingNastranStructureReview",
        "file": str(file_path),
        "summary": summary,
        "risk_level": risk_level,
        "recommendations": recommendations,
    }


def _which_any(names: list[str]) -> str | None:
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


@tool("detect_aerowing_solvers")
def detect_aerowing_solvers(runtime: ToolRuntime) -> dict[str, Any]:
    """Detect locally available aviation CFD/FEM solver command-line tools."""

    solvers = {
        "su2": _which_any(["SU2_CFD", "su2_cfd"]),
        "openfoam": _which_any(["simpleFoam", "pimpleFoam", "icoFoam"]),
        "calculix": _which_any(["ccx", "ccx_static"]),
        "nastran": _which_any(["nastran", "msc2024", "nxnastran"]),
        "abaqus": _which_any(["abaqus"]),
        "optistruct": _which_any(["optistruct"]),
    }
    return {
        "schema": "AeroWingSolverDetection",
        "workspace": str(_workspace_root(runtime)),
        "solvers": {
            name: {
                "available": bool(path),
                "path": path,
                "hint": None if path else f"未检测到 {name} 命令；可在 PATH 中配置后重试。",
            }
            for name, path in solvers.items()
        },
    }


@tool("create_aerowing_case_skeleton")
def create_aerowing_case_skeleton(
    case_name: str,
    solver: str,
    runtime: ToolRuntime,
    source_model_path: str | None = None,
) -> dict[str, Any]:
    """Create a solver case skeleton without running the solver."""

    workspace_root = _workspace_root(runtime)
    safe_case_name = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in case_name).strip("_")
    if not safe_case_name:
        raise ValueError("case_name must contain at least one file-system-safe character.")
    solver_key = solver.lower().strip()
    case_dir = (workspace_root / "cases" / safe_case_name).resolve()
    case_dir.relative_to(workspace_root)
    case_dir.mkdir(parents=True, exist_ok=True)

    source_note = source_model_path or "not provided"
    files: dict[str, str] = {
        "README.md": (
            f"# {safe_case_name}\n\n"
            f"Solver target: `{solver_key}`\n\n"
            f"Source model: `{source_note}`\n\n"
            "This is a preparation skeleton only. Review units, mesh quality, materials, loads, and boundary conditions before running any solver.\n"
        )
    }
    if solver_key == "su2":
        files["config.cfg"] = "MATH_PROBLEM= DIRECT\nSOLVER= EULER\nMESH_FILENAME= mesh.su2\n"
    elif solver_key == "openfoam":
        files["system/controlDict"] = "application simpleFoam;\nstartFrom startTime;\nstartTime 0;\nendTime 100;\n"
        files["constant/README.md"] = "Place transportProperties, turbulenceProperties, and mesh data here.\n"
        files["0/README.md"] = "Place initial and boundary fields here.\n"
    elif solver_key == "calculix":
        files["model.inp"] = "*HEADING\nAeroWing CalculiX skeleton\n"
    else:
        files[f"{solver_key or 'solver'}-notes.md"] = "Add solver-specific deck files here.\n"

    written = []
    for relative, content in files.items():
        target = case_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        written.append(str(target))

    return {
        "schema": "AeroWingCaseSkeleton",
        "case_dir": str(case_dir),
        "solver": solver_key,
        "files": written,
    }


def aerowing_engineering_tools() -> list[Any]:
    return [
        calculate_flight_condition,
        review_nastran_structure,
        detect_aerowing_solvers,
        create_aerowing_case_skeleton,
    ]
