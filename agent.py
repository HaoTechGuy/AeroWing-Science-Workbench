"""InternAgents LangGraph exports for local and SSH-backed resources."""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from dotenv import dotenv_values, load_dotenv

ROOT_DIR = Path(__file__).resolve().parent
DEFAULT_DISCOVERYOS_ENV_FILE = ROOT_DIR.parent / "DiscoveryOS" / ".env.local"
DEFAULT_CONFIG_FILE = ROOT_DIR / "deepagent.config.json"
BUNDLED_DEEPAGENTS = ROOT_DIR / "deepagents" / "libs" / "deepagents"
if BUNDLED_DEEPAGENTS.exists():
    sys.path.insert(0, str(BUNDLED_DEEPAGENTS))

from deepagents import create_deep_agent
from deepagents.backends import LocalShellBackend

from internagent_resources import ResourceConfig, load_resource_config
from kb_sync_middleware import KbSyncMiddleware
from ssh_backend import SshShellBackend

load_dotenv(ROOT_DIR / ".env")


def _env_value(name: str) -> str | None:
    value = os.getenv(name)
    if value and value.strip():
        return value.strip()
    return None


def _load_discoveryos_env() -> dict[str, str | None]:
    env_file = Path(_env_value("DISCOVERYOS_ENV_FILE") or DEFAULT_DISCOVERYOS_ENV_FILE)
    if not env_file.exists():
        return {}
    return dict(dotenv_values(env_file))


def _set_env_if_missing(name: str, values: dict[str, str | None]) -> None:
    if _env_value(name):
        return
    value = values.get(name)
    if value and value.strip():
        os.environ[name] = value.strip()


discoveryos_env = _load_discoveryos_env()
for env_name in ("OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "LLM_PROVIDER", "LLM_MODEL"):
    _set_env_if_missing(env_name, discoveryos_env)


def _resolve_model() -> str:
    explicit_model = _env_value("DEEPAGENT_MODEL")
    if explicit_model:
        return explicit_model

    provider = _env_value("LLM_PROVIDER")
    model = _env_value("LLM_MODEL")
    if provider == "openrouter" and model:
        return f"openrouter:{model}"

    return "openrouter:anthropic/claude-sonnet-4"


MODEL = _resolve_model()


def _load_agent_config() -> dict[str, Any]:
    config_file = Path(_env_value("DEEPAGENT_CONFIG") or DEFAULT_CONFIG_FILE)
    if not config_file.is_absolute():
        config_file = ROOT_DIR / config_file
    if not config_file.exists():
        return {}
    with config_file.open() as f:
        return json.load(f)


def _resolve_config_path(value: str | None, default: Path) -> Path:
    if not value:
        return default
    path = Path(value)
    if path == Path("."):
        return ROOT_DIR
    if not path.is_absolute():
        return ROOT_DIR / path
    return path


def _resolve_workspace(value: str | None) -> Path:
    return _resolve_config_path(value, ROOT_DIR)


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def _clear_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    for child in path.iterdir():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()


def _normalize_skill_sources(raw_sources: Any) -> list[Any]:
    if not isinstance(raw_sources, list):
        return []

    sources: list[Any] = []
    for source in raw_sources:
        if isinstance(source, str) and source.strip():
            sources.append(source.strip())
        elif isinstance(source, dict):
            path = source.get("path")
            label = source.get("label")
            enabled = source.get("enabled", True)
            if isinstance(path, str) and path.strip() and enabled:
                if isinstance(label, str) and label.strip():
                    sources.append((path.strip(), label.strip()))
                else:
                    sources.append(path.strip())
    return sources


def _sync_selected_skills(skills_config: dict[str, Any]) -> list[Any] | None:
    if not skills_config.get("enabled", False):
        return None

    direct_sources = _normalize_skill_sources(skills_config.get("sources"))
    if direct_sources:
        return direct_sources

    selected = skills_config.get("selected")
    if not isinstance(selected, list) or not selected:
        return None

    catalog_paths = skills_config.get("catalog_paths") or skills_config.get("catalogPaths") or ["skills"]
    if not isinstance(catalog_paths, list):
        catalog_paths = ["skills"]

    catalog_roots = [
        _resolve_config_path(path, ROOT_DIR).resolve()
        for path in catalog_paths
        if isinstance(path, str) and path.strip()
    ]

    active_path = _resolve_config_path(
        skills_config.get("active_path") or skills_config.get("activePath") or ".internagents/active-skills",
        ROOT_DIR,
    ).resolve()
    internagents_dir = (ROOT_DIR / ".internagents").resolve()
    if not _is_relative_to(active_path, internagents_dir):
        raise ValueError("skills.active_path must stay inside .internagents/")

    _clear_directory(active_path)

    enabled_count = 0
    for selected_key in selected:
        if not isinstance(selected_key, str) or not selected_key.strip():
            continue

        skill_path = _resolve_config_path(selected_key, ROOT_DIR).resolve()
        if not skill_path.is_dir() or not (skill_path / "SKILL.md").is_file():
            continue
        if catalog_roots and not any(_is_relative_to(skill_path, root) for root in catalog_roots):
            continue

        destination = active_path / skill_path.name
        if destination.exists() or destination.is_symlink():
            continue
        try:
            destination.symlink_to(skill_path, target_is_directory=True)
        except OSError:
            shutil.copytree(skill_path, destination)
        enabled_count += 1

    if enabled_count == 0:
        return None

    label = skills_config.get("label")
    source_label = label.strip() if isinstance(label, str) and label.strip() else "InternAgents"
    return [(str(active_path), source_label)]


def _resolve_skills(config: dict[str, Any]) -> list[Any] | None:
    skills_config = config.get("skills")
    if isinstance(skills_config, list):
        sources = _normalize_skill_sources(skills_config)
        return sources or None
    if isinstance(skills_config, dict):
        return _sync_selected_skills(skills_config)
    return None


def _create_backend_for_resource(resource: ResourceConfig):  # noqa: ANN201
    if resource.backend == "local_shell":
        return LocalShellBackend(
            root_dir=_resolve_workspace(resource.workspace),
            inherit_env=True,
            virtual_mode=True,
            timeout=resource.timeout,
            max_output_bytes=resource.max_output_bytes,
        )
    if resource.backend == "ssh_shell":
        return SshShellBackend(
            ssh_command=resource.ssh_command or "",
            workspace=resource.workspace,
            timeout=resource.timeout,
            max_output_bytes=resource.max_output_bytes,
        )
    raise ValueError(f"Unsupported backend type: {resource.backend}")


def _resource_system_prompt(base_prompt: str, resource: ResourceConfig) -> str:
    kb_line = (
        f"KB sync is enabled at {resource.kb_path}."
        if resource.kb_path
        else "KB sync is not configured for this resource."
    )
    return (
        f"{base_prompt}\n\n"
        "You are running in a resource-bound InternAgents session.\n"
        f"Resource id: {resource.id}\n"
        f"Resource label: {resource.label}\n"
        f"Workspace: {resource.workspace}\n"
        f"{kb_line}\n"
        "Do not change server network settings, firewall settings, SSH daemon settings, or cloud security-group settings. "
        "If such a change seems necessary, stop and ask the user."
    )


def create_agent_for_resource(resource: ResourceConfig):  # noqa: ANN201
    agent_config = _load_agent_config()
    base_prompt = agent_config.get(
        "system_prompt",
        (
            "你是一个简洁、可靠、严谨的科研助手，擅长协助用户进行论文阅读、文献调研、实验分析、"
            "代码理解、研究方案设计和本地科研项目开发。请尽可能使用中文回答用户。"
        ),
    )
    backend = _create_backend_for_resource(resource)
    middleware = list(agent_config.get("middleware") or [])
    middleware.append(KbSyncMiddleware(resource=resource, backend=backend))
    return create_deep_agent(
        model=MODEL,
        backend=backend,
        skills=_resolve_skills(agent_config),
        system_prompt=_resource_system_prompt(base_prompt, resource),
        interrupt_on=agent_config.get("interrupt_on") or None,
        middleware=middleware,
    )


def _build_resource_agents() -> tuple[str, dict[str, Any]]:
    default_resource, resources = load_resource_config()
    return default_resource, {
        resource_id: create_agent_for_resource(resource)
        for resource_id, resource in resources.items()
    }


_default_resource_id, _resource_agents = _build_resource_agents()

# Backward-compatible default graph.
agent = _resource_agents[_default_resource_id]

# Static exports used by langgraph.json and the UI resource selector.
agent_local = _resource_agents.get("local", agent)
agent_h = _resource_agents.get("h", agent)
agent_volcano = _resource_agents.get("volcano", agent)
