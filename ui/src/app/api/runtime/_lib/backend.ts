import { promises as fs } from "fs";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "fs";
import path from "path";
import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { getWorkspaceRoot } from "@/app/api/workspace/_lib/workspace";

const execFileAsync = promisify(execFile);

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

interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  command: string;
}

function backendHost(): string {
  const deploymentUrl = process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL;
  if (!deploymentUrl) {
    return "127.0.0.1";
  }

  try {
    return new URL(deploymentUrl).hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function backendPort(): number {
  if (process.env.INTERNAGENTS_BACKEND_PORT) {
    return Number(process.env.INTERNAGENTS_BACKEND_PORT);
  }

  const deploymentUrl = process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL;
  if (!deploymentUrl) {
    return 2024;
  }

  try {
    const parsed = new URL(deploymentUrl);
    return Number(parsed.port || 2024);
  } catch {
    return 2024;
  }
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pythonBinary(root: string): string {
  const venvPython = path.join(root, ".venv", "bin", "python");
  return isExecutable(venvPython) ? venvPython : "python3";
}

function runtimePaths(root: string) {
  const runtimeDir = path.join(root, ".internagents");
  const logDir = path.join(runtimeDir, "logs");
  const pidDir = path.join(runtimeDir, "pids");

  return {
    runtimeDir,
    logDir,
    pidDir,
    backendLog: path.join(logDir, "backend.log"),
    backendPidFile: path.join(pidDir, "backend.pid"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function urlOk(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function countThreadsByStatus(
  url: string,
  status: "busy" | "interrupted"
): Promise<number> {
  const response = await fetch(`${url}/threads/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: 1,
      offset: 0,
      status,
      select: ["thread_id", "status"],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Unable to query ${status} threads.`);
  }

  const threads = (await response.json()) as unknown[];
  return threads.length;
}

export async function getBackendStatus(): Promise<BackendStatusResult> {
  const host = backendHost();
  const port = backendPort();
  const url = `http://${host}:${port}`;

  if (!(await urlOk(`${url}/ok`))) {
    return {
      status: "unavailable",
      message: "后台健康检查失败，无法判断是否空闲。",
      url,
      busyThreads: 0,
      interruptedThreads: 0,
    };
  }

  try {
    const [busyThreads, interruptedThreads] = await Promise.all([
      countThreadsByStatus(url, "busy"),
      countThreadsByStatus(url, "interrupted"),
    ]);
    const isIdle = busyThreads === 0 && interruptedThreads === 0;

    return {
      status: isIdle ? "idle" : "busy",
      message: isIdle
        ? "后台当前空闲，可以安全应用。"
        : "后台存在运行中或等待审批的会话，暂不自动应用。",
      url,
      busyThreads,
      interruptedThreads,
    };
  } catch (error) {
    return {
      status: "unavailable",
      message:
        error instanceof Error ? error.message : "无法读取后台会话状态。",
      url,
      busyThreads: 0,
      interruptedThreads: 0,
    };
  }
}

async function waitForBackend(url: string, timeoutMs = 60000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await urlOk(`${url}/ok`)) {
      return true;
    }
    await sleep(750);
  }
  return false;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 10000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isAlive(pid)) {
      return true;
    }
    await sleep(250);
  }
  return !isAlive(pid);
}

function readPidFile(pidFile: string): number | null {
  if (!existsSync(pidFile)) {
    return null;
  }

  const raw = readFileSync(pidFile, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function listListeningPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-t",
    ]);
    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  try {
    const { stdout } = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "pid=",
      "-o",
      "ppid=",
      "-o",
      "pgid=",
      "-o",
      "command=",
    ]);
    const line = stdout.trim();
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) {
      return null;
    }

    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      command: match[4],
    };
  } catch {
    return null;
  }
}

async function findBackendProcess(
  port: number,
  pidFile: string
): Promise<ProcessInfo | null> {
  const candidates = new Set<number>();
  const pidFromFile = readPidFile(pidFile);
  if (pidFromFile && isAlive(pidFromFile)) {
    candidates.add(pidFromFile);
  }

  for (const pid of await listListeningPids(port)) {
    candidates.add(pid);
  }

  const inspected = new Set<number>();
  const queue = Array.from(candidates);
  const infos: ProcessInfo[] = [];

  while (queue.length > 0) {
    const pid = queue.shift();
    if (!pid || inspected.has(pid) || pid <= 1) {
      continue;
    }

    inspected.add(pid);
    const info = await getProcessInfo(pid);
    if (!info) {
      continue;
    }

    infos.push(info);
    if (info.ppid > 1 && !inspected.has(info.ppid)) {
      queue.push(info.ppid);
    }
  }

  return (
    infos.find((info) => /langgraph_cli\s+dev/.test(info.command)) ||
    infos.find((info) => info.command.includes("langgraph_cli")) ||
    null
  );
}

async function terminateBackend(info: ProcessInfo): Promise<void> {
  const target = info.pgid > 1 ? -info.pgid : info.pid;
  try {
    process.kill(target, "SIGTERM");
  } catch {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      return;
    }
  }

  if (await waitForProcessExit(info.pid)) {
    return;
  }

  try {
    process.kill(target, "SIGKILL");
  } catch {
    try {
      process.kill(info.pid, "SIGKILL");
    } catch {
      return;
    }
  }

  await waitForProcessExit(info.pid, 5000);
}

async function startBackend(root: string, host: string, port: number) {
  const paths = runtimePaths(root);
  mkdirSync(paths.logDir, { recursive: true });
  mkdirSync(paths.pidDir, { recursive: true });

  const fd = openSync(paths.backendLog, "a");
  const child = spawn(
    pythonBinary(root),
    [
      "-m",
      "langgraph_cli",
      "dev",
      "--host",
      host,
      "--port",
      String(port),
      "--no-browser",
      "--config",
      "langgraph.json",
    ],
    {
      cwd: root,
      detached: true,
      env: process.env,
      stdio: ["ignore", fd, fd],
    }
  );
  child.unref();
  closeSync(fd);

  await fs.writeFile(paths.backendPidFile, `${child.pid}\n`, "utf8");
  return child.pid;
}

export async function restartBackend(): Promise<BackendRestartResult> {
  const root = getWorkspaceRoot();
  const host = backendHost();
  const port = backendPort();
  const url = `http://${host}:${port}`;
  const paths = runtimePaths(root);

  try {
    mkdirSync(paths.logDir, { recursive: true });
    mkdirSync(paths.pidDir, { recursive: true });

    const oldProcess = await findBackendProcess(port, paths.backendPidFile);
    if (oldProcess) {
      await terminateBackend(oldProcess);
    } else if (await urlOk(`${url}/ok`)) {
      return {
        status: "failed",
        message:
          "后台端口已有健康服务，但无法确认它属于 InternAgents，已跳过自动应用。",
        url,
        logPath: paths.backendLog,
      };
    }

    const pid = await startBackend(root, host, port);
    const ready = await waitForBackend(url);

    if (!ready) {
      return {
        status: "failed",
        message: "后台进程已启动，但健康检查超时。请查看 backend.log。",
        url,
        pid,
        oldPid: oldProcess?.pid,
        logPath: paths.backendLog,
      };
    }

    return {
      status: "restarted",
      message: "技能配置已应用。",
      url,
      pid,
      oldPid: oldProcess?.pid,
      logPath: paths.backendLog,
    };
  } catch (error) {
    return {
      status: "failed",
      message:
        error instanceof Error ? error.message : "技能配置自动应用失败。",
      url,
      logPath: paths.backendLog,
    };
  }
}
