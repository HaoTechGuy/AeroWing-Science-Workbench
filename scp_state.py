"""Pure helpers for active SCP invocations."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal, TypedDict


ScpInvocationStatus = Literal["active", "blocked", "complete", "error"]
MAX_SCP_PROMPT_CHARS = 4_000


class ScpInvocationValidationError(ValueError):
    """Raised when an SCP invocation request is invalid."""


class ScpInvocationState(TypedDict, total=False):
    id: str
    threadId: str | None
    skillName: str
    displayName: str
    toolName: str
    endpoint: str
    prompt: str
    status: ScpInvocationStatus
    summary: str
    createdAt: int
    updatedAt: int


def create_scp_invocation_state(
    *,
    skill_name: str,
    display_name: str,
    tool_name: str,
    endpoint: str,
    prompt: str,
    thread_id: str | None = None,
    now: int | None = None,
) -> ScpInvocationState:
    timestamp = int(now if now is not None else time.time())
    return {
        "id": str(uuid.uuid4()),
        "threadId": thread_id,
        "skillName": _require_text(skill_name, "skillName"),
        "displayName": _require_text(display_name, "displayName"),
        "toolName": _require_text(tool_name, "toolName"),
        "endpoint": _require_text(endpoint, "endpoint"),
        "prompt": validate_scp_prompt(prompt),
        "status": "active",
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }


def normalize_scp_invocation(value: Any) -> ScpInvocationState | None:
    if not isinstance(value, dict):
        return None
    status = value.get("status")
    if status not in {"active", "blocked", "complete", "error"}:
        return None

    try:
        return {
            "id": _require_text(str(value.get("id") or uuid.uuid4()), "id"),
            "threadId": (
                value.get("threadId") if isinstance(value.get("threadId"), str) else None
            ),
            "skillName": _require_text(value.get("skillName"), "skillName"),
            "displayName": _require_text(value.get("displayName"), "displayName"),
            "toolName": _require_text(value.get("toolName"), "toolName"),
            "endpoint": _require_text(value.get("endpoint"), "endpoint"),
            "prompt": validate_scp_prompt(value.get("prompt")),
            "status": status,
            "summary": value.get("summary") if isinstance(value.get("summary"), str) else "",
            "createdAt": _int_or_now(value.get("createdAt")),
            "updatedAt": _int_or_now(value.get("updatedAt")),
        }
    except ScpInvocationValidationError:
        return None


def update_scp_invocation_status(
    invocation: ScpInvocationState,
    status: ScpInvocationStatus,
    *,
    summary: str | None = None,
    now: int | None = None,
) -> ScpInvocationState:
    if status not in {"blocked", "complete", "error"}:
        raise ScpInvocationValidationError(
            "update_scp_invocation can only mark an invocation blocked, complete, or error"
        )
    updated: ScpInvocationState = dict(invocation)
    updated["status"] = status
    if summary is not None:
        updated["summary"] = summary.strip()
    updated["updatedAt"] = int(now if now is not None else time.time())
    return updated


def validate_scp_prompt(prompt: Any) -> str:
    if not isinstance(prompt, str):
        raise ScpInvocationValidationError("scp prompt must be a string")
    normalized = prompt.strip()
    if not normalized:
        raise ScpInvocationValidationError("scp prompt must not be empty")
    if len(normalized) > MAX_SCP_PROMPT_CHARS:
        raise ScpInvocationValidationError(
            f"scp prompt must be at most {MAX_SCP_PROMPT_CHARS} characters"
        )
    return normalized


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ScpInvocationValidationError(f"{field} must be a non-empty string")
    return value.strip()


def _int_or_now(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(time.time())
