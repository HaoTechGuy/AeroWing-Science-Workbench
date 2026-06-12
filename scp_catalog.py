"""SCP skill catalog helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_SCP_CATALOG_FILE = ROOT_DIR / "scp_catalog.json"


@dataclass(frozen=True)
class ScpSkillTool:
    skill_name: str
    display_name: str
    description: str
    endpoint: str
    transport: str
    tool_name: str
    tool_description: str
    argument_hint: dict[str, Any]
    skill_instructions: str


def load_scp_catalog(path: Path | None = None) -> list[ScpSkillTool]:
    catalog_file = path or DEFAULT_SCP_CATALOG_FILE
    data = json.loads(catalog_file.read_text(encoding="utf-8"))
    raw_skills = data.get("skills") if isinstance(data, dict) else None
    if not isinstance(raw_skills, list):
        return []

    catalog: list[ScpSkillTool] = []
    for raw in raw_skills:
        if not isinstance(raw, dict):
            continue
        item = _parse_catalog_item(raw)
        if item is not None:
            catalog.append(item)
    return catalog


def get_scp_catalog_item(
    skill_name: str,
    tool_name: str | None = None,
) -> ScpSkillTool | None:
    for item in load_scp_catalog():
        if item.skill_name != skill_name:
            continue
        if tool_name is not None and item.tool_name != tool_name:
            continue
        return item
    return None


def _parse_catalog_item(raw: dict[str, Any]) -> ScpSkillTool | None:
    required = [
        "skillName",
        "displayName",
        "description",
        "endpoint",
        "transport",
        "toolName",
        "toolDescription",
        "skillInstructions",
    ]
    values: dict[str, str] = {}
    for key in required:
        value = raw.get(key)
        if not isinstance(value, str) or not value.strip():
            return None
        values[key] = value.strip()

    argument_hint = raw.get("argumentHint")
    if not isinstance(argument_hint, dict):
        argument_hint = {}

    return ScpSkillTool(
        skill_name=values["skillName"],
        display_name=values["displayName"],
        description=values["description"],
        endpoint=values["endpoint"],
        transport=values["transport"],
        tool_name=values["toolName"],
        tool_description=values["toolDescription"],
        argument_hint=argument_hint,
        skill_instructions=values["skillInstructions"],
    )
