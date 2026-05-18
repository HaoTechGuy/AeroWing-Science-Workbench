import { promises as fs } from "fs";
import path from "path";
import type { WorkspaceEntry, WorkspacePreviewKind } from "@/app/types/workspace";

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

export function getWorkspaceRoot(): string {
  return path.resolve(
    process.env.INTERNAGENTS_WORKSPACE_ROOT ||
      process.env.WORKSPACE_ROOT ||
      path.join(process.cwd(), "..")
  );
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

export function getFileExtension(filePath: string): string {
  const basename = path.basename(filePath).toLowerCase();
  if (basename === ".env.example" || basename === ".gitignore") {
    return basename;
  }
  return path.extname(filePath).toLowerCase();
}

export async function resolveWorkspacePath(relativePath = "") {
  const root = getWorkspaceRoot();
  const rootReal = await fs.realpath(root);
  const cleanPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(rootReal, cleanPath);
  const targetReal = await fs.realpath(target);

  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error("Path is outside the workspace.");
  }

  return {
    root: rootReal,
    absolutePath: targetReal,
    relativePath: toWorkspacePath(rootReal, targetReal),
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

export async function listWorkspaceEntries(
  relativePath = ""
): Promise<WorkspaceEntry[]> {
  const { root, absolutePath } = await resolveWorkspacePath(relativePath);
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
