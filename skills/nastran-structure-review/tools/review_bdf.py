#!/usr/bin/env python3
"""Nastran structure review entry point for AeroWing."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any


def load_parser() -> Any:
    root = Path(__file__).resolve().parents[3]
    parser_path = root / "skills" / "cad-cae-parser" / "tools" / "parse_cae_file.py"
    spec = importlib.util.spec_from_file_location("aerowing_parse_cae_file", parser_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load parser: {parser_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def review(path: Path) -> dict[str, Any]:
    parser = load_parser()
    summary = parser.parse_file(path)
    mesh = summary.get("mesh") or {}
    materials = summary.get("materials") or {}
    loads = summary.get("loads") or {}
    checks = list(summary.get("checks") or [])

    recommendations = []
    if mesh.get("elements") and not materials.get("count"):
        recommendations.append("补充或确认 MAT* 材料卡片。")
    if mesh.get("elements") and not mesh.get("properties_count") and not mesh.get("properties"):
        recommendations.append("检查 PSHELL/PCOMP/PBAR/PBEAM/PSOLID 等属性卡片及其与单元的关联。")
    if not loads.get("constraint_count"):
        recommendations.append("检查 SPC/MPC 边界条件，避免刚体模态或约束不足。")
    if not loads.get("load_count"):
        recommendations.append("确认载荷卡片或 Case Control 是否完整。")
    if not recommendations:
        recommendations.append("未发现轻量审查层面的明显完整性阻断项；下一步建议运行求解器 deck check。")

    risk_level = "low"
    if any(isinstance(item, dict) and item.get("severity") == "high" for item in checks):
        risk_level = "high"
    elif any(isinstance(item, dict) and item.get("severity") == "medium" for item in checks):
        risk_level = "medium"

    return {
        "schema": "AeroWingNastranStructureReview",
        "file": str(path),
        "risk_level": risk_level,
        "summary": summary,
        "recommendations": recommendations,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Review Nastran structural model completeness.")
    parser.add_argument("file", type=Path)
    parser.add_argument("--json", dest="json_path", type=Path)
    args = parser.parse_args()
    if not args.file.exists():
        raise SystemExit(f"File not found: {args.file}")
    result = review(args.file)
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.json_path:
        args.json_path.parent.mkdir(parents=True, exist_ok=True)
        args.json_path.write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
