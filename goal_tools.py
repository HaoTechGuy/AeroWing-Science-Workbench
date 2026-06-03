"""LangChain tools that let the agent manage persistent thread goals."""

from __future__ import annotations

import json
from typing import Any, Literal

from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command

from goal_state import (
    GoalState,
    GoalValidationError,
    create_goal_state,
    goal_response,
    normalize_goal_state,
    update_goal_status,
)


def _thread_id(runtime: ToolRuntime) -> str | None:
    execution_info = getattr(runtime, "execution_info", None)
    thread_id = getattr(execution_info, "thread_id", None)
    if thread_id:
        return str(thread_id)
    configurable = (runtime.config or {}).get("configurable", {})
    fallback = configurable.get("thread_id") or configurable.get("threadId")
    return str(fallback) if fallback else None


def _current_goal(runtime: ToolRuntime) -> GoalState | None:
    return normalize_goal_state((runtime.state or {}).get("goal"))


def _tool_message(runtime: ToolRuntime, payload: dict[str, Any]) -> ToolMessage:
    return ToolMessage(
        content=json.dumps(payload, ensure_ascii=False),
        tool_call_id=runtime.tool_call_id or "goal-tool",
    )


def _command_with_goal(runtime: ToolRuntime, goal: GoalState) -> Command:
    payload = goal_response(goal)
    return Command(update={"goal": goal, "messages": [_tool_message(runtime, payload)]})


@tool("get_goal")
def get_goal(runtime: ToolRuntime) -> dict[str, Any]:
    """Get the current thread goal, including status, budget, elapsed time, and remaining tokens."""

    return goal_response(_current_goal(runtime))


@tool("create_goal")
def create_goal(
    objective: str,
    runtime: ToolRuntime,
    token_budget: int | None = None,
) -> Command | dict[str, Any]:
    """Create a new active goal only when the user explicitly asks for persistent goal mode.

    Use token_budget only when the user explicitly provides a positive token budget.
    This fails when this thread already has an active goal; terminal goals can be replaced
    by a new active goal.
    """

    current = _current_goal(runtime)
    if current is not None and current.get("status") == "active":
        return {
            "error": "cannot create a new goal because this thread already has an active goal",
            **goal_response(current),
        }

    try:
        goal = create_goal_state(
            objective,
            token_budget=token_budget,
            thread_id=_thread_id(runtime),
        )
    except GoalValidationError as exc:
        return {"error": str(exc), "goal": None, "remainingTokens": None}

    return _command_with_goal(runtime, goal)


@tool("update_goal")
def update_goal(
    status: Literal["complete", "blocked"],
    runtime: ToolRuntime,
) -> Command | dict[str, Any]:
    """Mark the current goal complete or blocked.

    Set complete only after the objective is achieved and verified. Set blocked only when meaningful
    progress cannot continue without user input or an external-state change.
    """

    current = _current_goal(runtime)
    if current is None:
        return {"error": "cannot update goal because this thread has no goal", "goal": None}

    try:
        goal = update_goal_status(current, status)
    except GoalValidationError as exc:
        return {"error": str(exc), **goal_response(current)}

    return _command_with_goal(runtime, goal)


def goal_tools() -> list[Any]:
    return [get_goal, create_goal, update_goal]
