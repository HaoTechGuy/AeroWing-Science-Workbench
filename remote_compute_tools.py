"""Agent tools for approved remote compute jobs."""

from __future__ import annotations

import base64
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from langchain.tools import tool

REMOTE_COMPUTE_SUBMIT_TOOL = "remote_compute_submit_job"
TERMINAL_STATUSES = {"succeeded", "failed", "timeout"}
ROOT_DIR = Path(__file__).resolve().parent
COMPUTE_TOKEN_FILE = ROOT_DIR / ".internagents" / "compute" / "api-token"


def _ui_origin() -> str:
    return os.getenv("INTERNAGENTS_UI_ORIGIN", "http://127.0.0.1:3000").rstrip("/")


def _compute_api_token() -> str:
    COMPUTE_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        token = COMPUTE_TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            return token
    except OSError:
        pass
    token = secrets.token_urlsafe(32)
    try:
        with COMPUTE_TOKEN_FILE.open("x", encoding="utf-8") as handle:
            handle.write(f"{token}\n")
        return token
    except FileExistsError:
        return COMPUTE_TOKEN_FILE.read_text(encoding="utf-8").strip()


def _json_request(
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{_ui_origin()}{path}",
        data=body,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-InternAgents-Compute-Token": _compute_api_token(),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
            message = parsed.get("error") or detail
        except Exception:
            message = detail
        raise RuntimeError(message) from exc


def _text_outputs(outputs: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    decoded: list[dict[str, Any]] = []
    for output in outputs or []:
        item = {
            "path": output.get("path"),
            "size": output.get("size"),
            "leftOnRemote": output.get("leftOnRemote", False),
        }
        content_base64 = output.get("contentBase64")
        if isinstance(content_base64, str):
            try:
                raw = base64.b64decode(content_base64)
                item["text"] = raw.decode("utf-8")
            except Exception:
                item["contentBase64"] = content_base64
        decoded.append(item)
    return decoded


@tool(REMOTE_COMPUTE_SUBMIT_TOOL)
def remote_compute_submit_job(
    host_id: str,
    command: str,
    output_globs: list[str] | None = None,
    timeout_seconds: int = 1800,
    max_wait_seconds: int = 60,
) -> str:
    """Submit a shell job to a registered Linux SSH compute host after user approval.

    Use this only when the user explicitly wants work to run on an SSH compute
    host such as "rd", or when remote compute is clearly required. Keep commands
    non-interactive and self-contained. Create output files under an `out/`
    directory when results should be harvested.

    Args:
        host_id: Registered SSH compute host id, usually the Host alias such as "rd".
        command: Bash command to run on the remote host.
        output_globs: Relative output globs to harvest, for example ["out/**"].
        timeout_seconds: Remote job timeout in seconds.
        max_wait_seconds: How long this tool waits for completion before returning
            a running job id for later inspection.
    """

    normalized_host = host_id.strip()
    normalized_command = command.strip()
    if not normalized_host:
        return json.dumps({"error": "host_id is required"}, ensure_ascii=False)
    if not normalized_command:
        return json.dumps({"error": "command is required"}, ensure_ascii=False)

    submit_payload = {
        "hostId": normalized_host,
        "command": normalized_command,
        "outputGlobs": output_globs or ["out/**", "*.txt", "*.json", "*.csv"],
        "timeoutSeconds": timeout_seconds,
    }
    submitted = _json_request("POST", "/api/compute/remote-jobs", submit_payload)
    job = submitted["job"]
    job_id = job["id"]
    deadline = time.monotonic() + max(1, min(max_wait_seconds, 600))
    snapshot = job

    while time.monotonic() < deadline:
        time.sleep(1)
        snapshot = _json_request("GET", f"/api/compute/remote-jobs/{job_id}")["job"]
        if snapshot.get("status") in TERMINAL_STATUSES:
            break

    result = {
        "jobId": job_id,
        "hostId": snapshot.get("hostId"),
        "status": snapshot.get("status"),
        "submittedAt": snapshot.get("submittedAt"),
        "finishedAt": snapshot.get("finishedAt"),
        "exitCode": snapshot.get("exitCode"),
        "stdout": snapshot.get("stdout") or "",
        "stderr": snapshot.get("stderr") or "",
        "outputs": _text_outputs(snapshot.get("outputs")),
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


def remote_compute_tools() -> list[Any]:
    return [remote_compute_submit_job]
