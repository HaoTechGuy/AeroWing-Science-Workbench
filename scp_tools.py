"""LangChain tools for selected SCP skill invocations."""

from __future__ import annotations

import json
import os
from typing import Any, Literal

from langchain.tools import ToolRuntime, tool
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from scp_state import (
    ScpInvocationState,
    ScpInvocationValidationError,
    normalize_scp_invocation,
    update_scp_invocation_status as update_scp_status,
)


SCP_API_KEY_ENV = "SCP_HUB_API_KEY"


def _current_scp_invocation(runtime: ToolRuntime) -> ScpInvocationState | None:
    return normalize_scp_invocation((runtime.state or {}).get("scpInvocation"))


def _tool_message(runtime: ToolRuntime, payload: dict[str, Any]) -> ToolMessage:
    return ToolMessage(
        content=json.dumps(payload, ensure_ascii=False),
        tool_call_id=runtime.tool_call_id or "scp-tool",
    )


@tool("get_scp_invocation")
def get_scp_invocation(runtime: ToolRuntime) -> dict[str, Any]:
    """Get the active SCP invocation selected by the user, if any."""

    return {"scpInvocation": _current_scp_invocation(runtime)}


@tool("update_scp_invocation")
def update_scp_invocation(
    status: Literal["blocked", "complete", "error"],
    runtime: ToolRuntime,
    summary: str | None = None,
) -> Command | dict[str, Any]:
    """Mark the selected SCP invocation blocked, complete, or error."""

    current = _current_scp_invocation(runtime)
    if current is None:
        return {"error": "cannot update SCP invocation because none is active"}
    try:
        updated = update_scp_status(current, status, summary=summary)
    except ScpInvocationValidationError as exc:
        return {"error": str(exc), "scpInvocation": current}
    payload = {"scpInvocation": updated}
    return Command(
        update={"scpInvocation": updated, "messages": [_tool_message(runtime, payload)]}
    )


@tool("call_scp_tool")
async def call_scp_tool(
    tool_name: str,
    arguments: dict[str, Any],
    runtime: ToolRuntime,
) -> dict[str, Any]:
    """Call the user-selected SCP MCP tool.

    This tool is only valid when the thread has an active SCP invocation. The
    requested tool_name must exactly match the tool selected by the user.
    """

    invocation = _current_scp_invocation(runtime)
    if invocation is None or invocation.get("status") != "active":
        return {
            "error": "No active SCP invocation. Ask the user to select a /scp skill and tool first."
        }

    expected_tool_name = invocation["toolName"]
    if tool_name != expected_tool_name:
        return {
            "error": (
                f"SCP tool {tool_name!r} is not active. "
                f"The active tool is {expected_tool_name!r} from skill "
                f"{invocation['skillName']!r}."
            )
        }

    if not isinstance(arguments, dict):
        return {"error": "arguments must be a JSON object"}

    api_key = os.getenv(SCP_API_KEY_ENV)
    if not api_key:
        return {
            "error": (
                f"Missing {SCP_API_KEY_ENV}. Set it in the backend environment "
                "before invoking SCP tools."
            )
        }

    try:
        result = await _call_scp_mcp_tool(
            endpoint=invocation["endpoint"],
            api_key=api_key,
            tool_name=tool_name,
            arguments=arguments,
        )
    except Exception as exc:
        return {"error": f"SCP tool call failed: {exc}"}

    return {
        "skillName": invocation["skillName"],
        "toolName": tool_name,
        "endpoint": invocation["endpoint"],
        "result": result,
    }


def scp_tools() -> list[Any]:
    return [get_scp_invocation, update_scp_invocation, call_scp_tool]


async def _call_scp_mcp_tool(
    *,
    endpoint: str,
    api_key: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> Any:
    transport = streamablehttp_client(
        url=endpoint,
        headers={"SCP-HUB-API-KEY": api_key},
    )
    read = None
    write = None
    session_ctx: ClientSession | None = None
    session: ClientSession | None = None
    try:
        read, write, _ = await transport.__aenter__()
        session_ctx = ClientSession(read, write)
        session = await session_ctx.__aenter__()
        await session.initialize()
        result = await session.call_tool(tool_name, arguments=arguments)
        return _parse_scp_result(result)
    finally:
        if session_ctx is not None:
            await session_ctx.__aexit__(None, None, None)
        await transport.__aexit__(None, None, None)


def _parse_scp_result(result: Any) -> Any:
    content = getattr(result, "content", None)
    if isinstance(content, list) and content:
        first = content[0]
        text = getattr(first, "text", None)
        if isinstance(text, str):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
    structured_content = getattr(result, "structuredContent", None)
    if structured_content is not None:
        return structured_content
    return str(result)
