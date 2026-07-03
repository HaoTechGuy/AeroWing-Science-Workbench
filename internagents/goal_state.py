"""Pure helpers for InternAgentS thread goals."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal, NotRequired, TypedDict

GoalStatus = Literal["active", "blocked", "complete"]
TERMINAL_GOAL_STATUSES = {"blocked", "complete"}
MAX_GOAL_OBJECTIVE_CHARS = 4_000


class GoalValidationError(ValueError):
    """Raised when a goal request is invalid."""


class GoalState(TypedDict):
    id: str
    threadId: NotRequired[str | None]
    objective: str
    status: GoalStatus
    tokenBudget: NotRequired[int | None]
    tokensUsed: int
    timeUsedSeconds: int
    createdAt: int
    updatedAt: int


def unix_seconds() -> int:
    return int(time.time())


def validate_goal_objective(objective: str) -> str:
    normalized = objective.strip()
    if not normalized:
        raise GoalValidationError("goal objective must not be empty")
    if len(normalized) > MAX_GOAL_OBJECTIVE_CHARS:
        raise GoalValidationError(
            f"goal objective must be at most {MAX_GOAL_OBJECTIVE_CHARS} characters"
        )
    return normalized


def validate_goal_budget(token_budget: int | None) -> int | None:
    if token_budget is None:
        return None
    if not isinstance(token_budget, int) or token_budget <= 0:
        raise GoalValidationError("goal token budget must be a positive integer")
    return token_budget


def create_goal_state(
    objective: str,
    *,
    token_budget: int | None = None,
    thread_id: str | None = None,
    now: int | None = None,
) -> GoalState:
    timestamp = unix_seconds() if now is None else now
    goal: GoalState = {
        "id": str(uuid.uuid4()),
        "threadId": thread_id,
        "objective": validate_goal_objective(objective),
        "status": "active",
        "tokensUsed": 0,
        "timeUsedSeconds": 0,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }
    budget = validate_goal_budget(token_budget)
    if budget is not None:
        goal["tokenBudget"] = budget
    return goal


def normalize_goal_state(value: Any) -> GoalState | None:
    if not isinstance(value, dict):
        return None
    objective = value.get("objective")
    status = value.get("status")
    goal_id = value.get("id")
    if not isinstance(objective, str) or status not in {"active", "blocked", "complete"}:
        return None
    now = unix_seconds()
    created_at = _int_or_default(value.get("createdAt"), now)
    return {
        "id": str(goal_id or uuid.uuid4()),
        "threadId": value.get("threadId") if isinstance(value.get("threadId"), str) else None,
        "objective": objective,
        "status": status,
        "tokenBudget": value.get("tokenBudget") if isinstance(value.get("tokenBudget"), int) else None,
        "tokensUsed": max(0, _int_or_default(value.get("tokensUsed"), 0)),
        "timeUsedSeconds": max(0, _int_or_default(value.get("timeUsedSeconds"), 0)),
        "createdAt": created_at,
        "updatedAt": _int_or_default(value.get("updatedAt"), created_at),
    }


def update_goal_status(
    goal: GoalState,
    status: GoalStatus,
    *,
    now: int | None = None,
) -> GoalState:
    if status not in TERMINAL_GOAL_STATUSES:
        raise GoalValidationError("update_goal can only mark a goal complete or blocked")
    timestamp = unix_seconds() if now is None else now
    updated: GoalState = dict(goal)
    updated["status"] = status
    updated["updatedAt"] = timestamp
    updated["timeUsedSeconds"] = max(
        updated.get("timeUsedSeconds", 0),
        timestamp - updated.get("createdAt", timestamp),
    )
    return updated


def goal_with_elapsed(goal: GoalState, *, now: int | None = None) -> GoalState:
    if goal.get("status") != "active":
        return goal
    timestamp = unix_seconds() if now is None else now
    updated: GoalState = dict(goal)
    updated["timeUsedSeconds"] = max(
        updated.get("timeUsedSeconds", 0),
        timestamp - updated.get("createdAt", timestamp),
    )
    return updated


def goal_response(goal: GoalState | None, *, now: int | None = None) -> dict[str, Any]:
    elapsed_goal = goal_with_elapsed(goal, now=now) if goal else None
    remaining_tokens = None
    if elapsed_goal and isinstance(elapsed_goal.get("tokenBudget"), int):
        remaining_tokens = max(0, elapsed_goal["tokenBudget"] - elapsed_goal["tokensUsed"])
    return {
        "goal": elapsed_goal,
        "remainingTokens": remaining_tokens,
    }


def _int_or_default(value: Any, default: int) -> int:
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
