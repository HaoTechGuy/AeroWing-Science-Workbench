export interface SkillEntry {
  key: string;
  name: string;
  description: string;
  sourcePath: string;
  relativePath: string;
  folderName: string;
  enabled: boolean;
}

export interface SkillsConfigResponse {
  enabled: boolean;
  catalogPaths: string[];
  activePath: string;
  selected: string[];
  skills: SkillEntry[];
  message?: string;
  requiresRestart?: boolean;
  restart?: BackendRestartResult;
  backendStatus?: BackendStatusResult;
}

export interface UpdateSkillsRequest {
  enabled: boolean;
  selected: string[];
}

export type SkillImportType = "local" | "cloud";

export interface ImportSkillsRequest {
  type: SkillImportType;
  source: string;
}

export interface ImportSkillsResponse extends SkillsConfigResponse {
  imported: string[];
}

export interface BackendRestartResult {
  status: "restarted" | "failed";
  message: string;
  url: string;
  pid?: number;
  oldPid?: number;
  logPath: string;
}

export interface BackendStatusResult {
  status: "idle" | "busy" | "unavailable";
  message: string;
  url: string;
  busyThreads: number;
  interruptedThreads: number;
}
