#!/usr/bin/env python3
"""Minimal `kb` CLI implementation for local Git knowledge repositories."""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except Exception:  # pragma: no cover - exercised only when PyYAML is unavailable
    yaml = None

VERSION = "0.1.0"
ATTACHMENT_FILE = ".kb-attachment.json"
DEFAULT_CONFIG = """version: 1
repo:
  kind: team-kb
  default_branch: main
domains:
  handbook:
    root: handbook/
    description: Team handbook and operational docs
    path_template: "{slug}.md"
    required_fields: [title]
    optional_fields: [tags]
    frontmatter:
      type: handbook
  projects:
    root: projects/
    description: Project notes and decisions
    path_template: "{project}/{date}-{slug}.md"
    required_fields: [project, title]
    optional_fields: [tags, source_refs]
    frontmatter:
      type: project_note
  experiments:
    root: experiments/
    description: Experiment progress and run notes
    path_template: "{project}/{date}-{slug}.md"
    required_fields: [project, title, status]
    optional_fields: [tags, external_assets, next_action]
    frontmatter:
      type: experiment_progress
  seminars:
    root: seminars/
    description: Seminar notes and summaries
    path_template: "{date}-{slug}/summary.md"
    required_fields: [title, date]
    optional_fields: [speaker, tags, source_refs]
    frontmatter:
      type: seminar
search:
  include:
    - "**/*.md"
    - "**/*.qmd"
    - "**/*.tex"
    - "**/*.yaml"
    - "**/*.yml"
    - "**/*.bib"
  exclude:
    - ".git/**"
    - "node_modules/**"
    - ".venv/**"
collaboration:
  branch_prefix: changes/
  require_human_review: false
"""

EXIT_GENERIC = 1
EXIT_ARGS = 2
EXIT_REPO_NOT_FOUND = 3
EXIT_CONFIG_INVALID = 4
EXIT_GIT_FAILED = 5
EXIT_POLICY_BLOCKED = 6
EXIT_PATH_BLOCKED = 7
EXIT_TOO_LARGE = 8
EXIT_DOMAIN_INVALID = 9


class KbError(Exception):
    """Structured CLI error."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        exit_code: int = EXIT_GENERIC,
        details: dict[str, Any] | None = None,
        suggested_commands: list[str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.details = details or {}
        self.suggested_commands = suggested_commands or []


@dataclass
class KbContext:
    cwd: Path
    kb_path: Path
    config_path: Path
    config: dict[str, Any]
    attachment: dict[str, Any] | None


def run_git(args: list[str], cwd: Path, *, check: bool = False) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        ["git", *args],
        cwd=str(cwd),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and proc.returncode != 0:
        raise KbError(
            "GIT_OPERATION_FAILED",
            proc.stderr.strip() or f"git {' '.join(args)} failed",
            exit_code=EXIT_GIT_FAILED,
            details={"args": args, "stderr": proc.stderr.strip()},
        )
    return proc


def json_dump(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False))


def print_result(args: argparse.Namespace, command: str, data: dict[str, Any], *, repo: dict[str, Any] | None = None, warnings: list[Any] | None = None, truncated: bool = False) -> None:
    if getattr(args, "json", False):
        payload: dict[str, Any] = {
            "ok": True,
            "command": command,
            "data": data,
            "warnings": warnings or [],
            "truncated": truncated,
        }
        if repo is not None:
            payload["repo"] = repo
        json_dump(payload)
    else:
        human_print(command, data, repo=repo, warnings=warnings or [])


def print_error(args: argparse.Namespace | None, error: KbError) -> int:
    wants_json = bool(getattr(args, "json", False)) if args is not None else False
    payload = {
        "ok": False,
        "error": {
            "code": error.code,
            "message": error.message,
            "details": error.details,
            "suggested_commands": error.suggested_commands,
        },
    }
    if wants_json:
        json_dump(payload)
    else:
        print(f"error: {error.code}: {error.message}", file=sys.stderr)
        for cmd in error.suggested_commands:
            print(f"suggestion: {cmd}", file=sys.stderr)
    return error.exit_code


def human_print(command: str, data: dict[str, Any], *, repo: dict[str, Any] | None, warnings: list[Any]) -> None:
    print(f"{command}: ok")
    if repo:
        print(f"repo: {repo.get('path')} branch={repo.get('branch')} head={repo.get('head')}")
    for key, value in data.items():
        if isinstance(value, (dict, list)):
            print(f"{key}: {json.dumps(value, ensure_ascii=False)}")
        else:
            print(f"{key}: {value}")
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise KbError(
            "KB_CONFIG_NOT_FOUND",
            f"No kb.yaml found at {path}.",
            exit_code=EXIT_CONFIG_INVALID,
            suggested_commands=["kb init --path .research-kb"],
        )
    text = path.read_text(encoding="utf-8")
    if yaml is None:
        raise KbError(
            "YAML_SUPPORT_UNAVAILABLE",
            "PyYAML is required to parse kb.yaml in this prototype.",
            exit_code=EXIT_CONFIG_INVALID,
        )
    try:
        loaded = yaml.safe_load(text) or {}
    except Exception as exc:
        raise KbError(
            "KB_CONFIG_PARSE_FAILED",
            f"Failed to parse kb.yaml: {exc}",
            exit_code=EXIT_CONFIG_INVALID,
            details={"path": str(path)},
        ) from exc
    if not isinstance(loaded, dict):
        raise KbError(
            "KB_CONFIG_INVALID",
            "kb.yaml must contain a mapping at the top level.",
            exit_code=EXIT_CONFIG_INVALID,
            details={"path": str(path)},
        )
    return loaded


def validate_config_dict(config: dict[str, Any]) -> list[dict[str, Any]]:
    diagnostics: list[dict[str, Any]] = []

    def diag(level: str, path: str, message: str) -> None:
        diagnostics.append({"level": level, "path": path, "message": message})

    if config.get("version") != 1:
        diag("error", "version", "version must be 1")
    repo = config.get("repo")
    if not isinstance(repo, dict):
        diag("error", "repo", "repo must be a mapping")
    else:
        if not repo.get("default_branch"):
            diag("error", "repo.default_branch", "default_branch is required")
        if not repo.get("kind"):
            diag("warning", "repo.kind", "kind is recommended")

    domains = config.get("domains")
    if not isinstance(domains, dict) or not domains:
        diag("error", "domains", "at least one domain is required")
    else:
        for name, domain in domains.items():
            if not isinstance(domain, dict):
                diag("error", f"domains.{name}", "domain must be a mapping")
                continue
            root = domain.get("root")
            if not isinstance(root, str) or not root.strip():
                diag("error", f"domains.{name}.root", "root path must be a non-empty string")
            elif Path(root).is_absolute() or ".." in Path(root).parts:
                diag("error", f"domains.{name}.root", "root path must be relative and stay inside the KB")
            path_template = domain.get("path_template")
            if path_template is not None and not isinstance(path_template, str):
                diag("error", f"domains.{name}.path_template", "path_template must be a string")
            for field_name in ["required_fields", "optional_fields"]:
                fields = domain.get(field_name)
                if fields is not None and not isinstance(fields, list):
                    diag("error", f"domains.{name}.{field_name}", f"{field_name} must be a list")

    search = config.get("search")
    if isinstance(search, dict):
        include = search.get("include")
        if include is not None and not isinstance(include, list):
            diag("error", "search.include", "include must be a list")
    else:
        diag("warning", "search", "search configuration is recommended")

    collaboration = config.get("collaboration")
    if isinstance(collaboration, dict):
        branch_prefix = collaboration.get("branch_prefix")
        if not isinstance(branch_prefix, str) or not branch_prefix:
            diag("error", "collaboration.branch_prefix", "branch_prefix is required")
        elif branch_prefix.startswith("/") or ".." in branch_prefix:
            diag("error", "collaboration.branch_prefix", "branch_prefix must be a safe relative ref prefix")
    else:
        diag("warning", "collaboration", "collaboration configuration is recommended")

    return diagnostics


def has_errors(diagnostics: list[dict[str, Any]]) -> bool:
    return any(item.get("level") == "error" for item in diagnostics)


def parse_limit(value: int | None, *, default: int, maximum: int) -> int:
    if value is None:
        return default
    if value < 1:
        raise KbError("INVALID_LIMIT", "--limit must be greater than zero.", exit_code=EXIT_ARGS)
    return min(value, maximum)


def domain_configs(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    domains = config.get("domains")
    if isinstance(domains, dict):
        return {str(name): value for name, value in domains.items() if isinstance(value, dict)}
    return {}


def get_domain(ctx: KbContext, name: str) -> dict[str, Any]:
    domains = domain_configs(ctx.config)
    if name not in domains:
        raise KbError(
            "KB_DOMAIN_NOT_FOUND",
            f"Domain is not configured: {name}",
            exit_code=EXIT_DOMAIN_INVALID,
            details={"domain": name, "available_domains": sorted(domains)},
        )
    return domains[name]


def domain_root(ctx: KbContext, name: str) -> Path:
    domain = get_domain(ctx, name)
    root = str(domain.get("root", "")).strip()
    if not root:
        raise KbError("KB_DOMAIN_INVALID", f"Domain has no root: {name}", exit_code=EXIT_DOMAIN_INVALID)
    return resolve_inside(ctx.kb_path, root)


def parse_field_pairs(pairs: list[str]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for pair in pairs:
        if "=" not in pair:
            raise KbError("INVALID_FIELD", "--field must use key=value syntax.", exit_code=EXIT_ARGS, details={"field": pair})
        key, value = pair.split("=", 1)
        key = key.strip()
        if not key:
            raise KbError("INVALID_FIELD", "--field key must not be empty.", exit_code=EXIT_ARGS)
        if key in fields:
            existing = fields[key]
            if isinstance(existing, list):
                existing.append(value)
            else:
                fields[key] = [existing, value]
        else:
            fields[key] = value
    return fields


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip().lower()).strip("-._")
    return slug or "record"


class SafeFormatDict(dict):
    def __missing__(self, key: str) -> str:
        raise KbError("KB_DOMAIN_FIELD_REQUIRED", f"Missing template field: {key}", exit_code=EXIT_DOMAIN_INVALID, details={"field": key})


def render_path_template(template: str, fields: dict[str, Any]) -> str:
    values = {key: str(value) for key, value in fields.items() if not isinstance(value, list)}
    values.setdefault("date", date.today().isoformat())
    values.setdefault("slug", slugify(str(fields.get("title") or fields.get("name") or "record")))
    try:
        rendered = template.format_map(SafeFormatDict(values))
    except KbError:
        raise
    except Exception as exc:
        raise KbError("KB_DOMAIN_TEMPLATE_INVALID", f"Failed to render path template: {exc}", exit_code=EXIT_DOMAIN_INVALID) from exc
    if Path(rendered).is_absolute() or ".." in Path(rendered).parts:
        raise KbError("KB_DOMAIN_TEMPLATE_INVALID", "Rendered path must stay inside the domain root.", exit_code=EXIT_DOMAIN_INVALID)
    return rendered


def yaml_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if re.fullmatch(r"[A-Za-z0-9_.:/@+-]+", text):
        return text
    return json.dumps(text, ensure_ascii=False)


def render_frontmatter(frontmatter: dict[str, Any]) -> str:
    lines = ["---"]
    for key in sorted(frontmatter):
        value = frontmatter[key]
        if isinstance(value, list):
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {yaml_scalar(item)}")
        elif isinstance(value, dict):
            lines.append(f"{key}:")
            for subkey, subvalue in value.items():
                lines.append(f"  {subkey}: {yaml_scalar(subvalue)}")
        else:
            lines.append(f"{key}: {yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def read_frontmatter(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return {}
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    if yaml is None:
        return {}
    try:
        data = yaml.safe_load(text[4:end]) or {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def config_roots(config: dict[str, Any]) -> list[str]:
    domains = domain_configs(config)
    if domains:
        return [
            str(value.get("root", "")).strip().rstrip("/")
            for value in domains.values()
            if isinstance(value.get("root"), str) and value.get("root", "").strip()
        ]
    # Backward-compatible read support for older draft configs.
    content = config.get("content")
    roots = content.get("roots") if isinstance(content, dict) else {}
    if not isinstance(roots, dict):
        return []
    return [str(value).strip().rstrip("/") for value in roots.values() if isinstance(value, str) and value.strip()]


def rel_path(path: Path, root: Path) -> str:
    value = path.relative_to(root).as_posix()
    return "." if value == "." else value


def resolve_inside(root: Path, user_path: str) -> Path:
    candidate = Path(user_path)
    if candidate.is_absolute():
        raise KbError("PATH_OUTSIDE_KB", "Absolute paths are not allowed.", exit_code=EXIT_PATH_BLOCKED)
    resolved = (root / candidate).resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise KbError("PATH_OUTSIDE_KB", "Path must stay inside the KB root.", exit_code=EXIT_PATH_BLOCKED) from exc
    return resolved


def ensure_content_path(ctx: KbContext, path: Path) -> None:
    rel = rel_path(path, ctx.kb_path)
    if rel == ".":
        return
    roots = config_roots(ctx.config)
    if not roots:
        return
    if any(rel == root or rel.startswith(f"{root}/") for root in roots):
        return
    raise KbError(
        "PATH_OUTSIDE_ALLOWED_ROOTS",
        f"Path is outside configured content roots: {rel}",
        exit_code=EXIT_PATH_BLOCKED,
        details={"path": rel, "allowed_roots": roots},
    )


def path_is_excluded(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) or Path(path).match(pattern) for pattern in patterns)


def search_patterns(ctx: KbContext) -> tuple[list[str], list[str]]:
    search = ctx.config.get("search")
    include = ["**/*"] 
    exclude = [".git/**"]
    if isinstance(search, dict):
        if isinstance(search.get("include"), list):
            include = [str(item) for item in search["include"]]
        if isinstance(search.get("exclude"), list):
            exclude = [str(item) for item in search["exclude"]]
    return include, exclude


def is_included_file(ctx: KbContext, path: Path) -> bool:
    rel = rel_path(path, ctx.kb_path)
    include, exclude = search_patterns(ctx)
    if path_is_excluded(rel, exclude):
        return False
    return any(fnmatch.fnmatch(rel, pattern) or Path(rel).match(pattern) for pattern in include)


def iter_search_files(ctx: KbContext, start: Path) -> list[Path]:
    if start.is_file():
        return [start] if is_included_file(ctx, start) else []
    files: list[Path] = []
    for path in sorted(start.rglob("*")):
        if not path.is_file():
            continue
        rel = rel_path(path, ctx.kb_path)
        if rel.startswith(".git/"):
            continue
        if is_included_file(ctx, path):
            files.append(path)
    return files


def current_commit(ctx: KbContext) -> str | None:
    proc = run_git(["rev-parse", "--short", "HEAD"], ctx.kb_path)
    return proc.stdout.strip() if proc.returncode == 0 else None


def git_output(args: list[str], cwd: Path) -> str | None:
    proc = run_git(args, cwd)
    if proc.returncode != 0:
        return None
    return proc.stdout.strip()


def git_has_commit(repo: Path) -> bool:
    proc = run_git(["rev-parse", "--verify", "HEAD"], repo)
    return proc.returncode == 0


def git_current_branch(repo: Path) -> str | None:
    return git_output(["symbolic-ref", "--quiet", "--short", "HEAD"], repo)


def git_remote_url(repo: Path, remote: str) -> str | None:
    return git_output(["remote", "get-url", remote], repo)


def git_upstream(repo: Path) -> str | None:
    return git_output(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repo)


def git_ahead_behind(repo: Path, upstream: str | None) -> tuple[int | None, int | None]:
    if not upstream or not git_has_commit(repo):
        return None, None
    proc = run_git(["rev-list", "--left-right", "--count", f"HEAD...{upstream}"], repo)
    if proc.returncode != 0:
        return None, None
    parts = proc.stdout.strip().split()
    if len(parts) != 2:
        return None, None
    return int(parts[0]), int(parts[1])


def git_dirty_summary(repo: Path) -> dict[str, Any]:
    proc = run_git(["status", "--porcelain=v1"], repo, check=True)
    lines = [line for line in proc.stdout.splitlines() if line]
    return {
        "clean": not lines,
        "untracked_count": sum(1 for line in lines if line.startswith("??")),
        "modified_count": sum(1 for line in lines if not line.startswith("??")),
        "files": [line[3:] if len(line) > 3 else line for line in lines],
    }


def sync_status_data(ctx: KbContext, *, remote: str = "origin", fetch: bool = False) -> dict[str, Any]:
    if fetch and git_remote_url(ctx.kb_path, remote):
        run_git(["fetch", remote, "--prune"], ctx.kb_path, check=True)
    branch = git_current_branch(ctx.kb_path)
    upstream = git_upstream(ctx.kb_path)
    ahead, behind = git_ahead_behind(ctx.kb_path, upstream)
    dirty = git_dirty_summary(ctx.kb_path)
    return {
        "remote": remote,
        "remote_url": git_remote_url(ctx.kb_path, remote),
        "branch": branch,
        "upstream": upstream,
        "head": current_commit(ctx),
        "ahead": ahead,
        "behind": behind,
        "has_commit": git_has_commit(ctx.kb_path),
        "dirty": dirty,
    }


def parse_range(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    if ":" not in value:
        raise KbError("INVALID_RANGE", "--range must use start:end syntax.", exit_code=EXIT_ARGS)
    start_text, end_text = value.split(":", 1)
    try:
        start = int(start_text)
        end = int(end_text)
    except ValueError as exc:
        raise KbError("INVALID_RANGE", "--range values must be integers.", exit_code=EXIT_ARGS) from exc
    if start < 1 or end < start:
        raise KbError("INVALID_RANGE", "--range must be 1-based and end must be >= start.", exit_code=EXIT_ARGS)
    return start, end


def read_attachment(cwd: Path) -> dict[str, Any] | None:
    path = cwd / ATTACHMENT_FILE
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise KbError(
            "KB_ATTACHMENT_INVALID",
            f"Failed to parse {ATTACHMENT_FILE}: {exc}",
            exit_code=EXIT_REPO_NOT_FOUND,
        ) from exc
    if not isinstance(data, dict):
        raise KbError("KB_ATTACHMENT_INVALID", f"{ATTACHMENT_FILE} must contain an object.", exit_code=EXIT_REPO_NOT_FOUND)
    return data


def resolve_kb_path(args: argparse.Namespace) -> Path:
    cwd = Path(getattr(args, "cwd", ".") or ".").resolve()
    explicit = getattr(args, "kb_path", None)
    if explicit:
        return Path(explicit).expanduser().resolve()
    attachment = read_attachment(cwd)
    if attachment and attachment.get("path"):
        return (cwd / str(attachment["path"])).resolve()
    if (cwd / "kb.yaml").exists():
        return cwd
    if (cwd / ".research-kb" / "kb.yaml").exists():
        return (cwd / ".research-kb").resolve()
    raise KbError(
        "KB_REPO_NOT_FOUND",
        "No knowledge repository found in current directory.",
        exit_code=EXIT_REPO_NOT_FOUND,
        suggested_commands=["kb init --path .research-kb", "kb attach --path .research-kb"],
    )


def load_context(args: argparse.Namespace) -> KbContext:
    cwd = Path(getattr(args, "cwd", ".") or ".").resolve()
    kb_path = resolve_kb_path(args)
    if not kb_path.exists():
        raise KbError("KB_REPO_NOT_FOUND", f"KB path does not exist: {kb_path}", exit_code=EXIT_REPO_NOT_FOUND)
    config_path = kb_path / "kb.yaml"
    config = load_yaml(config_path)
    attachment = read_attachment(cwd)
    return KbContext(cwd=cwd, kb_path=kb_path, config_path=config_path, config=config, attachment=attachment)


def repo_info(ctx: KbContext) -> dict[str, Any]:
    default_branch = ctx.config.get("repo", {}).get("default_branch", "main") if isinstance(ctx.config.get("repo"), dict) else "main"
    return {
        "path": str(ctx.kb_path),
        "branch": git_current_branch(ctx.kb_path),
        "head": current_commit(ctx),
        "default_branch": default_branch,
    }


def add_common_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--json", action="store_true", help="emit JSON on stdout")
    parser.add_argument("--table", action="store_true", help="emit human table output where supported")
    parser.add_argument("--compact", action="store_true", help="emit compact machine output")
    parser.add_argument("--cwd", default=".", help="working directory for attachment lookup")
    parser.add_argument("--kb-path", help="explicit KB path override")
    parser.add_argument("--no-color", action="store_true", help="disable color output")


def add_domain_flag(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--domain", help="configured domain name")


def command_schema() -> dict[str, Any]:
    return {
        "version": VERSION,
        "global_rules": [
            "Use --json for agent calls.",
            "Read stdout as data and stderr as logs.",
            "On failure, inspect error.code and suggested_commands.",
            "Run kb config validate before writes.",
            "Use kb domain list and kb domain schema before domain append.",
        ],
        "commands": {
            "bootstrap": {
                "description": "Attach a Git knowledge-base repository to the current project.",
                "example": "kb bootstrap --json",
                "next": [
                    "kb bootstrap --repo <git-url> --json",
                    "kb attach --repo <git-url> --path .research-kb --clone --init-if-missing --json",
                    "kb config validate --json",
                    "kb domain list --json",
                ],
            },
            "config.validate": {
                "description": "Validate kb.yaml.",
                "example": "kb config validate --json",
            },
            "domain.list": {
                "description": "Discover configured knowledge domains.",
                "example": "kb domain list --json",
            },
            "domain.schema": {
                "description": "Inspect required fields and path template for one domain.",
                "example": "kb domain schema experiments --json",
            },
            "domain.append": {
                "description": "Create a Markdown record in a configured domain.",
                "example": "kb domain append --domain experiments --field project=demo --field title='first run' --field status=running --json",
            },
            "retrieval": {
                "description": "Bounded repo navigation and reading.",
                "examples": [
                    "kb tree --domain handbook --max-depth 3 --limit 200 --json",
                    "kb grep slurm --domain handbook --context 2 --limit 10 --json",
                    "kb read handbook/compute/slurm.md --range 1:120 --json",
                ],
            },
            "sync": {
                "description": "Inspect and synchronize Git remote state.",
                "examples": [
                    "kb sync status --fetch --json",
                    "kb sync pull --fetch --json",
                    "kb sync push --dry-run --json",
                    "kb sync push --json",
                ],
            },
        },
    }


def domain_schema_contract() -> dict[str, Any]:
    return {
        "root": {"type": "string", "required": True, "description": "Directory root inside the KB."},
        "description": {"type": "string", "required": False, "description": "Agent-readable domain purpose."},
        "path_template": {"type": "string", "required": True, "description": "Relative path under root using fields/date/slug."},
        "required_fields": {"type": "array[string]", "required": False, "description": "Fields required for kb domain append."},
        "optional_fields": {"type": "array[string]", "required": False, "description": "Accepted optional fields."},
        "frontmatter": {"type": "object", "required": False, "description": "Default frontmatter merged into generated records."},
    }


def cmd_init(args: argparse.Namespace) -> int:
    target = Path(args.path).expanduser()
    if not target.is_absolute():
        target = (Path(args.cwd).resolve() / target).resolve()
    target.mkdir(parents=True, exist_ok=True)

    config_path = target / "kb.yaml"
    if config_path.exists():
        raise KbError(
            "KB_CONFIG_EXISTS",
            f"Refusing to overwrite existing config: {config_path}",
            exit_code=EXIT_POLICY_BLOCKED,
            suggested_commands=[f"kb status --kb-path {target} --json"],
        )

    created: list[str] = []
    config_text = DEFAULT_CONFIG.replace("kind: team-kb", f"kind: {args.kind}")
    config_text = config_text.replace("default_branch: main", f"default_branch: {args.default_branch}")
    config_path.write_text(config_text, encoding="utf-8")
    created.append("kb.yaml")
    for directory in ["handbook", "projects", "experiments", "seminars"]:
        path = target / directory
        path.mkdir(exist_ok=True)
        created.append(f"{directory}/")

    git_initialized = False
    if not (target / ".git").exists():
        init_proc = run_git(["init", "--initial-branch", args.default_branch], target)
        if init_proc.returncode != 0:
            run_git(["init"], target, check=True)
            run_git(["symbolic-ref", "HEAD", f"refs/heads/{args.default_branch}"], target, check=True)
        git_initialized = True

    data = {
        "path": str(target),
        "created": created,
        "git_initialized": git_initialized,
        "next_commands": [f"kb status --kb-path {target} --json"],
    }
    print_result(args, "kb init", data)
    return 0


def initialize_kb_config(target: Path, *, kind: str = "team-kb", default_branch: str = "main") -> list[str]:
    config_path = target / "kb.yaml"
    if config_path.exists():
        raise KbError(
            "KB_CONFIG_EXISTS",
            f"Refusing to overwrite existing config: {config_path}",
            exit_code=EXIT_POLICY_BLOCKED,
        )
    created: list[str] = []
    config_text = DEFAULT_CONFIG.replace("kind: team-kb", f"kind: {kind}")
    config_text = config_text.replace("default_branch: main", f"default_branch: {default_branch}")
    config_path.write_text(config_text, encoding="utf-8")
    created.append("kb.yaml")
    for directory in ["handbook", "projects", "experiments", "seminars"]:
        path = target / directory
        path.mkdir(exist_ok=True)
        created.append(f"{directory}/")
    return created


def cmd_attach(args: argparse.Namespace) -> int:
    if args.mode != "ignored-subrepo":
        raise KbError(
            "UNSUPPORTED_ATTACH_MODE",
            f"Attach mode is not implemented in MVP: {args.mode}",
            exit_code=EXIT_ARGS,
            details={"supported_modes": ["ignored-subrepo"]},
        )
    cwd = Path(args.cwd).resolve()
    kb_path = Path(args.path)
    resolved = kb_path if kb_path.is_absolute() else (cwd / kb_path).resolve()
    cloned = False
    initialized = False
    created: list[str] = []
    if args.clone:
        if not args.repo:
            raise KbError("MISSING_REPO_URL", "--repo is required when --clone is set.", exit_code=EXIT_ARGS)
        if resolved.exists() and any(resolved.iterdir()):
            if not (resolved / ".git").exists() and not (resolved / "kb.yaml").exists():
                raise KbError(
                    "ATTACH_PATH_NOT_SAFE",
                    f"Attach path exists and is not a Git/KB directory: {resolved}",
                    exit_code=EXIT_POLICY_BLOCKED,
                )
        elif not resolved.exists():
            resolved.parent.mkdir(parents=True, exist_ok=True)
            run_git(["clone", args.repo, str(resolved)], cwd, check=True)
            cloned = True
        elif resolved.exists() and not any(resolved.iterdir()):
            run_git(["clone", args.repo, str(resolved)], cwd, check=True)
            cloned = True
    if not (resolved / "kb.yaml").exists():
        if args.init_if_missing:
            resolved.mkdir(parents=True, exist_ok=True)
            if not (resolved / ".git").exists():
                init_proc = run_git(["init", "--initial-branch", args.default_branch], resolved)
                if init_proc.returncode != 0:
                    run_git(["init"], resolved, check=True)
                    run_git(["symbolic-ref", "HEAD", f"refs/heads/{args.default_branch}"], resolved, check=True)
            created = initialize_kb_config(resolved, kind=args.kind, default_branch=args.default_branch)
            initialized = True
        else:
            raise KbError(
                "KB_CONFIG_NOT_FOUND",
                f"No kb.yaml found at {resolved}",
                exit_code=EXIT_CONFIG_INVALID,
                suggested_commands=[f"kb init --path {args.path}", f"kb attach --path {args.path} --init-if-missing"],
            )
    config = load_yaml(resolved / "kb.yaml")
    diagnostics = validate_config_dict(config)
    if has_errors(diagnostics):
        raise KbError(
            "KB_CONFIG_INVALID",
            f"kb.yaml is invalid at {resolved}",
            exit_code=EXIT_CONFIG_INVALID,
            details={"diagnostics": diagnostics},
        )
    attachment = {"mode": args.mode, "path": args.path, "repo": args.repo}
    (cwd / ATTACHMENT_FILE).write_text(json.dumps(attachment, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    data = {
        "attachment": attachment,
        "path": str(cwd / ATTACHMENT_FILE),
        "kb_path": str(resolved),
        "cloned": cloned,
        "initialized": initialized,
        "created": created,
        "config_valid": True,
    }
    print_result(args, "kb attach", data, warnings=[d for d in diagnostics if d.get("level") == "warning"])
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    diagnostics = validate_config_dict(ctx.config)
    dirty = git_dirty_summary(ctx.kb_path)
    upstream = git_upstream(ctx.kb_path)
    ahead, behind = git_ahead_behind(ctx.kb_path, upstream)
    repo = repo_info(ctx)
    data = {
        "clean": dirty["clean"],
        "branch": repo.get("branch"),
        "head": repo.get("head"),
        "default_branch": repo.get("default_branch"),
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "untracked_count": dirty["untracked_count"],
        "modified_count": dirty["modified_count"],
        "config_valid": not has_errors(diagnostics),
        "attachment": ctx.attachment,
    }
    print_result(args, "kb status", data, repo=repo, warnings=[d for d in diagnostics if d.get("level") == "warning"])
    return EXIT_CONFIG_INVALID if has_errors(diagnostics) else 0


def cmd_config_get(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    diagnostics = validate_config_dict(ctx.config)
    data = {
        "path": "kb.yaml",
        "version": ctx.config.get("version"),
        "effective": ctx.config,
        "sources": ["kb.yaml"],
        "validation": diagnostics,
    }
    print_result(args, "kb config get", data, repo=repo_info(ctx), warnings=[d for d in diagnostics if d.get("level") == "warning"])
    return EXIT_CONFIG_INVALID if has_errors(diagnostics) else 0


def cmd_config_validate(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    diagnostics = validate_config_dict(ctx.config)
    data = {"valid": not has_errors(diagnostics), "diagnostics": diagnostics}
    print_result(args, "kb config validate", data, repo=repo_info(ctx), warnings=[d for d in diagnostics if d.get("level") == "warning"])
    return EXIT_CONFIG_INVALID if has_errors(diagnostics) else 0


def cmd_domain_list(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    domains = []
    for name, domain in sorted(domain_configs(ctx.config).items()):
        domains.append(
            {
                "name": name,
                "root": domain.get("root"),
                "description": domain.get("description"),
                "required_fields": domain.get("required_fields", []),
                "optional_fields": domain.get("optional_fields", []),
            }
        )
    print_result(args, "kb domain list", {"domains": domains}, repo=repo_info(ctx))
    return 0


def cmd_domain_schema(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    schema = get_domain(ctx, args.name)
    print_result(args, "kb domain schema", {"name": args.name, "schema": schema}, repo=repo_info(ctx))
    return 0


def cmd_domain_append(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    domain = get_domain(ctx, args.domain)
    fields = parse_field_pairs(args.field or [])
    required = domain.get("required_fields", [])
    if not isinstance(required, list):
        required = []
    missing = [str(field) for field in required if str(field) not in fields or fields[str(field)] in ("", None)]
    if missing:
        raise KbError(
            "KB_DOMAIN_FIELD_REQUIRED",
            "Missing required domain fields.",
            exit_code=EXIT_DOMAIN_INVALID,
            details={"domain": args.domain, "missing_fields": missing},
        )
    template = domain.get("path_template")
    if not isinstance(template, str) or not template.strip():
        raise KbError(
            "KB_DOMAIN_TEMPLATE_INVALID",
            f"Domain has no usable path_template: {args.domain}",
            exit_code=EXIT_DOMAIN_INVALID,
        )
    root = domain_root(ctx, args.domain)
    rendered_rel = render_path_template(template, fields)
    target = resolve_inside(root, rendered_rel)
    try:
        target.relative_to(root.resolve())
    except ValueError as exc:
        raise KbError("PATH_OUTSIDE_ALLOWED_ROOTS", "Rendered path must stay inside the domain root.", exit_code=EXIT_PATH_BLOCKED) from exc
    if target.exists():
        raise KbError(
            "PATH_EXISTS",
            f"Refusing to overwrite existing record: {rel_path(target, ctx.kb_path)}",
            exit_code=EXIT_POLICY_BLOCKED,
        )
    frontmatter = {}
    if isinstance(domain.get("frontmatter"), dict):
        frontmatter.update(domain["frontmatter"])
    frontmatter.update(fields)
    if args.dry_run:
        data = {
            "dry_run": True,
            "domain": args.domain,
            "target_path": rel_path(target, ctx.kb_path),
            "frontmatter": frontmatter,
            "committed": False,
        }
        print_result(args, "kb domain append", data, repo=repo_info(ctx))
        return 0
    target.parent.mkdir(parents=True, exist_ok=True)
    title = str(fields.get("title") or fields.get("name") or args.domain)
    body = args.body or f"# {title}\n\n"
    target.write_text(render_frontmatter(frontmatter) + body, encoding="utf-8")
    data = {
        "dry_run": False,
        "domain": args.domain,
        "created_path": rel_path(target, ctx.kb_path),
        "frontmatter": frontmatter,
        "committed": False,
    }
    print_result(args, "kb domain append", data, repo=repo_info(ctx))
    return 0


def cmd_domain_list_records(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    root = domain_root(ctx, args.domain)
    if not root.exists():
        print_result(args, "kb domain list-records", {"domain": args.domain, "records": []}, repo=repo_info(ctx))
        return 0
    limit = parse_limit(args.limit, default=50, maximum=1000)
    records: list[dict[str, Any]] = []
    omitted = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or not is_included_file(ctx, path):
            continue
        if len(records) >= limit:
            omitted += 1
            continue
        records.append(
            {
                "path": rel_path(path, ctx.kb_path),
                "frontmatter": read_frontmatter(path),
                "bytes": path.stat().st_size,
            }
        )
    data = {"domain": args.domain, "records": records, "omitted_count": omitted}
    print_result(args, "kb domain list-records", data, repo=repo_info(ctx), truncated=omitted > 0)
    return 0


def cmd_sync_status(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    data = sync_status_data(ctx, remote=args.remote, fetch=args.fetch)
    print_result(args, "kb sync status", data, repo=repo_info(ctx))
    return 0


def cmd_sync_pull(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    before = sync_status_data(ctx, remote=args.remote, fetch=args.fetch)
    if not before["remote_url"]:
        raise KbError("KB_REMOTE_NOT_FOUND", f"Remote not found: {args.remote}", exit_code=EXIT_GIT_FAILED)
    if not args.allow_dirty and not before["dirty"]["clean"]:
        raise KbError(
            "KB_WORKTREE_DIRTY",
            "Refusing to pull with a dirty KB worktree.",
            exit_code=EXIT_POLICY_BLOCKED,
            details={"dirty": before["dirty"]},
            suggested_commands=["kb status --json", "git -C .research-kb status"],
        )
    if args.dry_run:
        print_result(args, "kb sync pull", {"dry_run": True, "before": before, "after": before}, repo=repo_info(ctx))
        return 0
    branch = before["branch"]
    pull_args = ["pull", "--ff-only", args.remote]
    if branch:
        pull_args.append(branch)
    run_git(pull_args, ctx.kb_path, check=True)
    after = sync_status_data(ctx, remote=args.remote, fetch=False)
    print_result(args, "kb sync pull", {"dry_run": False, "before": before, "after": after}, repo=repo_info(ctx))
    return 0


def cmd_sync_push(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    before = sync_status_data(ctx, remote=args.remote, fetch=args.fetch)
    if not before["remote_url"]:
        raise KbError("KB_REMOTE_NOT_FOUND", f"Remote not found: {args.remote}", exit_code=EXIT_GIT_FAILED)
    if not before["has_commit"]:
        raise KbError("KB_NO_COMMITS", "Cannot push before the KB repo has at least one commit.", exit_code=EXIT_POLICY_BLOCKED)
    if not args.allow_dirty and not before["dirty"]["clean"]:
        raise KbError(
            "KB_WORKTREE_DIRTY",
            "Refusing to push with a dirty KB worktree.",
            exit_code=EXIT_POLICY_BLOCKED,
            details={"dirty": before["dirty"]},
            suggested_commands=["kb status --json", "git -C .research-kb status"],
        )
    branch = before["branch"]
    if not branch:
        raise KbError("KB_DETACHED_HEAD", "Cannot push from detached HEAD.", exit_code=EXIT_POLICY_BLOCKED)
    default_branch = ctx.config.get("repo", {}).get("default_branch", "main") if isinstance(ctx.config.get("repo"), dict) else "main"
    if args.dry_run:
        print_result(args, "kb sync push", {"dry_run": True, "before": before, "after": before, "default_branch": default_branch}, repo=repo_info(ctx))
        return 0
    run_git(["push", "-u", args.remote, branch], ctx.kb_path, check=True)
    after = sync_status_data(ctx, remote=args.remote, fetch=False)
    print_result(args, "kb sync push", {"dry_run": False, "before": before, "after": after}, repo=repo_info(ctx))
    return 0


def cmd_schema(args: argparse.Namespace) -> int:
    if args.schema_target == "commands":
        data = command_schema()
    elif args.schema_target == "domain":
        data = {"domain_schema": domain_schema_contract()}
    elif args.schema_target == "config":
        data = {
            "config_schema": {
                "version": {"required": True, "value": 1},
                "repo.default_branch": {"required": True, "type": "string"},
                "domains": {"required": True, "type": "map[string, domain_schema]"},
                "search.include": {"required": False, "type": "array[string]"},
                "search.exclude": {"required": False, "type": "array[string]"},
                "collaboration.branch_prefix": {"required": False, "type": "string"},
                "collaboration.require_human_review": {"required": False, "type": "boolean", "current_mvp_enforced": False},
            },
            "domain_schema": domain_schema_contract(),
        }
    else:
        data = {"commands": command_schema(), "config": {"domain_schema": domain_schema_contract()}}
    print_result(args, "kb schema", data)
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, message: str, details: dict[str, Any] | None = None) -> None:
        checks.append({"name": name, "ok": ok, "message": message, "details": details or {}})

    add("python3", True, sys.executable)
    add("pyyaml", yaml is not None, "PyYAML available" if yaml is not None else "PyYAML missing")
    git_proc = subprocess.run(["git", "--version"], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    add("git", git_proc.returncode == 0, git_proc.stdout.strip() or git_proc.stderr.strip())

    context_ok = True
    if args.skip_kb:
        add("kb_context", True, "skipped")
    else:
        try:
            ctx = load_context(args)
            diagnostics = validate_config_dict(ctx.config)
            add("kb_path", True, str(ctx.kb_path))
            add("kb_config", not has_errors(diagnostics), "valid" if not has_errors(diagnostics) else "invalid", {"diagnostics": diagnostics})
            sync_data = sync_status_data(ctx, fetch=False)
            add("git_remote", bool(sync_data["remote_url"]), sync_data["remote_url"] or "no origin remote configured", sync_data)
            context_ok = not has_errors(diagnostics)
        except KbError as exc:
            context_ok = False
            add("kb_context", False, exc.message, {"code": exc.code, "details": exc.details})

    ok = all(check["ok"] for check in checks if check["name"] not in {"git_remote"}) and context_ok
    data = {
        "ok": ok,
        "checks": checks,
        "suggested_commands": [
            "kb attach --repo <git-url> --path .research-kb --clone --init-if-missing --json",
            "kb config validate --json",
            "kb domain list --json",
        ],
    }
    print_result(args, "kb doctor", data)
    return 0 if ok else EXIT_GENERIC


def cmd_bootstrap(args: argparse.Namespace) -> int:
    cwd = Path(args.cwd).resolve()
    path_value = args.path
    kb_path = Path(path_value)
    resolved = kb_path if kb_path.is_absolute() else (cwd / kb_path).resolve()
    attachment = read_attachment(cwd)

    state = {
        "cwd": str(cwd),
        "path": path_value,
        "kb_path": str(resolved),
        "attachment_exists": attachment is not None,
        "path_exists": resolved.exists(),
        "config_exists": (resolved / "kb.yaml").exists(),
        "repo_url_provided": bool(args.repo),
    }
    actions: list[dict[str, Any]] = []

    if args.repo:
        actions.append(
            {
                "id": "attach_kb_repo",
                "actor": "agent",
                "description": "Clone/attach the provided Git KB repo and initialize kb.yaml if missing.",
                "command": f"kb attach --repo {args.repo} --path {path_value} --clone --init-if-missing --json",
            }
        )
        actions.append(
            {
                "id": "validate_config",
                "actor": "agent",
                "description": "Validate the KB config after attach.",
                "command": "kb config validate --json",
            }
        )
        actions.append(
            {
                "id": "discover_domains",
                "actor": "agent",
                "description": "Show available configured domains.",
                "command": "kb domain list --json",
            }
        )
        status = "ready_to_attach"
    elif attachment and state["config_exists"]:
        actions.append({"id": "validate_config", "actor": "agent", "description": "Validate attached KB.", "command": "kb config validate --json"})
        actions.append({"id": "discover_domains", "actor": "agent", "description": "Show available domains.", "command": "kb domain list --json"})
        actions.append({"id": "sync_status", "actor": "agent", "description": "Inspect remote sync state if a remote exists.", "command": "kb sync status --fetch --json"})
        status = "attached"
    elif state["path_exists"] and state["config_exists"]:
        actions.append({"id": "record_attachment", "actor": "agent", "description": "Record this KB path for the current project.", "command": f"kb attach --path {path_value} --json"})
        actions.append({"id": "validate_config", "actor": "agent", "description": "Validate attached KB.", "command": "kb config validate --json"})
        actions.append({"id": "discover_domains", "actor": "agent", "description": "Show available domains.", "command": "kb domain list --json"})
        status = "local_kb_found"
    else:
        actions.append(
            {
                "id": "create_remote_repo",
                "actor": "user",
                "description": "Create an empty private Git repository for the KB, for example on GitHub/GitLab/Gitea.",
                "required_input": "Git SSH or HTTPS URL for the new KB repository.",
                "example": "git@github.com:<owner>/<kb-repo>.git",
            }
        )
        actions.append(
            {
                "id": "rerun_bootstrap_with_repo",
                "actor": "agent",
                "description": "After the user provides the repo URL, rerun bootstrap with --repo.",
                "command": f"kb bootstrap --repo <git-url> --path {path_value} --json",
            }
        )
        actions.append(
            {
                "id": "fallback_local_init",
                "actor": "agent",
                "description": "If the user wants local-only testing without a remote, initialize a local KB.",
                "command": f"kb init --path {path_value} --json && kb attach --path {path_value} --json",
            }
        )
        status = "needs_repo_url"

    data = {
        "status": status,
        "state": state,
        "actions": actions,
        "agent_message": bootstrap_agent_message(status, path_value),
    }
    print_result(args, "kb bootstrap", data)
    return 0


def bootstrap_agent_message(status: str, path_value: str) -> str:
    if status == "needs_repo_url":
        return (
            "I can set up kb, but I need a Git repository URL for the knowledge base. "
            "Please create an empty private repo, then give me its SSH/HTTPS URL. "
            "If you only want local testing, I can initialize a local KB at "
            f"{path_value}."
        )
    if status == "ready_to_attach":
        return "I have a repo URL. Next I should attach it, validate kb.yaml, and list available domains."
    if status == "local_kb_found":
        return "I found a local KB path. Next I should record the attachment, validate config, and list domains."
    if status == "attached":
        return "kb is already attached. Next I should validate config, list domains, and check sync status."
    return "I inspected kb bootstrap state and produced next actions."


def cmd_tree(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    domain_name = getattr(args, "domain", None)
    start = domain_root(ctx, domain_name) if domain_name else resolve_inside(ctx.kb_path, args.path)
    if not start.exists():
        raise KbError("PATH_NOT_FOUND", f"Path does not exist: {domain_name or args.path}", exit_code=EXIT_PATH_BLOCKED)
    limit = parse_limit(args.limit, default=200, maximum=2000)
    max_depth = args.max_depth
    if max_depth < 0:
        raise KbError("INVALID_DEPTH", "--max-depth must be >= 0.", exit_code=EXIT_ARGS)
    entries: list[dict[str, Any]] = []
    omitted_count = 0
    base_depth = len(start.relative_to(ctx.kb_path).parts) if start != ctx.kb_path else 0
    candidates = [start] if start.is_file() else sorted(start.rglob("*"))
    for path in candidates:
        rel = rel_path(path, ctx.kb_path)
        if rel == ".git" or rel.startswith(".git/"):
            continue
        depth = len(path.relative_to(ctx.kb_path).parts) - base_depth
        if depth > max_depth:
            omitted_count += 1
            continue
        if len(entries) >= limit:
            omitted_count += 1
            continue
        item = {"path": rel, "kind": "dir" if path.is_dir() else "file"}
        if path.is_file():
            item["bytes"] = path.stat().st_size
        entries.append(item)
    data = {"root": rel_path(start, ctx.kb_path), "domain": domain_name, "max_depth": max_depth, "entries": entries, "omitted_count": omitted_count}
    print_result(args, "kb tree", data, repo=repo_info(ctx), truncated=omitted_count > 0)
    return 0


def cmd_grep(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    domain_name = getattr(args, "domain", None)
    start = domain_root(ctx, domain_name) if domain_name else resolve_inside(ctx.kb_path, args.path)
    ensure_content_path(ctx, start)
    if not start.exists():
        raise KbError("PATH_NOT_FOUND", f"Path does not exist: {args.path}", exit_code=EXIT_PATH_BLOCKED)
    limit = parse_limit(args.limit, default=10, maximum=500)
    context = args.context
    if context < 0:
        raise KbError("INVALID_CONTEXT", "--context must be >= 0.", exit_code=EXIT_ARGS)
    results: list[dict[str, Any]] = []
    omitted = 0
    commit = current_commit(ctx)
    for file_path in iter_search_files(ctx, start):
        try:
            lines = file_path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            continue
        for idx, line in enumerate(lines, start=1):
            if args.query not in line:
                continue
            if len(results) >= limit:
                omitted += 1
                continue
            line_start = max(1, idx - context)
            line_end = min(len(lines), idx + context)
            snippet = "\n".join(lines[line_start - 1 : line_end])
            results.append(
                {
                    "path": rel_path(file_path, ctx.kb_path),
                    "line_start": line_start,
                    "line_end": line_end,
                    "snippet": snippet,
                    "commit": commit,
                }
            )
    data = {
        "query": args.query,
        "path": rel_path(start, ctx.kb_path),
        "domain": domain_name,
        "context": context,
        "results": results,
        "next_cursor": None,
        "omitted_count": omitted,
    }
    print_result(args, "kb grep", data, repo=repo_info(ctx), truncated=omitted > 0)
    return 0


def cmd_read(args: argparse.Namespace) -> int:
    ctx = load_context(args)
    target = resolve_inside(ctx.kb_path, args.path)
    ensure_content_path(ctx, target)
    if not target.exists() or not target.is_file():
        raise KbError("PATH_NOT_FOUND", f"File does not exist: {args.path}", exit_code=EXIT_PATH_BLOCKED)
    selected_range = parse_range(args.range)
    size_limit = 64 * 1024
    if selected_range is None and target.stat().st_size > size_limit:
        raise KbError(
            "RESULT_TOO_LARGE",
            "File is too large for full read; provide --range.",
            exit_code=EXIT_TOO_LARGE,
            details={"bytes": target.stat().st_size, "limit": size_limit},
        )
    try:
        lines = target.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise KbError("UNSUPPORTED_FILE_ENCODING", "Only UTF-8 text files are supported.", exit_code=EXIT_ARGS) from exc
    if selected_range is None:
        start, end = 1, len(lines)
    else:
        start, end = selected_range
    clipped_end = min(end, len(lines))
    content = "\n".join(lines[start - 1 : clipped_end])
    if lines and clipped_end >= start:
        content += "\n"
    data = {
        "path": rel_path(target, ctx.kb_path),
        "line_start": start,
        "line_end": clipped_end,
        "total_lines": len(lines),
        "content": content,
        "commit": current_commit(ctx),
    }
    print_result(args, "kb read", data, repo=repo_info(ctx), truncated=selected_range is not None and end < len(lines))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kb", description="Research knowledge-base CLI")
    parser.add_argument("--version", action="version", version=f"kb {VERSION}")
    sub = parser.add_subparsers(dest="command", required=True)

    init_p = sub.add_parser("init", help="initialize a local knowledge repository")
    add_common_flags(init_p)
    init_p.add_argument("--path", default=".research-kb", help="target KB directory")
    init_p.add_argument("--kind", default="team-kb", help="repo kind for kb.yaml")
    init_p.add_argument("--default-branch", default="main", help="default branch written to kb.yaml and Git HEAD")
    init_p.set_defaults(func=cmd_init)

    attach_p = sub.add_parser("attach", help="attach a project to a knowledge repository")
    add_common_flags(attach_p)
    attach_p.add_argument("--path", default=".research-kb", help="KB path relative to cwd")
    attach_p.add_argument("--mode", default="ignored-subrepo", help="attachment mode")
    attach_p.add_argument("--repo", default=None, help="optional remote repository URL")
    attach_p.add_argument("--clone", action="store_true", help="clone --repo into --path when needed")
    attach_p.add_argument("--init-if-missing", action="store_true", help="create default kb.yaml when missing")
    attach_p.add_argument("--kind", default="team-kb", help="repo kind for initialized kb.yaml")
    attach_p.add_argument("--default-branch", default="main", help="default branch for initialized kb.yaml")
    attach_p.set_defaults(func=cmd_attach)

    status_p = sub.add_parser("status", help="show KB repo and config status")
    add_common_flags(status_p)
    status_p.set_defaults(func=cmd_status)

    schema_p = sub.add_parser("schema", help="show agent-facing command/config schemas")
    add_common_flags(schema_p)
    schema_p.add_argument("schema_target", nargs="?", choices=["all", "commands", "config", "domain"], default="all")
    schema_p.set_defaults(func=cmd_schema)

    doctor_p = sub.add_parser("doctor", help="diagnose kb runtime and attachment state")
    add_common_flags(doctor_p)
    doctor_p.add_argument("--skip-kb", action="store_true", help="only check local runtime dependencies")
    doctor_p.set_defaults(func=cmd_doctor)

    bootstrap_p = sub.add_parser("bootstrap", help="tell an agent/user how to start using kb from current state")
    add_common_flags(bootstrap_p)
    bootstrap_p.add_argument("--repo", help="optional Git repository URL for the KB")
    bootstrap_p.add_argument("--path", default=".research-kb", help="target KB attach path")
    bootstrap_p.set_defaults(func=cmd_bootstrap)

    tree_p = sub.add_parser("tree", help="show a bounded KB tree")
    add_common_flags(tree_p)
    add_domain_flag(tree_p)
    tree_p.add_argument("path", nargs="?", default=".", help="KB path to list")
    tree_p.add_argument("--max-depth", type=int, default=3, help="maximum relative depth")
    tree_p.add_argument("--limit", type=int, default=200, help="maximum entries")
    tree_p.set_defaults(func=cmd_tree)

    grep_p = sub.add_parser("grep", help="search text files in configured KB roots")
    add_common_flags(grep_p)
    add_domain_flag(grep_p)
    grep_p.add_argument("query", help="literal query string")
    grep_p.add_argument("--path", default=".", help="KB path to search")
    grep_p.add_argument("--context", type=int, default=2, help="context lines around each match")
    grep_p.add_argument("--limit", type=int, default=10, help="maximum results")
    grep_p.set_defaults(func=cmd_grep)

    read_p = sub.add_parser("read", help="read a bounded file or line range")
    add_common_flags(read_p)
    read_p.add_argument("path", help="file path inside configured content roots")
    read_p.add_argument("--range", help="1-based inclusive line range, e.g. 1:120")
    read_p.set_defaults(func=cmd_read)

    config_p = sub.add_parser("config", help="inspect and validate kb.yaml")
    config_sub = config_p.add_subparsers(dest="config_command", required=True)
    get_p = config_sub.add_parser("get", help="print effective config")
    add_common_flags(get_p)
    get_p.set_defaults(func=cmd_config_get)
    validate_p = config_sub.add_parser("validate", help="validate kb.yaml")
    add_common_flags(validate_p)
    validate_p.set_defaults(func=cmd_config_validate)

    domain_p = sub.add_parser("domain", help="inspect and create configured domain records")
    domain_sub = domain_p.add_subparsers(dest="domain_command", required=True)

    domain_list_p = domain_sub.add_parser("list", help="list configured domains")
    add_common_flags(domain_list_p)
    domain_list_p.set_defaults(func=cmd_domain_list)

    domain_schema_p = domain_sub.add_parser("schema", help="show one domain schema")
    add_common_flags(domain_schema_p)
    domain_schema_p.add_argument("name", help="domain name")
    domain_schema_p.set_defaults(func=cmd_domain_schema)

    domain_append_p = domain_sub.add_parser("append", help="append a record using a configured domain")
    add_common_flags(domain_append_p)
    domain_append_p.add_argument("--domain", required=True, help="configured domain name")
    domain_append_p.add_argument("--field", action="append", default=[], help="record field as key=value; repeatable")
    domain_append_p.add_argument("--body", help="optional Markdown body")
    domain_append_p.add_argument("--dry-run", action="store_true", help="preview target record without writing")
    domain_append_p.set_defaults(func=cmd_domain_append)

    domain_records_p = domain_sub.add_parser("list-records", help="list records under a configured domain")
    add_common_flags(domain_records_p)
    domain_records_p.add_argument("--domain", required=True, help="configured domain name")
    domain_records_p.add_argument("--limit", type=int, default=50, help="maximum records")
    domain_records_p.set_defaults(func=cmd_domain_list_records)

    sync_p = sub.add_parser("sync", help="inspect and synchronize the KB Git remote")
    sync_sub = sync_p.add_subparsers(dest="sync_command", required=True)

    sync_status_p = sync_sub.add_parser("status", help="show remote/ahead/behind state")
    add_common_flags(sync_status_p)
    sync_status_p.add_argument("--remote", default="origin", help="Git remote name")
    sync_status_p.add_argument("--fetch", action="store_true", help="fetch remote refs before reporting")
    sync_status_p.set_defaults(func=cmd_sync_status)

    sync_pull_p = sync_sub.add_parser("pull", help="fast-forward pull from the KB remote")
    add_common_flags(sync_pull_p)
    sync_pull_p.add_argument("--remote", default="origin", help="Git remote name")
    sync_pull_p.add_argument("--fetch", action="store_true", help="fetch remote refs before pulling")
    sync_pull_p.add_argument("--dry-run", action="store_true", help="preview pull state without changing refs")
    sync_pull_p.add_argument("--allow-dirty", action="store_true", help="allow pull with local uncommitted changes")
    sync_pull_p.set_defaults(func=cmd_sync_pull)

    sync_push_p = sync_sub.add_parser("push", help="push the current KB branch")
    add_common_flags(sync_push_p)
    sync_push_p.add_argument("--remote", default="origin", help="Git remote name")
    sync_push_p.add_argument("--fetch", action="store_true", help="fetch remote refs before pushing")
    sync_push_p.add_argument("--dry-run", action="store_true", help="preview push state without changing refs")
    sync_push_p.add_argument("--allow-dirty", action="store_true", help="allow push with local uncommitted changes")
    sync_push_p.set_defaults(func=cmd_sync_push)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args: argparse.Namespace | None = None
    try:
        args = parser.parse_args(argv)
        return int(args.func(args))
    except KbError as error:
        return print_error(args, error)
    except BrokenPipeError:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
