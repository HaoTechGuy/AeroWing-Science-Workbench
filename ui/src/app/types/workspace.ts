export type WorkspaceEntryKind = "directory" | "file";

export type WorkspacePreviewKind =
  | "markdown"
  | "pdf"
  | "text"
  | "binary"
  | "unsupported";

export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: WorkspaceEntryKind;
  extension?: string;
  size?: number;
  modifiedAt?: string;
  hasChildren?: boolean;
  previewKind?: WorkspacePreviewKind;
}

export interface WorkspaceListResponse {
  path: string;
  entries: WorkspaceEntry[];
}

export interface WorkspaceFileResponse {
  name: string;
  path: string;
  extension?: string;
  size: number;
  modifiedAt: string;
  previewKind: WorkspacePreviewKind;
  mimeType: string;
  content?: string;
  rawUrl?: string;
  tooLarge?: boolean;
}
