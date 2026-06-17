import type { ToolCall } from "@/app/types/types";

export interface GeneratedImageArtifact {
  path: string;
  mimeType?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  size?: string;
  sourceUrl?: string;
}

const IMAGE_TOOL_NAMES = new Set(["generate_image"]);
const WORKSPACE_IMAGE_PATH_PATTERN =
  /\/[^\s`<>"'{}[\](),;]+?\.(?:png|jpe?g|webp|gif|bmp)/gi;
const IMAGE_PATH_END_PATTERN = /\.(?:png|jpe?g|webp|gif|bmp)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseToolResult(result: unknown): unknown {
  if (typeof result !== "string") {
    return result;
  }

  const trimmed = result.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function normalizedWorkspaceImagePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("://") ||
    trimmed.includes("..")
  ) {
    return null;
  }

  const withoutHash = trimmed.split("#", 1)[0];
  const withoutQuery = withoutHash.split("?", 1)[0];
  if (!IMAGE_PATH_END_PATTERN.test(withoutQuery)) {
    return null;
  }

  return withoutQuery;
}

export function isWorkspaceImagePath(value: string): boolean {
  return normalizedWorkspaceImagePath(value) !== null;
}

function addArtifact(
  artifacts: Map<string, GeneratedImageArtifact>,
  path: string,
  metadata: Partial<GeneratedImageArtifact>
) {
  const normalizedPath = normalizedWorkspaceImagePath(path);
  if (!normalizedPath) {
    return;
  }

  artifacts.set(normalizedPath, {
    ...artifacts.get(normalizedPath),
    ...metadata,
    path: normalizedPath,
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataFromRecord(
  value: Record<string, unknown>,
  inherited: Partial<GeneratedImageArtifact>
): Partial<GeneratedImageArtifact> {
  return {
    ...inherited,
    provider: stringValue(value.provider) ?? inherited.provider,
    model: stringValue(value.model) ?? inherited.model,
    prompt: stringValue(value.prompt) ?? inherited.prompt,
    size: stringValue(value.size) ?? inherited.size,
    mimeType:
      stringValue(value.mime_type) ??
      stringValue(value.mimeType) ??
      inherited.mimeType,
    sourceUrl:
      stringValue(value.source_url) ??
      stringValue(value.sourceUrl) ??
      inherited.sourceUrl,
  };
}

function collectArtifacts(
  value: unknown,
  artifacts: Map<string, GeneratedImageArtifact>,
  metadata: Partial<GeneratedImageArtifact> = {}
) {
  if (typeof value === "string") {
    for (const match of value.matchAll(WORKSPACE_IMAGE_PATH_PATTERN)) {
      addArtifact(artifacts, match[0], metadata);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifacts(item, artifacts, metadata);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const nextMetadata = metadataFromRecord(value, metadata);
  const pathCandidates = [
    value.path,
    value.workspacePath,
    value.workspace_path,
    value.filePath,
    value.file_path,
  ];
  for (const candidate of pathCandidates) {
    if (typeof candidate === "string") {
      addArtifact(artifacts, candidate, nextMetadata);
    }
  }

  for (const nested of Object.values(value)) {
    collectArtifacts(nested, artifacts, nextMetadata);
  }
}

export function extractMarkdownWorkspaceImagePaths(content: string): string[] {
  const paths = new Set<string>();
  const markdownImagePattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^)\s]+))/g;

  for (const match of content.matchAll(markdownImagePattern)) {
    const normalizedPath = normalizedWorkspaceImagePath(match[1] || match[2] || "");
    if (normalizedPath) {
      paths.add(normalizedPath);
    }
  }

  return Array.from(paths);
}

export function extractGeneratedImageArtifacts(
  toolCalls: ToolCall[]
): GeneratedImageArtifact[] {
  const artifacts = new Map<string, GeneratedImageArtifact>();

  for (const toolCall of toolCalls) {
    if (
      !IMAGE_TOOL_NAMES.has(toolCall.name) ||
      toolCall.status !== "completed" ||
      !toolCall.result
    ) {
      continue;
    }
    collectArtifacts(parseToolResult(toolCall.result), artifacts);
  }

  return Array.from(artifacts.values());
}

export function hasGeneratedImageArtifacts(toolCalls: ToolCall[]): boolean {
  return extractGeneratedImageArtifacts(toolCalls).length > 0;
}

export function workspaceImageRawUrl(
  path: string,
  resourceId?: string,
  workspaceId?: string
): string {
  const params = new URLSearchParams({ path });
  if (resourceId) {
    params.set("resourceId", resourceId);
  }
  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }
  return `/api/workspace/file/raw?${params.toString()}`;
}
