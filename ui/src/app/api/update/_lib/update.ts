import { execFile } from "child_process";
import { constants } from "fs";
import { promises as fs } from "fs";
import type { FileHandle } from "fs/promises";
import path from "path";
import { promisify } from "util";
import { restartBackend, type BackendRestartResult } from "@/app/api/runtime/_lib/backend";
import { getWorkspaceRoot } from "@/app/api/workspace/_lib/workspace";

const execFileAsync = promisify(execFile);

const RELEASE_OWNER = "shuyuehu";
const RELEASE_REPO = "InternAgents";
const RELEASE_REPO_SLUG = `${RELEASE_OWNER}/${RELEASE_REPO}`;
const RELEASE_GIT_URL = `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}.git`;
const RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_REPO_SLUG}/releases/latest`;
const RELEASE_PAGE_URL = `https://github.com/${RELEASE_REPO_SLUG}/releases/latest`;

const UPDATE_TIMEOUT_MS = 5 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 60 * 1000;
const MAX_BUFFER = 8 * 1024 * 1024;
const MAX_LOG_ENTRIES = 40;
const LOCK_STALE_MS = 30 * 60 * 1000;

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "applying"
  | "applied"
  | "rolling-back"
  | "rolled-back"
  | "failed";

export interface UpdateLogEntry {
  at: string;
  message: string;
}

export interface UpdateVersionInfo {
  version: string;
  exactTag?: string;
  branch?: string;
  commit?: string;
  dirty: boolean;
  dirtyReason?: string;
}

export interface UpdateReleaseInfo {
  tagName: string;
  name: string;
  htmlUrl: string;
  publishedAt?: string;
  notes?: string;
}

export interface UpdateStatus {
  state: UpdateState;
  sourceRepo: string;
  sourceUrl: string;
  current: UpdateVersionInfo;
  latest?: UpdateReleaseInfo;
  updateAvailable: boolean;
  message: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  previous?: {
    checkoutTarget: string;
    commit: string;
    label: string;
  };
  backendRestart?: BackendRestartResult;
  log: UpdateLogEntry[];
}

interface GitCommandOptions {
  timeoutMs?: number;
  allowFailure?: boolean;
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
}

interface GitCommandError extends Error {
  stdout?: string;
  stderr?: string;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  body?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

function updatePaths() {
  const root = getWorkspaceRoot();
  const updateDir = path.join(root, ".internagents", "update");
  return {
    root,
    updateDir,
    statusPath: path.join(updateDir, "status.json"),
    lockPath: path.join(updateDir, "update.lock"),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function trimOutput(value: string, maxLength = 4000) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}...`;
}

function appendLog(status: UpdateStatus, message: string): UpdateStatus {
  return {
    ...status,
    updatedAt: nowIso(),
    log: [
      ...status.log,
      {
        at: nowIso(),
        message,
      },
    ].slice(-MAX_LOG_ENTRIES),
  };
}

async function readStatusFile(): Promise<UpdateStatus | null> {
  const { statusPath } = updatePaths();
  try {
    const content = await fs.readFile(statusPath, "utf8");
    return JSON.parse(content) as UpdateStatus;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeStatusFile(status: UpdateStatus): Promise<UpdateStatus> {
  const { updateDir, statusPath } = updatePaths();
  await fs.mkdir(updateDir, { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  return status;
}

function fallbackStatus(current: UpdateVersionInfo): UpdateStatus {
  return {
    state: "idle",
    sourceRepo: RELEASE_REPO_SLUG,
    sourceUrl: RELEASE_PAGE_URL,
    current,
    updateAvailable: false,
    message: "尚未检查更新。",
    updatedAt: nowIso(),
    log: [],
  };
}

async function runGit(
  args: string[],
  options: GitCommandOptions = {}
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", args, {
      cwd: updatePaths().root,
      timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const commandError = error as GitCommandError;
    if (options.allowFailure) {
      return {
        stdout: commandError.stdout || "",
        stderr: commandError.stderr || commandError.message,
      };
    }
    const stderr = trimOutput(commandError.stderr || commandError.message);
    throw new Error(stderr || `git ${args.join(" ")} failed`, {
      cause: error,
    });
  }
}

async function safeGit(args: string[]): Promise<string | undefined> {
  try {
    const result = await runGit(args);
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeVersion(value: string | undefined) {
  if (!value) {
    return "0.0.0";
  }
  return value.trim().replace(/^v/i, "");
}

function parseSemver(value: string) {
  const normalized = normalizeVersion(value);
  const [main, prerelease = ""] = normalized.split("-", 2);
  const [major = "0", minor = "0", patch = "0"] = main.split(".");
  return {
    major: Number(major) || 0,
    minor: Number(minor) || 0,
    patch: Number(patch) || 0,
    prerelease,
  };
}

function compareVersions(left: string, right: string) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) {
      return a[key] > b[key] ? 1 : -1;
    }
  }
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (!a.prerelease) {
    return 1;
  }
  if (!b.prerelease) {
    return -1;
  }
  return a.prerelease.localeCompare(b.prerelease);
}

function isSafeReleaseTag(tagName: string) {
  return /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tagName);
}

async function readPackageVersion() {
  const { root } = updatePaths();
  const candidates = [
    path.join(root, "pyproject.toml"),
    path.join(root, "ui", "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, "utf8");
      if (candidate.endsWith("package.json")) {
        const parsed = JSON.parse(content) as { version?: unknown };
        if (typeof parsed.version === "string" && parsed.version.trim()) {
          return parsed.version.trim();
        }
      }
      const match = content.match(/^\s*version\s*=\s*["']([^"']+)["']/m);
      if (match?.[1]) {
        return match[1].trim();
      }
    } catch {
      continue;
    }
  }

  return "0.0.0";
}

export async function getCurrentVersionInfo(): Promise<UpdateVersionInfo> {
  const exactTag = await safeGit(["describe", "--tags", "--exact-match"]);
  const branch = await safeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = await safeGit(["rev-parse", "--short", "HEAD"]);
  const version = normalizeVersion(exactTag || (await readPackageVersion()));
  const status = await safeGit(["status", "--porcelain", "--untracked-files=all"]);
  const dirty = Boolean(status?.trim());

  return {
    version,
    exactTag,
    branch,
    commit,
    dirty,
    dirtyReason: dirty ? "当前安装目录有未提交改动，更新前需要清理或提交。" : undefined,
  };
}

async function fetchLatestRelease(): Promise<UpdateReleaseInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "InternAgents-Updater",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub Release 读取失败：HTTP ${response.status}`);
    }

    const payload = (await response.json()) as GitHubReleasePayload;
    const tagName =
      typeof payload.tag_name === "string" ? payload.tag_name.trim() : "";
    if (!tagName || !isSafeReleaseTag(tagName)) {
      throw new Error("最新 release tag 不是受支持的 vX.Y.Z 格式。");
    }

    return {
      tagName,
      name:
        typeof payload.name === "string" && payload.name.trim()
          ? payload.name.trim()
          : tagName,
      htmlUrl:
        typeof payload.html_url === "string" && payload.html_url.trim()
          ? payload.html_url.trim()
          : RELEASE_PAGE_URL,
      publishedAt:
        typeof payload.published_at === "string"
          ? payload.published_at
          : undefined,
      notes: typeof payload.body === "string" ? payload.body : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildStatusWithRelease(
  current: UpdateVersionInfo,
  latest: UpdateReleaseInfo,
  previous?: UpdateStatus | null
): UpdateStatus {
  const updateAvailable =
    compareVersions(latest.tagName, current.exactTag || current.version) > 0;
  return {
    ...(previous || fallbackStatus(current)),
    state: updateAvailable ? "available" : "up-to-date",
    sourceRepo: RELEASE_REPO_SLUG,
    sourceUrl: RELEASE_PAGE_URL,
    current,
    latest,
    updateAvailable,
    message: updateAvailable
      ? `发现新版本 ${latest.tagName}。`
      : `当前已是最新版本 ${current.exactTag || `v${current.version}`}。`,
    updatedAt: nowIso(),
  };
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const current = await getCurrentVersionInfo();
  const saved = await readStatusFile();
  if (!saved) {
    return fallbackStatus(current);
  }

  return {
    ...saved,
    sourceRepo: RELEASE_REPO_SLUG,
    sourceUrl: RELEASE_PAGE_URL,
    current,
    updateAvailable:
      saved.latest !== undefined &&
      compareVersions(saved.latest.tagName, current.exactTag || current.version) > 0,
    updatedAt: nowIso(),
  };
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  const current = await getCurrentVersionInfo();
  let status = appendLog(
    {
      ...(await getUpdateStatus()),
      state: "checking",
      current,
      message: "正在检查 GitHub Release。",
      updateAvailable: false,
    },
    `检查 ${RELEASE_REPO_SLUG} 最新 release。`
  );
  await writeStatusFile(status);

  try {
    const latest = await fetchLatestRelease();
    status = buildStatusWithRelease(current, latest, status);
    status = appendLog(status, status.message);
    return writeStatusFile(status);
  } catch (error) {
    status = appendLog(
      {
        ...status,
        state: "failed",
        message: error instanceof Error ? error.message : "检查更新失败。",
        updateAvailable: false,
        completedAt: nowIso(),
      },
      "检查更新失败。"
    );
    return writeStatusFile(status);
  }
}

async function acquireLock() {
  const { updateDir, lockPath } = updatePaths();
  await fs.mkdir(updateDir, { recursive: true });

  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
      await fs.unlink(lockPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
    );
    await handle.writeFile(`${process.pid}\n${nowIso()}\n`);
    return async () => {
      await handle?.close();
      await fs.unlink(lockPath).catch(() => undefined);
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("已有更新任务正在运行。", { cause: error });
    }
    throw error;
  }
}

async function ensureCleanWorktree() {
  const status = await safeGit(["status", "--porcelain", "--untracked-files=all"]);
  if (status?.trim()) {
    throw new Error("当前安装目录有未提交改动，已拒绝更新。请先提交、清理或重新安装 release 版本。");
  }
}

async function ensureGitRepository() {
  const insideWorktree = await safeGit(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorktree !== "true") {
    throw new Error("一键更新需要当前安装目录是 Git clone；zip 解压安装暂不支持自动切换 release。");
  }
}

async function currentCheckoutTarget() {
  const branch = await safeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = await safeGit(["rev-parse", "--short", "HEAD"]);
  if (branch && branch !== "HEAD") {
    return {
      checkoutTarget: branch,
      commit: commit || branch,
      label: branch,
    };
  }
  return {
    checkoutTarget: commit || "HEAD",
    commit: commit || "HEAD",
    label: commit || "HEAD",
  };
}

async function fetchReleaseTag(tagName: string) {
  await runGit(
    [
      "fetch",
      "--force",
      "--tags",
      RELEASE_GIT_URL,
      `refs/tags/${tagName}:refs/tags/${tagName}`,
    ],
    { timeoutMs: UPDATE_TIMEOUT_MS }
  );
}

export async function applyUpdate({
  restartLocalBackend = true,
}: {
  restartLocalBackend?: boolean;
} = {}): Promise<UpdateStatus> {
  const releaseCheck = await checkForUpdate();
  const latest = releaseCheck.latest;
  if (!latest) {
    return releaseCheck;
  }

  if (!releaseCheck.updateAvailable) {
    return releaseCheck;
  }

  const releaseLock = await acquireLock();
  let status = releaseCheck;

  try {
    await ensureGitRepository();
    await ensureCleanWorktree();
    const previous = await currentCheckoutTarget();
    status = appendLog(
      {
        ...status,
        state: "applying",
        startedAt: nowIso(),
        completedAt: undefined,
        previous,
        message: `正在更新到 ${latest.tagName}。`,
      },
      `开始更新到 ${latest.tagName}。`
    );
    await writeStatusFile(status);

    await fetchReleaseTag(latest.tagName);
    status = appendLog(status, `已拉取 ${RELEASE_REPO_SLUG} 的 ${latest.tagName}。`);
    await writeStatusFile(status);

    await runGit(["checkout", "--detach", latest.tagName], {
      timeoutMs: UPDATE_TIMEOUT_MS,
    });
    status = appendLog(status, `已切换到 ${latest.tagName}。`);
    await writeStatusFile(status);

    let backendRestart: BackendRestartResult | undefined;
    if (restartLocalBackend) {
      backendRestart = await restartBackend();
      status = appendLog(
        {
          ...status,
          backendRestart,
        },
        backendRestart.status === "restarted"
          ? "本机后台已重启。"
          : `本机后台重启失败：${backendRestart.message}`
      );
      await writeStatusFile(status);
    }

    const current = await getCurrentVersionInfo();
    status = appendLog(
      {
        ...status,
        state: backendRestart?.status === "failed" ? "failed" : "applied",
        current,
        updateAvailable: false,
        message:
          backendRestart?.status === "failed"
            ? `已切换到 ${latest.tagName}，但后台重启失败。`
            : `已更新到 ${latest.tagName}。`,
        completedAt: nowIso(),
      },
      backendRestart?.status === "failed" ? "更新后检查到后台重启失败。" : "更新完成。"
    );
    return writeStatusFile(status);
  } catch (error) {
    status = appendLog(
      {
        ...status,
        state: "failed",
        message: error instanceof Error ? error.message : "更新失败。",
        completedAt: nowIso(),
      },
      "更新失败。"
    );
    return writeStatusFile(status);
  } finally {
    await releaseLock();
  }
}

export async function rollbackUpdate({
  restartLocalBackend = true,
}: {
  restartLocalBackend?: boolean;
} = {}): Promise<UpdateStatus> {
  const releaseLock = await acquireLock();
  let status = await getUpdateStatus();

  try {
    if (!status.previous) {
      throw new Error("没有可回滚的上一版本记录。");
    }
    const previous = status.previous;
    await ensureGitRepository();
    await ensureCleanWorktree();

    status = appendLog(
      {
        ...status,
        state: "rolling-back",
        startedAt: nowIso(),
        completedAt: undefined,
        message: `正在回滚到 ${previous.label}。`,
      },
      `开始回滚到 ${previous.label}。`
    );
    await writeStatusFile(status);

    await runGit(["checkout", previous.checkoutTarget], {
      timeoutMs: UPDATE_TIMEOUT_MS,
    });

    let backendRestart: BackendRestartResult | undefined;
    if (restartLocalBackend) {
      backendRestart = await restartBackend();
      status = appendLog(
        {
          ...status,
          backendRestart,
        },
        backendRestart.status === "restarted"
          ? "本机后台已重启。"
          : `本机后台重启失败：${backendRestart.message}`
      );
      await writeStatusFile(status);
    }

    const current = await getCurrentVersionInfo();
    status = appendLog(
      {
        ...status,
        state: backendRestart?.status === "failed" ? "failed" : "rolled-back",
        current,
        updateAvailable:
          status.latest !== undefined &&
          compareVersions(status.latest.tagName, current.exactTag || current.version) > 0,
        message:
          backendRestart?.status === "failed"
            ? "已切换到上一版本，但后台重启失败。"
            : `已回滚到 ${previous.label}。`,
        completedAt: nowIso(),
      },
      backendRestart?.status === "failed" ? "回滚后检查到后台重启失败。" : "回滚完成。"
    );
    return writeStatusFile(status);
  } catch (error) {
    status = appendLog(
      {
        ...status,
        state: "failed",
        message: error instanceof Error ? error.message : "回滚失败。",
        completedAt: nowIso(),
      },
      "回滚失败。"
    );
    return writeStatusFile(status);
  } finally {
    await releaseLock();
  }
}
