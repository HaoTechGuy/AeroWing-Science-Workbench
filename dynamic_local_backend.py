"""Dynamic local backend that follows the active resource workspace."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from deepagents.backends import LocalShellBackend
from deepagents.backends.protocol import (
    EditResult,
    FileDownloadResponse,
    FileUploadResponse,
    ReadResult,
    SandboxBackendProtocol,
    WriteResult,
)

from internagent_resources import ResourceConfig, load_resource_config


class DynamicLocalShellBackend(SandboxBackendProtocol):
    """Delegate local shell/filesystem operations to the latest resource workspace."""

    def __init__(
        self,
        *,
        resource_id: str,
        fallback_root: Path,
        inherit_env: bool = True,
        virtual_mode: bool = True,
        timeout: int = 120,
        max_output_bytes: int = 100_000,
        workspace_override: str | None = None,
        read_only_roots: list[Path] | None = None,
    ) -> None:
        self.resource_id = resource_id
        self.fallback_root = fallback_root
        self.inherit_env = inherit_env
        self.virtual_mode = virtual_mode
        self.timeout = timeout
        self.max_output_bytes = max_output_bytes
        self.workspace_override = workspace_override
        self.read_only_roots = [path.resolve() for path in read_only_roots or []]
        self._sandbox_id = f"dynamic-local-{resource_id}-{uuid.uuid4().hex[:8]}"

    @property
    def id(self) -> str:
        return self._sandbox_id

    def _resource(self) -> ResourceConfig | None:
        try:
            _, resources = load_resource_config()
        except Exception:
            return None
        return resources.get(self.resource_id)

    def _resolve_workspace_value(self, workspace: str) -> Path | None:
        path = Path(workspace).expanduser()
        if path == Path("."):
            return self.fallback_root
        if not path.is_absolute():
            path = self.fallback_root / path
        try:
            resolved = path.resolve()
            if resolved.is_dir():
                return resolved
        except OSError:
            return None
        return None

    def _resolve_workspace(self, resource: ResourceConfig | None) -> Path:
        if self.workspace_override:
            override = self._resolve_workspace_value(self.workspace_override)
            if override is not None:
                return override

        if resource is None:
            return self.fallback_root

        configured = self._resolve_workspace_value(resource.workspace)
        return configured or self.fallback_root

    def _backend(self) -> LocalShellBackend:
        resource = self._resource()
        return LocalShellBackend(
            root_dir=self._resolve_workspace(resource),
            inherit_env=self.inherit_env,
            virtual_mode=True,
            timeout=resource.timeout if resource is not None else self.timeout,
            max_output_bytes=(
                resource.max_output_bytes
                if resource is not None
                else self.max_output_bytes
            ),
        )

    def _external_read_backend(self) -> LocalShellBackend:
        return LocalShellBackend(
            root_dir="/",
            inherit_env=self.inherit_env,
            virtual_mode=False,
            timeout=self.timeout,
            max_output_bytes=self.max_output_bytes,
        )

    def _workspace_root(self) -> Path:
        return self._resolve_workspace(self._resource())

    def _read_only_path(self, file_path: str) -> str | None:
        path = Path(file_path).expanduser()
        if not path.is_absolute() or ".." in path.parts:
            return None

        try:
            resolved = path.resolve(strict=False)
        except OSError:
            return None

        for root in self.read_only_roots:
            for candidate in (path, resolved):
                try:
                    candidate.relative_to(root)
                    return str(resolved)
                except ValueError:
                    continue
        return None

    def _normalize_path(self, file_path: str) -> tuple[str | None, str | None]:
        """Normalize host absolute paths into workspace-virtual paths.

        DeepAgents file tools use absolute-looking virtual paths such as
        `/src/app.py`. If a model reuses a real host path from an old workspace,
        do not let it bypass the selected workspace.
        """

        if not file_path:
            return file_path, None

        if "~" in file_path or ".." in Path(file_path).parts:
            return None, "Path traversal is not allowed in the active workspace."

        root = self._workspace_root()
        path = Path(file_path).expanduser()
        if not path.is_absolute():
            return f"/{file_path.lstrip('/')}", None

        try:
            relative = path.resolve(strict=False).relative_to(root)
        except (OSError, ValueError):
            relative = None

        if relative is not None:
            if not relative.parts:
                return "/", None
            return f"/{relative.as_posix()}", None

        host_roots = {
            "Applications",
            "Library",
            "System",
            "Users",
            "Volumes",
            "bin",
            "etc",
            "opt",
            "private",
            "sbin",
            "tmp",
            "usr",
            "var",
        }
        parts = path.parts
        if len(parts) > 1 and parts[1] in host_roots:
            return (
                None,
                (
                    "Path is outside the selected workspace. "
                    f"Use a workspace-relative absolute path under {root}, "
                    "for example '/file.py' or '/subdir/file.py'."
                ),
            )

        return file_path, None

    def ls(self, path: str):
        read_only_path = self._read_only_path(path)
        if read_only_path:
            return self._external_read_backend().ls(read_only_path)

        normalized, error = self._normalize_path(path)
        if error:
            from deepagents.backends.protocol import LsResult

            return LsResult(error=error, entries=[])
        return self._backend().ls(normalized or path)

    def read(self, file_path: str, offset: int = 0, limit: int = 2000):
        read_only_path = self._read_only_path(file_path)
        if read_only_path:
            return self._external_read_backend().read(read_only_path, offset, limit)

        normalized, error = self._normalize_path(file_path)
        if error:
            return ReadResult(error=error)
        return self._backend().read(normalized or file_path, offset, limit)

    def grep(self, pattern: str, path: str | None = None, glob: str | None = None):
        if path is not None:
            read_only_path = self._read_only_path(path)
            if read_only_path:
                return self._external_read_backend().grep(pattern, read_only_path, glob)

            normalized, error = self._normalize_path(path)
            if error:
                from deepagents.backends.protocol import GrepResult

                return GrepResult(error=error, matches=[])
            path = normalized or path
        return self._backend().grep(pattern, path, glob)

    def glob(self, pattern: str, path: str = "/"):
        read_only_path = self._read_only_path(path)
        if read_only_path:
            return self._external_read_backend().glob(pattern, read_only_path)

        normalized, error = self._normalize_path(path)
        if error:
            from deepagents.backends.protocol import GlobResult

            return GlobResult(error=error, matches=[])
        return self._backend().glob(pattern, normalized or path)

    def write(self, file_path: str, content: str):
        normalized, error = self._normalize_path(file_path)
        if error:
            return WriteResult(error=error)
        return self._backend().write(normalized or file_path, content)

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ):
        normalized, error = self._normalize_path(file_path)
        if error:
            return EditResult(error=error)
        return self._backend().edit(
            normalized or file_path,
            old_string,
            new_string,
            replace_all,
        )

    def upload_files(self, files: list[tuple[str, bytes]]):
        normalized_files: list[tuple[str, bytes]] = []
        responses: list[FileUploadResponse] = []
        for file_path, content in files:
            normalized, error = self._normalize_path(file_path)
            if error:
                responses.append(
                    FileUploadResponse(path=file_path, error="invalid_path")
                )
                continue
            normalized_files.append((normalized or file_path, content))
        if normalized_files:
            responses.extend(self._backend().upload_files(normalized_files))
        return responses

    def download_files(self, paths: list[str]):
        normalized_paths: list[str] = []
        responses: list[FileDownloadResponse] = []
        for file_path in paths:
            normalized, error = self._normalize_path(file_path)
            if error:
                responses.append(
                    FileDownloadResponse(
                        path=file_path,
                        content=None,
                        error="invalid_path",
                    )
                )
                continue
            normalized_paths.append(normalized or file_path)
        if normalized_paths:
            responses.extend(self._backend().download_files(normalized_paths))
        return responses

    def execute(self, command: str, *, timeout: int | None = None):
        return self._backend().execute(command, timeout=timeout)


def workspace_override_from_runtime(runtime: Any) -> str | None:
    """Extract the workspace path attached to this run, if present."""

    config = getattr(runtime, "config", None)
    context = getattr(runtime, "context", None)
    candidates: list[Any] = []

    if isinstance(config, dict):
        metadata = config.get("metadata")
        configurable = config.get("configurable")
        if isinstance(metadata, dict):
            candidates.append(metadata.get("internagents_workspace_path"))
        if isinstance(configurable, dict):
            candidates.append(configurable.get("internagents_workspace_path"))

    if isinstance(context, dict):
        candidates.append(context.get("internagents_workspace_path"))

    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


class DynamicLocalShellBackendFactory:
    """Create a per-run backend using workspace metadata when available."""

    def __init__(
        self,
        *,
        resource_id: str,
        fallback_root: Path,
        inherit_env: bool = True,
        virtual_mode: bool = True,
        timeout: int = 120,
        max_output_bytes: int = 100_000,
        read_only_roots: list[Path] | None = None,
    ) -> None:
        self.resource_id = resource_id
        self.fallback_root = fallback_root
        self.inherit_env = inherit_env
        self.virtual_mode = virtual_mode
        self.timeout = timeout
        self.max_output_bytes = max_output_bytes
        self.read_only_roots = read_only_roots or []

    def __call__(self, runtime: Any) -> DynamicLocalShellBackend:
        return DynamicLocalShellBackend(
            resource_id=self.resource_id,
            fallback_root=self.fallback_root,
            inherit_env=self.inherit_env,
            virtual_mode=self.virtual_mode,
            timeout=self.timeout,
            max_output_bytes=self.max_output_bytes,
            workspace_override=workspace_override_from_runtime(runtime),
            read_only_roots=self.read_only_roots,
        )
