"""PDF-triggered MinerU tool middleware."""

from __future__ import annotations

import hashlib
import os
import shlex
from pathlib import PurePosixPath
from typing import Any, Awaitable, Callable, Literal

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain.tools import tool
from langchain_core.messages import SystemMessage

MINERU_TOOL_NAME = "parse_pdf_with_mineru"
MINERU_COMMAND_ENV = "INTERNAGENTS_MINERU_COMMAND"
MINERU_API_URL_ENV = "INTERNAGENTS_MINERU_API_URL"
MINERU_DEFAULT_METHOD_ENV = "INTERNAGENTS_MINERU_DEFAULT_METHOD"
MINERU_TIMEOUT_ENV = "INTERNAGENTS_MINERU_TIMEOUT_SECONDS"
DEFAULT_MINERU_TIMEOUT_SECONDS = 900
MAX_MINERU_TIMEOUT_SECONDS = 7200
MAX_MINERU_EXCERPT_CHARS = 8000

MINERU_SYSTEM_PROMPT = """PDF deep parsing:
- A PDF attachment is available in this turn. You already have a quick text extraction in the user message.
- Use parse_pdf_with_mineru only when the quick text is insufficient, the PDF appears scanned, or the user asks for tables, equations, layout, figures, OCR, or a more complete parse.
- Pass the workspace PDF path from the attachment metadata. Do not pass host absolute paths.
- After MinerU returns output paths, use filesystem tools to inspect the generated Markdown or JSON files when more detail is needed."""

HOST_ABSOLUTE_ROOTS = {
    "Applications",
    "Library",
    "System",
    "Users",
    "Volumes",
    "bin",
    "etc",
    "home",
    "opt",
    "private",
    "sbin",
    "tmp",
    "usr",
    "var",
}


def _env_value(name: str) -> str | None:
    value = os.getenv(name)
    return value.strip() if value and value.strip() else None


def _positive_int_env(name: str, default: int) -> int:
    value = _env_value(name)
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _workspace_path(value: str, *, require_pdf: bool) -> tuple[str | None, str | None]:
    if not isinstance(value, str) or not value.strip():
        return None, "Path must be a non-empty workspace-virtual path."

    raw = value.strip().replace("\\", "/")
    if raw.startswith("~"):
        return None, "Path must not use '~'."
    if not raw.startswith("/"):
        return None, "Path must be workspace-virtual, for example '/paper.pdf'."

    path = PurePosixPath(raw)
    parts = path.parts
    if any(part in {"..", ""} for part in parts):
        return None, "Path traversal is not allowed."
    if len(parts) > 1 and parts[1] in HOST_ABSOLUTE_ROOTS:
        return (
            None,
            "Host absolute paths are not allowed; use the workspace path from the PDF attachment.",
        )
    if require_pdf and path.suffix.lower() != ".pdf":
        return None, "MinerU only accepts PDF files."
    if str(path) == "/":
        return None, "Path must point to a file."

    return "/" + str(path).lstrip("/"), None


def _virtual_to_shell_path(path: str) -> str:
    return path.lstrip("/") or "."


def _default_output_dir(pdf_path: str) -> str:
    pdf = PurePosixPath(pdf_path)
    stem = pdf.stem or "pdf"
    safe_stem = "".join(
        char if char.isalnum() or char in {"-", "_"} else "-" for char in stem
    )
    digest = hashlib.sha1(pdf_path.encode("utf-8")).hexdigest()[:10]
    return f"/.internagents/mineru/{safe_stem}-{digest}"


def _tool_name(tool_like: Any) -> str | None:
    if isinstance(tool_like, dict):
        function = tool_like.get("function")
        if isinstance(function, dict) and function.get("name"):
            return str(function["name"])
        if tool_like.get("name"):
            return str(tool_like["name"])
        return None
    name = getattr(tool_like, "name", None)
    return str(name) if name else None


def _filter_mineru_tool(tools: list[Any]) -> list[Any]:
    return [tool_like for tool_like in tools if _tool_name(tool_like) != MINERU_TOOL_NAME]


def _has_pdf_attachment(messages: list[Any]) -> bool:
    for message in reversed(messages):
        message_type = getattr(message, "type", None)
        if message_type is None and isinstance(message, dict):
            message_type = message.get("type")
        if message_type not in {"human", "user"}:
            continue

        additional_kwargs = getattr(message, "additional_kwargs", None)
        if additional_kwargs is None and isinstance(message, dict):
            additional_kwargs = message.get("additional_kwargs")
        if not isinstance(additional_kwargs, dict):
            continue

        attachments = additional_kwargs.get("attachments")
        if not isinstance(attachments, list):
            continue
        for attachment in attachments:
            if (
                isinstance(attachment, dict)
                and attachment.get("kind") == "pdf"
                and attachment.get("workspacePath")
            ):
                return True
    return False


def _append_to_system_message(
    system_message: SystemMessage | None,
    text: str,
) -> SystemMessage:
    content_blocks: list[dict[str, Any]] = (
        list(system_message.content_blocks) if system_message else []
    )
    if content_blocks:
        text = f"\n\n{text}"
    content_blocks.append({"type": "text", "text": text})
    return SystemMessage(content_blocks=content_blocks)


def _find_output_paths(backend: Any, output_dir: str, pattern: str) -> list[str]:
    glob_result = backend.glob(pattern, output_dir)
    if getattr(glob_result, "error", None):
        return []
    paths: list[str] = []
    for match in getattr(glob_result, "matches", None) or []:
        if isinstance(match, dict):
            path = match.get("path")
        else:
            path = getattr(match, "path", None)
        if path:
            paths.append(str(path))
    return sorted(set(paths))


def _read_excerpt(backend: Any, paths: list[str]) -> str:
    if not paths:
        return ""
    responses = backend.download_files([paths[0]])
    if not responses:
        return ""
    response = responses[0]
    if getattr(response, "error", None) or not getattr(response, "content", None):
        return ""
    text = response.content.decode("utf-8", errors="replace")
    return text[:MAX_MINERU_EXCERPT_CHARS].strip()


def _mineru_command_parts() -> list[str]:
    command = _env_value(MINERU_COMMAND_ENV)
    if not command:
        return ["mineru"]
    try:
        parts = shlex.split(command)
    except ValueError:
        return [command]
    return parts or ["mineru"]


class PdfMinerUMiddleware(AgentMiddleware):
    """Expose MinerU parsing only when a PDF attachment is present."""

    def __init__(self, *, backend: Any) -> None:
        self.backend = backend
        self.tools = [self._create_tool()]

    @property
    def name(self) -> str:
        return "PdfMinerUMiddleware"

    def _create_tool(self):  # noqa: ANN202
        backend = self.backend

        @tool(MINERU_TOOL_NAME)
        def parse_pdf_with_mineru(
            pdf_path: str,
            method: Literal["auto", "txt", "ocr"] | None = None,
            output_dir: str | None = None,
            timeout_seconds: int | None = None,
        ) -> dict[str, Any]:
            """Parse a workspace PDF with MinerU when quick PDF text is insufficient.

            Use this for scanned PDFs, tables, equations, layout-sensitive content, figures,
            OCR, or when the quick text in the user message does not contain enough detail.
            The PDF path must be the workspace path from the PDF attachment metadata.
            """

            normalized_pdf, error = _workspace_path(pdf_path, require_pdf=True)
            if error:
                return {"ok": False, "error": error}

            selected_method = method or _env_value(MINERU_DEFAULT_METHOD_ENV) or "auto"
            if selected_method not in {"auto", "txt", "ocr"}:
                return {"ok": False, "error": "method must be one of auto, txt, or ocr."}

            if output_dir:
                normalized_output_dir, output_error = _workspace_path(
                    output_dir,
                    require_pdf=False,
                )
                if output_error:
                    return {"ok": False, "error": output_error}
            else:
                normalized_output_dir = _default_output_dir(normalized_pdf or pdf_path)

            effective_timeout = (
                timeout_seconds
                if isinstance(timeout_seconds, int) and timeout_seconds > 0
                else _positive_int_env(MINERU_TIMEOUT_ENV, DEFAULT_MINERU_TIMEOUT_SECONDS)
            )
            effective_timeout = min(effective_timeout, MAX_MINERU_TIMEOUT_SECONDS)

            command_parts = [
                *_mineru_command_parts(),
                "-p",
                _virtual_to_shell_path(normalized_pdf or pdf_path),
                "-o",
                _virtual_to_shell_path(normalized_output_dir),
                "-m",
                selected_method,
            ]
            api_url = _env_value(MINERU_API_URL_ENV)
            if api_url:
                command_parts.extend(["--api-url", api_url])

            shell_command = " ".join(shlex.quote(part) for part in command_parts)
            result = backend.execute(shell_command, timeout=effective_timeout)
            if getattr(result, "exit_code", None) not in {0, None}:
                return {
                    "ok": False,
                    "error": (
                        "MinerU command failed. Install MinerU in the active runtime "
                        f"or set {MINERU_COMMAND_ENV} / {MINERU_API_URL_ENV}."
                    ),
                    "exitCode": getattr(result, "exit_code", None),
                    "output": getattr(result, "output", ""),
                    "outputDir": normalized_output_dir,
                }

            markdown_paths = _find_output_paths(backend, normalized_output_dir, "**/*.md")
            json_paths = _find_output_paths(backend, normalized_output_dir, "**/*.json")
            excerpt = _read_excerpt(backend, markdown_paths)

            return {
                "ok": True,
                "pdfPath": normalized_pdf,
                "method": selected_method,
                "outputDir": normalized_output_dir,
                "markdownPaths": markdown_paths,
                "jsonPaths": json_paths,
                "excerpt": excerpt,
                "commandOutput": getattr(result, "output", ""),
                "truncated": getattr(result, "truncated", False),
            }

        return parse_pdf_with_mineru

    def _activate_if_needed(self, request: ModelRequest) -> ModelRequest:
        if not _has_pdf_attachment(request.messages):
            return request.override(tools=_filter_mineru_tool(request.tools))
        return request.override(
            system_message=_append_to_system_message(
                request.system_message,
                MINERU_SYSTEM_PROMPT,
            )
        )

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        return handler(self._activate_if_needed(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        return await handler(self._activate_if_needed(request))
