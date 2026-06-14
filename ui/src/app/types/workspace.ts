export type WorkspaceEntryKind = "directory" | "file";

export type WorkspacePreviewKind =
  | "docx"
  | "image"
  | "markdown"
  | "pdf"
  | "pptx"
  | "text"
  | "xlsx"
  | "binary"
  | "unsupported";

export type WorkspaceOfficePreviewKind = "docx" | "xlsx" | "pptx";

export interface WorkspaceOfficePreviewBlock {
  title: string;
  lines?: string[];
  rows?: string[][];
  truncated?: boolean;
}

export interface WorkspaceOfficePreview {
  kind: WorkspaceOfficePreviewKind;
  blocks: WorkspaceOfficePreviewBlock[];
  truncated?: boolean;
  error?: string;
  extractionMethod?: string;
  convertedFrom?: string;
  warnings?: string[];
}

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

export interface LocalWorkspace {
  id: string;
  label: string;
  path: string;
  resolvedPath: string;
  resourceId?: string;
  isRemote?: boolean;
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
  officePreview?: WorkspaceOfficePreview;
  rawUrl?: string;
  tooLarge?: boolean;
}
