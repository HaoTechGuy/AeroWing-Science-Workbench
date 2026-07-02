export interface WorkspacePathTarget {
  raw: string;
  previewPath: string;
  displayPath: string;
}

export interface WorkspacePathOptions {
  workspaceRoot?: string;
  allowBareFile?: boolean;
}

export type WorkspacePathTextPart =
  | string
  | {
      target: WorkspacePathTarget;
    };

const SPECIAL_FILE_NAMES = new Set([
  ".env.example",
  ".gitignore",
  "agents.md",
  "caddyfile",
  "dockerfile",
  "gemfile",
  "makefile",
  "procfile",
  "rakefile",
  "readme",
  "readme.md",
]);

const COMMON_POSIX_ROOTS = new Set([
  "Applications",
  "Library",
  "System",
  "Users",
  "Volumes",
  "bin",
  "dev",
  "etc",
  "home",
  "opt",
  "private",
  "sbin",
  "tmp",
  "usr",
  "var",
]);

const LEADING_TOKEN_PUNCTUATION = /^[([{（【<"'“‘]+/;
const TRAILING_TOKEN_PUNCTUATION = /[.,;!?，。；、)）\]}> "'”’]+$/;
const LINE_SUFFIX_PATTERN = /^(.*?)(?::\d+(?::\d+)?)$/;
const HASH_LINE_SUFFIX_PATTERN = /^(.*?)(?:#L\d+)$/i;

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function stripLineSuffix(value: string): string {
  const hashMatch = value.match(HASH_LINE_SUFFIX_PATTERN);
  if (hashMatch?.[1]) {
    return hashMatch[1];
  }

  const lineMatch = value.match(LINE_SUFFIX_PATTERN);
  return lineMatch?.[1] || value;
}

function basename(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts[parts.length - 1] || value;
}

function hasFileLikeName(value: string): boolean {
  const name = basename(stripLineSuffix(value)).toLowerCase();
  if (SPECIAL_FILE_NAMES.has(name)) {
    return true;
  }

  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return false;
  }

  const extension = name.slice(dotIndex + 1);
  return /^[a-z0-9][a-z0-9+-]{0,20}$/i.test(extension);
}

function stripFileScheme(value: string): string {
  if (!value.toLowerCase().startsWith("file://")) {
    return value;
  }

  try {
    return normalizeSlashes(new URL(value).pathname);
  } catch {
    return value.replace(/^file:\/+/i, "/");
  }
}

function trimCandidateToken(value: string): {
  leading: string;
  candidate: string;
  trailing: string;
} {
  const leading = value.match(LEADING_TOKEN_PUNCTUATION)?.[0] || "";
  const withoutLeading = value.slice(leading.length);
  const trailing = withoutLeading.match(TRAILING_TOKEN_PUNCTUATION)?.[0] || "";
  const candidate = trailing
    ? withoutLeading.slice(0, -trailing.length)
    : withoutLeading;

  return { leading, candidate, trailing };
}

function firstSegment(value: string): string {
  return value.replace(/^\/+/, "").split("/")[0] || "";
}

function normalizeWorkspaceRoot(value?: string): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeSlashes(value).replace(/\/+$/, "");
  return normalized.startsWith("/") ? normalized : null;
}

function relativeFromWorkspaceRoot(
  candidate: string,
  workspaceRoot?: string
): string | null {
  const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
  if (!normalizedRoot) {
    return null;
  }

  if (candidate === normalizedRoot) {
    return "";
  }

  if (candidate.startsWith(`${normalizedRoot}/`)) {
    return candidate.slice(normalizedRoot.length + 1);
  }

  return null;
}

function looksLikeExternalAbsolutePath(
  candidate: string,
  workspaceRoot?: string
): boolean {
  const segment = firstSegment(candidate);
  const normalizedRoot = normalizeWorkspaceRoot(workspaceRoot);
  const rootSegment = normalizedRoot ? firstSegment(normalizedRoot) : "";

  return (
    (rootSegment && segment === rootSegment) || COMMON_POSIX_ROOTS.has(segment)
  );
}

function isRelativeWorkspacePath(candidate: string): boolean {
  const normalized = candidate.replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("../")) {
    return false;
  }

  return !normalized.split("/").some((segment) => segment === "..");
}

function normalizeRelativeWorkspacePath(candidate: string): string | null {
  const withoutLeadingDot = candidate.replace(/^\.\/+/, "");
  const withoutLeadingSlash = withoutLeadingDot.replace(/^\/+/, "");
  if (!isRelativeWorkspacePath(withoutLeadingSlash)) {
    return null;
  }
  return withoutLeadingSlash || null;
}

function hasPathShape(candidate: string, allowBareFile: boolean): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    return candidate.toLowerCase().startsWith("file://");
  }

  return (
    candidate.startsWith("/") ||
    candidate.startsWith("./") ||
    candidate.includes("/") ||
    (allowBareFile && hasFileLikeName(candidate))
  );
}

export function normalizeWorkspacePreviewPath(
  rawValue: string,
  options: WorkspacePathOptions = {}
): WorkspacePathTarget | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const decoded = normalizeSlashes(
    stripFileScheme(safeDecodeUriComponent(trimmed))
  );
  const candidate = stripLineSuffix(decoded);

  if (
    !candidate ||
    !hasPathShape(candidate, options.allowBareFile ?? false) ||
    !hasFileLikeName(candidate)
  ) {
    return null;
  }

  let previewPath: string | null = null;
  if (candidate.startsWith("/")) {
    previewPath = relativeFromWorkspaceRoot(candidate, options.workspaceRoot);
    if (previewPath === null) {
      if (looksLikeExternalAbsolutePath(candidate, options.workspaceRoot)) {
        return null;
      }
      previewPath = normalizeRelativeWorkspacePath(candidate);
    }
  } else {
    previewPath = normalizeRelativeWorkspacePath(candidate);
  }

  if (!previewPath) {
    return null;
  }

  return {
    raw: rawValue,
    previewPath,
    displayPath: decoded,
  };
}

export function splitTextByWorkspacePaths(
  text: string,
  options: WorkspacePathOptions = {}
): WorkspacePathTextPart[] {
  const parts: WorkspacePathTextPart[] = [];
  const tokenPattern = /\S+/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text)) !== null) {
    const token = match[0];
    const tokenIndex = match.index;
    const { leading, candidate, trailing } = trimCandidateToken(token);
    const target = normalizeWorkspacePreviewPath(candidate, options);

    if (!target) {
      continue;
    }

    if (tokenIndex > lastIndex) {
      parts.push(text.slice(lastIndex, tokenIndex));
    }
    if (leading) {
      parts.push(leading);
    }
    parts.push({ target });
    if (trailing) {
      parts.push(trailing);
    }
    lastIndex = tokenIndex + token.length;
  }

  if (lastIndex === 0) {
    return [text];
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
