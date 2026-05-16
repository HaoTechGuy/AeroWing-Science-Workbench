"""Local DeepAgent graph for LangGraph dev and Deep Agents UI."""

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


def _create_backend(config: dict[str, Any]) -> LocalShellBackend:
    backend_config = config.get("backend") or {}
    backend_type = backend_config.get("type", "local_shell")
    if backend_type != "local_shell":
        raise ValueError(f"Unsupported backend type: {backend_type}")

    return LocalShellBackend(
        root_dir=_resolve_config_path(backend_config.get("root_dir"), ROOT_DIR),
        inherit_env=backend_config.get("inherit_env", True),
        virtual_mode=backend_config.get("virtual_mode", False),
    )


agent_config = _load_agent_config()
backend = _create_backend(agent_config)
system_prompt = agent_config.get(
    "system_prompt",
    (
        "You are a concise helpful local development assistant. "
        "You can answer questions and help inspect or modify this local "
        "project when the user approves tool actions."
    ),
)
interrupt_on = agent_config.get("interrupt_on") or None

agent = create_deep_agent(
    model=MODEL,
    backend=backend,
    system_prompt=system_prompt,
    interrupt_on=interrupt_on,
)
