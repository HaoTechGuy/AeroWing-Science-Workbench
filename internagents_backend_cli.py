"""Command line entrypoints for packaged InternAgents backend runtimes."""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Sequence


def _is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _write_runtime_config(
    install_dir: Path,
    *,
    resource_id: str,
    label: str,
    workspace: str,
    remote_url: str,
) -> Path:
    config_path = install_dir / "internagent.runtime.local.json"
    config = {
        "default_resource": resource_id,
        "resources": [
            {
                "id": resource_id,
                "label": label or resource_id,
                "backend": "local_shell",
                "workspace": workspace,
                "remote_url": remote_url,
                "remote_assistant_id": "agent",
                "enabled": True,
            }
        ],
    }
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    return config_path


def _ensure_env_points_to_runtime_config(install_dir: Path) -> None:
    env_path = install_dir / ".env"
    key = "INTERNAGENT_RESOURCES_FILE"
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    next_lines: list[str] = []
    seen = False
    for line in lines:
        if line.strip().startswith(f"{key}="):
            next_lines.append(f'{key}="internagent.runtime.local.json"')
            seen = True
        else:
            next_lines.append(line)
    if not seen:
        next_lines.append(f'{key}="internagent.runtime.local.json"')
    env_path.write_text("\n".join(next_lines).rstrip() + "\n")


def _wait_for_health(url: str, timeout_seconds: int) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{url}/ok", timeout=1) as response:
                if 200 <= response.status < 300:
                    print("runtime ok")
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError(f"runtime health check timed out: {url}/ok")


def _start_runtime(args: argparse.Namespace) -> int:
    install_dir = Path(args.install_dir).expanduser().resolve()
    workspace = Path(args.workspace).expanduser()
    install_dir.mkdir(parents=True, exist_ok=True)
    workspace.mkdir(parents=True, exist_ok=True)

    remote_url = f"http://{args.host}:{args.port}"
    _write_runtime_config(
        install_dir,
        resource_id=args.resource_id,
        label=args.label,
        workspace=str(workspace.resolve(strict=False)),
        remote_url=remote_url,
    )
    _ensure_env_points_to_runtime_config(install_dir)

    runtime_dir = install_dir / ".internagents"
    log_dir = runtime_dir / "logs"
    pid_dir = runtime_dir / "pids"
    log_dir.mkdir(parents=True, exist_ok=True)
    pid_dir.mkdir(parents=True, exist_ok=True)
    pid_file = pid_dir / f"runtime-{args.resource_id}.pid"
    log_file = log_dir / f"runtime-{args.resource_id}.log"

    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
        except ValueError:
            pid = 0
        if pid > 0 and _is_running(pid):
            print(f"runtime already running pid={pid}")
            _wait_for_health(remote_url, args.health_timeout)
            return 0

    env = {
        **os.environ,
        "INTERNAGENT_PROCESS_ROLE": "runtime",
        "INTERNAGENT_RUNTIME_ID": args.resource_id,
    }
    command = [
        sys.executable,
        "-m",
        "langgraph_cli",
        "dev",
        "--host",
        args.host,
        "--port",
        str(args.port),
        "--no-browser",
        "--no-reload",
        "--config",
        "langgraph.runtime.json",
    ]
    with log_file.open("ab") as log:
        process = subprocess.Popen(
            command,
            cwd=install_dir,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    pid_file.write_text(f"{process.pid}\n")
    print(f"runtime started pid={process.pid}")
    _wait_for_health(remote_url, args.health_timeout)
    return 0


def _stop_runtime(args: argparse.Namespace) -> int:
    install_dir = Path(args.install_dir).expanduser().resolve()
    pid_file = install_dir / ".internagents" / "pids" / f"runtime-{args.resource_id}.pid"
    if not pid_file.exists():
        print("runtime pid file not found")
        return 0
    try:
        pid = int(pid_file.read_text().strip())
    except ValueError:
        pid_file.unlink(missing_ok=True)
        print("runtime pid file was invalid")
        return 0
    if pid > 1 and _is_running(pid):
        try:
            os.killpg(pid, signal.SIGTERM)
        except OSError:
            os.kill(pid, signal.SIGTERM)
        print(f"runtime stopped pid={pid}")
    pid_file.unlink(missing_ok=True)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="internagents-backend")
    subcommands = parser.add_subparsers(dest="command", required=True)

    runtime = subcommands.add_parser("runtime")
    runtime_subcommands = runtime.add_subparsers(dest="runtime_command", required=True)

    start = runtime_subcommands.add_parser("start")
    start.add_argument("--install-dir", required=True)
    start.add_argument("--resource-id", required=True)
    start.add_argument("--label", required=True)
    start.add_argument("--workspace", required=True)
    start.add_argument("--host", default="127.0.0.1")
    start.add_argument("--port", type=int, default=22024)
    start.add_argument("--health-timeout", type=int, default=60)
    start.set_defaults(func=_start_runtime)

    stop = runtime_subcommands.add_parser("stop")
    stop.add_argument("--install-dir", required=True)
    stop.add_argument("--resource-id", required=True)
    stop.set_defaults(func=_stop_runtime)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
