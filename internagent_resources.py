"""Resource configuration for multi-end InternAgents sessions."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_RESOURCES_FILE = ROOT_DIR / "internagent.resources.json"

BackendKind = Literal["local_shell", "ssh_shell"]


@dataclass(frozen=True)
class ResourceConfig:
    id: str
    label: str
    backend: BackendKind
    workspace: str
    enabled: bool = True
    ssh_command: str | None = None
    kb_path: str | None = None
    kb_command: str = "kb"
    timeout: int = 120
    max_output_bytes: int = 100_000

    @property
    def graph_name(self) -> str:
        return f"agent_{self.id}"


def _resource_file() -> Path:
    explicit = os.getenv("INTERNAGENT_RESOURCES_FILE")
    if not explicit:
        return DEFAULT_RESOURCES_FILE
    path = Path(explicit)
    return path if path.is_absolute() else ROOT_DIR / path


def _as_bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "off"}
    return bool(value)


def load_resource_config() -> tuple[str, dict[str, ResourceConfig]]:
    path = _resource_file()
    if not path.exists():
        default = ResourceConfig(
            id="local",
            label="Current Machine",
            backend="local_shell",
            workspace=".",
        )
        return default.id, {default.id: default}

    data = json.loads(path.read_text())
    resources: dict[str, ResourceConfig] = {}
    for item in data.get("resources", []):
        if not _as_bool(item.get("enabled"), True):
            continue
        resource_id = str(item["id"]).strip()
        if not resource_id:
            raise ValueError(f"Invalid empty resource id in {path}")
        if resource_id in resources:
            raise ValueError(f"Duplicate resource id {resource_id!r} in {path}")
        backend = item.get("backend", "local_shell")
        if backend not in {"local_shell", "ssh_shell"}:
            raise ValueError(f"Unsupported backend {backend!r} for resource {resource_id!r}")
        if backend == "ssh_shell" and not str(item.get("ssh_command", "")).strip():
            raise ValueError(f"ssh_shell resource {resource_id!r} requires ssh_command")
        resources[resource_id] = ResourceConfig(
            id=resource_id,
            label=str(item.get("label") or resource_id),
            backend=backend,
            workspace=str(item.get("workspace") or "."),
            ssh_command=(str(item.get("ssh_command")).strip() if item.get("ssh_command") else None),
            kb_path=(str(item.get("kb_path")).strip() if item.get("kb_path") else None),
            kb_command=str(item.get("kb_command") or "kb"),
            timeout=int(item.get("timeout") or 120),
            max_output_bytes=int(item.get("max_output_bytes") or 100_000),
        )

    if not resources:
        raise ValueError(f"No enabled resources in {path}")

    default_resource = str(data.get("default_resource") or next(iter(resources)))
    if default_resource not in resources:
        raise ValueError(f"default_resource {default_resource!r} is not enabled in {path}")
    return default_resource, resources


def get_resource(resource_id: str | None = None) -> ResourceConfig:
    default_resource, resources = load_resource_config()
    selected = resource_id or default_resource
    try:
        return resources[selected]
    except KeyError as exc:
        raise ValueError(f"Unknown resource {selected!r}") from exc
