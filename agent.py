"""InternAgents LangGraph exports for local and SSH-backed resources."""

from __future__ import annotations

import json
import os
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
            "You are a concise helpful local development assistant. "
            "You can answer questions and help inspect or modify this local "
            "project when the user approves tool actions."
        ),
    )
    backend = _create_backend_for_resource(resource)
    middleware = list(agent_config.get("middleware") or [])
    middleware.append(KbSyncMiddleware(resource=resource, backend=backend))
    return create_deep_agent(
        model=MODEL,
        backend=backend,
        system_prompt=_resource_system_prompt(base_prompt, resource),
        interrupt_on=agent_config.get("interrupt_on") or None,
        middleware=middleware,
    )


def _build_resource_agents() -> tuple[str, dict[str, Any]]:
    default_resource, resources = load_resource_config()
    return default_resource, {resource_id: create_agent_for_resource(resource) for resource_id, resource in resources.items()}


_default_resource_id, _resource_agents = _build_resource_agents()

# Backward-compatible default graph.
agent = _resource_agents[_default_resource_id]

# Static exports used by langgraph.json and the UI resource selector.
agent_local = _resource_agents.get("local", agent)
agent_h = _resource_agents.get("h", agent)
agent_volcano = _resource_agents.get("volcano", agent)
