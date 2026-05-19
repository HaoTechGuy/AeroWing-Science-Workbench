import { execFile } from "child_process";
import { readFileSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import type { WorkspaceEntry, WorkspacePreviewKind } from "@/app/types/workspace";

const execFileAsync = promisify(execFile);

const DEFAULT_IGNORED_NAMES = new Set([
  ".DS_Store",
  ".git",
  ".internagents",
  ".langgraph_api",
  ".next",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
]);

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".csv",
  ".env.example",
  ".gitignore",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".log",
  ".mjs",
  ".py",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".env.example": "text/plain; charset=utf-8",
  ".gitignore": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".py": "text/x-python; charset=utf-8",
  ".sh": "text/x-shellscript; charset=utf-8",
  ".toml": "application/toml; charset=utf-8",
  ".ts": "text/typescript; charset=utf-8",
  ".tsx": "text/typescript; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".yaml": "application/yaml; charset=utf-8",
  ".yml": "application/yaml; charset=utf-8",
};

export const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024;
const MAX_RAW_FILE_SIZE = 16 * 1024 * 1024;
const REMOTE_WORKSPACE_TIMEOUT_MS = 30_000;
const REMOTE_WORKSPACE_MAX_BUFFER = 32 * 1024 * 1024;

type WorkspaceBackend = "local_shell" | "ssh_shell";

interface ResourceRecord {
  id: string;
  label?: string;
  backend?: WorkspaceBackend;
  workspace?: string;
  ssh_command?: string;
  enabled?: boolean;
  timeout?: number;
  max_output_bytes?: number;
}

interface ResourcesFile {
  default_resource?: string;
  resources?: ResourceRecord[];
}

interface WorkspaceResolvedPath {
  root: string;
  absolutePath: string;
  relativePath: string;
  resource: ResourceRecord;
}

interface WorkspaceFileData {
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  isFile: boolean;
  content?: string;
  tooLarge?: boolean;
  dataBase64?: string;
}

function readResourcesConfig(): ResourcesFile {
  const explicit = process.env.INTERNAGENT_RESOURCES_FILE;
  const configPath = explicit
    ? path.resolve(getWorkspaceRoot(), explicit)
    : path.join(getWorkspaceRoot(), "internagent.resources.json");
  return JSON.parse(readFileSync(configPath, "utf8")) as ResourcesFile;
}

export function getWorkspaceRoot(): string {
  return path.resolve(
    process.env.INTERNAGENTS_WORKSPACE_ROOT ||
      process.env.WORKSPACE_ROOT ||
      path.join(process.cwd(), "..")
  );
}

function enabledResources(): ResourceRecord[] {
  const resources = readResourcesConfig().resources || [];
  return resources.filter((resource) => resource.enabled !== false);
}

export function getWorkspaceResource(resourceId?: string | null): ResourceRecord {
  const resources = enabledResources();
  const defaultResourceId =
    readResourcesConfig().default_resource || resources[0]?.id || "local";
  const selectedId = resourceId || defaultResourceId;
  const resource = resources.find((candidate) => candidate.id === selectedId);
  if (!resource) {
    throw new Error(`Unknown workspace resource: ${selectedId}`);
  }
  return resource;
}

export function isIgnoredEntry(name: string): boolean {
  if (DEFAULT_IGNORED_NAMES.has(name)) {
    return true;
  }

  if (name.startsWith(".env") && name !== ".env.example") {
    return true;
  }

  return false;
}

export function assertReadableFilePath(relativePath: string): void {
  const name = path.basename(relativePath);
  if (name.startsWith(".env") && name !== ".env.example") {
    throw new Error("Refusing to expose environment files.");
  }

  if (/\.(key|pem|p12|pfx)$/i.test(name)) {
    throw new Error("Refusing to expose private key material.");
  }
}

function normalizeRelativePath(relativePath = ""): string {
  const cleanPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleanPath.split("/").some((segment) => segment === "..")) {
    throw new Error("Path is outside the workspace.");
  }
  return cleanPath;
}

export function getFileExtension(filePath: string): string {
  const basename = path.basename(filePath).toLowerCase();
  if (basename === ".env.example" || basename === ".gitignore") {
    return basename;
  }
  return path.extname(filePath).toLowerCase();
}

export async function resolveWorkspacePath(
  relativePath = "",
  resourceId?: string | null
): Promise<WorkspaceResolvedPath> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") !== "local_shell") {
    return resolveRemoteWorkspacePath(resource, relativePath);
  }

  const root = resolveLocalWorkspaceRoot(resource);
  const rootReal = await fs.realpath(root);
  const cleanPath = normalizeRelativePath(relativePath);
  const target = path.resolve(rootReal, cleanPath);
  const targetReal = await fs.realpath(target);

  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error("Path is outside the workspace.");
  }

  return {
    root: rootReal,
    absolutePath: targetReal,
    relativePath: toWorkspacePath(rootReal, targetReal),
    resource,
  };
}

function resolveLocalWorkspaceRoot(resource: ResourceRecord): string {
  const configuredRoot = resource.workspace || ".";
  if (path.isAbsolute(configuredRoot)) {
    return configuredRoot;
  }
  return path.resolve(getWorkspaceRoot(), configuredRoot);
}

function resolveRemoteWorkspacePath(
  resource: ResourceRecord,
  relativePath = ""
): WorkspaceResolvedPath {
  const root = resource.workspace || ".";
  const cleanPath = normalizeRelativePath(relativePath);
  return {
    root,
    absolutePath: cleanPath ? `${root.replace(/\/+$/, "")}/${cleanPath}` : root,
    relativePath: cleanPath,
    resource,
  };
}

export function toWorkspacePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

export function getPreviewKind(filePath: string): WorkspacePreviewKind {
  const extension = getFileExtension(filePath);

  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }

  if (extension === ".pdf") {
    return "pdf";
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }

  return "unsupported";
}

export function getMimeType(filePath: string): string {
  const extension = getFileExtension(filePath);
  return MIME_TYPES[extension] || "application/octet-stream";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function runRemoteWorkspacePython<T>(
  resource: ResourceRecord,
  operation: string,
  relativePath = "",
  extra: Record<string, unknown> = {}
): Promise<T> {
  if (!resource.ssh_command) {
    throw new Error(`Resource ${resource.id} does not define ssh_command.`);
  }

  const payload = JSON.stringify({
    op: operation,
    root: resource.workspace || ".",
    path: normalizeRelativePath(relativePath),
    maxTextFileSize: MAX_TEXT_FILE_SIZE,
    maxRawFileSize: MAX_RAW_FILE_SIZE,
    ignoredNames: Array.from(DEFAULT_IGNORED_NAMES),
    ...extra,
  });
  const command = `${resource.ssh_command} ${shellQuote(
    `python3 -c ${shellQuote(REMOTE_WORKSPACE_SCRIPT)} ${shellQuote(payload)}`
  )}`;

  const { stdout } = await execFileAsync("bash", ["-lc", command], {
    timeout: resource.timeout
      ? resource.timeout * 1000
      : REMOTE_WORKSPACE_TIMEOUT_MS,
    maxBuffer: Math.max(
      resource.max_output_bytes || 0,
      REMOTE_WORKSPACE_MAX_BUFFER
    ),
  });

  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Remote workspace command returned no data.");
  }

  const result = JSON.parse(trimmed) as { ok: boolean; error?: string; data?: T };
  if (!result.ok) {
    throw new Error(result.error || "Remote workspace command failed.");
  }
  return result.data as T;
}

const REMOTE_WORKSPACE_SCRIPT = String.raw`
import base64
import json
import os
import pathlib
import sys

DEFAULT_IGNORED = set(json.loads(sys.argv[1]).get("ignoredNames", []))


def is_ignored(name):
    if name in DEFAULT_IGNORED:
        return True
    return name.startswith(".env") and name != ".env.example"


def safe_resolve(root_value, rel_value):
    root = pathlib.Path(root_value).expanduser().resolve()
    rel = str(rel_value or "").replace("\\", "/").lstrip("/")
    if any(part == ".." for part in rel.split("/")):
        raise ValueError("Path is outside the workspace.")
    target = (root / rel).resolve()
    if target != root:
        target.relative_to(root)
    return root, target, rel


def preview_name(name):
    lower = name.lower()
    if lower in {".env.example", ".gitignore"}:
        return lower
    return pathlib.PurePosixPath(name).suffix.lower()


def entry_payload(root, child):
    stat = child.stat()
    rel = child.relative_to(root).as_posix()
    is_dir = child.is_dir()
    ext = preview_name(child.name)
    return {
        "name": child.name,
        "path": rel,
        "kind": "directory" if is_dir else "file",
        "extension": ext or None,
        "size": None if is_dir else stat.st_size,
        "modifiedAt": __import__("datetime").datetime.fromtimestamp(stat.st_mtime, __import__("datetime").timezone.utc).isoformat(),
        "hasChildren": is_dir,
    }


def list_dir(root, target):
    if not target.is_dir():
        raise ValueError("Selected workspace path is not a directory.")
    entries = []
    for child in target.iterdir():
        if is_ignored(child.name):
            continue
        try:
            entries.append(entry_payload(root, child))
        except OSError:
            continue
    entries.sort(key=lambda item: (0 if item["kind"] == "directory" else 1, item["name"].lower()))
    return entries


def file_data(root, target, rel, max_text, max_raw, raw):
    if not target.is_file():
        raise ValueError("Selected workspace path is not a file.")
    stat = target.stat()
    payload = {
        "path": rel,
        "name": target.name,
        "size": stat.st_size,
        "modifiedAt": __import__("datetime").datetime.fromtimestamp(stat.st_mtime, __import__("datetime").timezone.utc).isoformat(),
        "isFile": True,
    }
    if raw:
        if stat.st_size > max_raw:
            raise ValueError("File is too large to stream from remote workspace.")
        payload["dataBase64"] = base64.b64encode(target.read_bytes()).decode("ascii")
        return payload
    if stat.st_size <= max_text:
        payload["content"] = target.read_text(encoding="utf-8", errors="replace")
    else:
        payload["tooLarge"] = True
    return payload


def main():
    request = json.loads(sys.argv[1])
    root, target, rel = safe_resolve(request.get("root") or ".", request.get("path") or "")
    op = request.get("op")
    if op == "list":
        return {"path": rel, "entries": list_dir(root, target)}
    if op == "file":
        return file_data(root, target, rel, int(request.get("maxTextFileSize") or 0), int(request.get("maxRawFileSize") or 0), False)
    if op == "raw":
        return file_data(root, target, rel, int(request.get("maxTextFileSize") or 0), int(request.get("maxRawFileSize") or 0), True)
    raise ValueError("Unknown workspace operation.")

try:
    print(json.dumps({"ok": True, "data": main()}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
`;

function withPreviewKind(entry: WorkspaceEntry): WorkspaceEntry {
  return {
    ...entry,
    previewKind: entry.kind === "directory" ? undefined : getPreviewKind(entry.path),
  };
}

export async function listWorkspaceEntries(
  relativePath = "",
  resourceId?: string | null
): Promise<WorkspaceEntry[]> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") === "ssh_shell") {
    const payload = await runRemoteWorkspacePython<{
      path: string;
      entries: WorkspaceEntry[];
    }>(resource, "list", relativePath);
    return payload.entries.map(withPreviewKind);
  }

  const { root, absolutePath } = await resolveWorkspacePath(relativePath, resourceId);
  const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((dirent) => !isIgnoredEntry(dirent.name))
      .map(async (dirent) => {
        const entryAbsolutePath = path.join(absolutePath, dirent.name);
        const stats = await fs.stat(entryAbsolutePath);
        const relativeEntryPath = toWorkspacePath(root, entryAbsolutePath);
        const extension = getFileExtension(dirent.name);

        return {
          name: dirent.name,
          path: relativeEntryPath,
          kind: dirent.isDirectory() ? "directory" : "file",
          extension: extension || undefined,
          size: dirent.isDirectory() ? undefined : stats.size,
          modifiedAt: stats.mtime.toISOString(),
          hasChildren: dirent.isDirectory(),
          previewKind: dirent.isDirectory()
            ? undefined
            : getPreviewKind(relativeEntryPath),
        } satisfies WorkspaceEntry;
      })
  );

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

export async function readWorkspaceFileData(
  relativePath: string,
  resourceId?: string | null
): Promise<WorkspaceFileData> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") === "ssh_shell") {
    return runRemoteWorkspacePython<WorkspaceFileData>(
      resource,
      "file",
      relativePath
    );
  }

  const resolved = await resolveWorkspacePath(relativePath, resourceId);
  const stats = await fs.stat(resolved.absolutePath);
  if (!stats.isFile()) {
    throw new Error("Selected workspace path is not a file.");
  }

  const payload: WorkspaceFileData = {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    isFile: true,
  };
  if (stats.size <= MAX_TEXT_FILE_SIZE) {
    payload.content = await fs.readFile(resolved.absolutePath, "utf8");
  } else {
    payload.tooLarge = true;
  }
  return payload;
}

export async function readWorkspaceRawFile(
  relativePath: string,
  resourceId?: string | null
): Promise<WorkspaceFileData & { data: Buffer }> {
  const resource = getWorkspaceResource(resourceId);
  if ((resource.backend || "local_shell") === "ssh_shell") {
    const payload = await runRemoteWorkspacePython<WorkspaceFileData>(
      resource,
      "raw",
      relativePath
    );
    if (!payload.dataBase64) {
      throw new Error("Remote workspace did not return file data.");
    }
    return {
      ...payload,
      data: Buffer.from(payload.dataBase64, "base64"),
    };
  }

  const resolved = await resolveWorkspacePath(relativePath, resourceId);
  const stats = await fs.stat(resolved.absolutePath);
  if (!stats.isFile()) {
    throw new Error("Selected workspace path is not a file.");
  }
  if (stats.size > MAX_RAW_FILE_SIZE) {
    throw new Error("File is too large to stream from workspace.");
  }
  return {
    path: resolved.relativePath,
    name: path.basename(resolved.relativePath),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    isFile: true,
    data: await fs.readFile(resolved.absolutePath),
  };
}
