import type { WorkspaceEntry, WorkspacePreviewKind } from "@/app/types/workspace";

export const WORKSPACE_FILE_DRAG_MIME =
  "application/x-internagents-workspace-file";

export interface WorkspaceFileDragPayload {
  name: string;
  path: string;
  kind: "file";
  extension?: string;
  size?: number;
  previewKind?: WorkspacePreviewKind;
  resourceId?: string;
  workspaceId?: string;
}

export function createWorkspaceFileDragPayload(
  entry: WorkspaceEntry,
  resourceId?: string,
  workspaceId?: string
): WorkspaceFileDragPayload | null {
  if (entry.kind !== "file") {
    return null;
  }

  return {
    name: entry.name,
    path: entry.path,
    kind: "file",
    extension: entry.extension,
    size: entry.size,
    previewKind: entry.previewKind,
    resourceId,
    workspaceId,
  };
}

export function parseWorkspaceFileDragPayload(
  value: string
): WorkspaceFileDragPayload | null {
  try {
    const payload = JSON.parse(value) as Partial<WorkspaceFileDragPayload>;
    if (
      payload.kind !== "file" ||
      typeof payload.name !== "string" ||
      typeof payload.path !== "string" ||
      !payload.name ||
      !payload.path
    ) {
      return null;
    }

    return {
      name: payload.name,
      path: payload.path,
      kind: "file",
      extension:
        typeof payload.extension === "string" ? payload.extension : undefined,
      size: typeof payload.size === "number" ? payload.size : undefined,
      previewKind: payload.previewKind,
      resourceId:
        typeof payload.resourceId === "string" ? payload.resourceId : undefined,
      workspaceId:
        typeof payload.workspaceId === "string"
          ? payload.workspaceId
          : undefined,
    };
  } catch {
    return null;
  }
}
