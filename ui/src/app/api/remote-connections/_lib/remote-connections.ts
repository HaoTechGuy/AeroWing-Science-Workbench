import { execFile, spawn } from "child_process";
import { createServer } from "net";
import { createWriteStream } from "fs";
import { constants } from "fs";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  getResourcesConfigPath,
  getWritableResourcesConfig,
  getWorkspaceRoot,
  readWorkspaceResourcesConfig,
  type ResourceRecord,
  writeResourcesConfigAtPath,
} from "@/app/api/workspace/_lib/workspace";

const execFileAsync = promisify(execFile);
const REMOTE_RUNTIME_PORT = 22024;
const REMOTE_INSTALL_ROOT = "~/.internagents/runtimes";
const LOCAL_REMOTE_PORT_START = 22025;
const LOCAL_REMOTE_PORT_END = 22150;
const REMOTE_SLOT_IDS = Array.from(
  { length: 8 },
  (_, index) => `remote${index + 1}`
);
const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const COMMAND_MAX_BUFFER = 1024 * 1024 * 8;
type LogSink = (message: string) => void;

export interface UiResourceConfig {
  id: string;
  label: string;
  assistantId: string;
  runtimeUrl?: string;
  workspacePath?: string;
}

export interface SshHostEntry {
  host: string;
  source: string;
}

export interface RemoteConnectionSetupRequest {
  label: string;
  connectionMode?: "sshConfig" | "sshCommand";
  host?: string;
  sshCommand?: string;
  workspace: string;
  resourceId?: string;
  localPort?: number;
  copyEnv?: boolean;
}

export interface RemoteConnectionSetupResult {
  resource: UiResourceConfig;
  resources: UiResourceConfig[];
  remoteUrl: string;
  log: string[];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function pushLog(log: string[], message: string, onLog?: LogSink): void {
  log.push(message);
  onLog?.(message);
}

function safeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function assertSshConfigHost(value: unknown): string {
  const host = typeof value === "string" ? value.trim() : "";
  if (!host) {
    throw new Error("请选择 SSH config 里的 Host。");
  }
  if (/\s/.test(host)) {
    throw new Error("SSH config Host 不能包含空白字符。");
  }
  return host;
}

function sshCommandForHost(host: string): string {
  return `ssh ${host}`;
}

function splitShellWords(value: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of value.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) {
    throw new Error("SSH 连接指令不能以转义符结尾。");
  }
  if (quote) {
    throw new Error("SSH 连接指令里的引号未闭合。");
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function assertSshCommand(value: unknown): string {
  const command = typeof value === "string" ? value.trim() : "";
  if (!command) {
    throw new Error("请填写 SSH 连接指令。");
  }
  if (/[\r\n]/.test(command)) {
    throw new Error("SSH 连接指令只能是一行命令。");
  }
  const words = splitShellWords(command);
  if (words[0] !== "ssh") {
    throw new Error("SSH 连接指令必须以 ssh 开头。");
  }
  if (words.length < 2) {
    throw new Error(
      "SSH 连接指令需要包含目标主机，例如 ssh user@example.com。"
    );
  }
  const shellOperators = new Set(["|", ";", "&&", "||", ">", ">>", "<", "&"]);
  if (words.some((word) => shellOperators.has(word))) {
    throw new Error("SSH 连接指令不能包含管道、重定向或串联命令。");
  }
  const optionsWithValue = new Set([
    "-B",
    "-b",
    "-c",
    "-D",
    "-E",
    "-e",
    "-F",
    "-I",
    "-i",
    "-J",
    "-L",
    "-l",
    "-m",
    "-O",
    "-o",
    "-p",
    "-Q",
    "-R",
    "-S",
    "-W",
    "-w",
  ]);
  let destinationIndex = -1;
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === "--") {
      destinationIndex = index + 1;
      break;
    }
    if (word.startsWith("-")) {
      if (optionsWithValue.has(word)) {
        index += 1;
      }
      continue;
    }
    destinationIndex = index;
    break;
  }
  if (destinationIndex < 0 || destinationIndex >= words.length) {
    throw new Error(
      "SSH 连接指令需要包含目标主机，例如 ssh user@example.com。"
    );
  }
  if (destinationIndex !== words.length - 1) {
    throw new Error("SSH 连接指令只填写连接部分，不要附加远端命令。");
  }
  return command;
}

function sshArgsFromCommand(
  sshCommand: string,
  extraOptions: string[] = []
): string[] {
  const [binary, ...args] = splitShellWords(assertSshCommand(sshCommand));
  return [binary, ...extraOptions, ...args];
}

async function resolveSshConnection(request: {
  connectionMode?: unknown;
  host?: unknown;
  sshCommand?: unknown;
}): Promise<{ sshCommand: string; displayName: string }> {
  if (
    request.connectionMode === "sshCommand" ||
    (typeof request.sshCommand === "string" && request.sshCommand.trim())
  ) {
    const sshCommand = assertSshCommand(request.sshCommand);
    return { sshCommand, displayName: sshCommand };
  }

  const host = await assertKnownSshHost(request.host);
  return { sshCommand: sshCommandForHost(host), displayName: host };
}

function defaultRemoteInstallDir(resourceId: string): string {
  return `${REMOTE_INSTALL_ROOT}/${safeId(resourceId) || "runtime"}`;
}

async function runSshCommand(
  sshCommand: string,
  script: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  const [binary, ...args] = sshArgsFromCommand(sshCommand, [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
  ]);
  return execFileAsync(binary, [...args, `bash -lc ${shellQuote(script)}`], {
    timeout: timeoutMs,
    maxBuffer: COMMAND_MAX_BUFFER,
  });
}

function isSshConfigPattern(host: string): boolean {
  return host.includes("*") || host.includes("?") || host.includes("!");
}

async function readSshConfigFile(
  filePath: string,
  seen = new Set<string>()
): Promise<SshHostEntry[]> {
  const resolved = filePath.startsWith("~/")
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;
  if (seen.has(resolved)) {
    return [];
  }
  seen.add(resolved);

  let content: string;
  try {
    content = await readFile(resolved, "utf8");
  } catch {
    return [];
  }

  const entries: SshHostEntry[] = [];
  const dir = path.dirname(resolved);
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const [keywordRaw, ...rest] = line.split(/\s+/);
    const keyword = keywordRaw.toLowerCase();
    if (keyword === "host") {
      for (const host of rest) {
        if (host && !isSshConfigPattern(host)) {
          entries.push({ host, source: resolved });
        }
      }
      continue;
    }
    if (keyword === "include") {
      for (const includePath of rest) {
        if (!includePath || includePath.includes("*")) {
          continue;
        }
        const child = path.isAbsolute(includePath)
          ? includePath
          : path.resolve(dir, includePath);
        entries.push(...(await readSshConfigFile(child, seen)));
      }
    }
  }
  return entries;
}

export async function listSshHosts(): Promise<SshHostEntry[]> {
  const entries = await readSshConfigFile(
    path.join(os.homedir(), ".ssh", "config")
  );
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (seen.has(entry.host)) return false;
      seen.add(entry.host);
      return true;
    })
    .sort((a, b) => a.host.localeCompare(b.host));
}

export async function assertKnownSshHost(value: unknown): Promise<string> {
  const host = assertSshConfigHost(value);
  const hosts = await listSshHosts();
  if (!hosts.some((entry) => entry.host === host)) {
    throw new Error(`未在 ~/.ssh/config 中找到 Host: ${host}`);
  }
  return host;
}

export async function testSshConnection(
  request:
    | string
    | { connectionMode?: unknown; host?: unknown; sshCommand?: unknown }
): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
}> {
  const script = [
    "set -e",
    "printf 'user=%s\\n' \"$(id -un)\"",
    "printf 'host=%s\\n' \"$(hostname)\"",
    "printf 'python=%s\\n' \"$(command -v python3 || true)\"",
    "printf 'pwd=%s\\n' \"$(pwd)\"",
  ].join("\n");
  try {
    const connection =
      typeof request === "string"
        ? await resolveSshConnection({ host: request })
        : await resolveSshConnection(request);
    const result = await runSshCommand(connection.sshCommand, script, 15_000);
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: err.stdout || "",
      stderr: err.stderr || err.message,
    };
  }
}

export function assistantIdForResource(resourceId: string): string {
  return `agent_${resourceId}`;
}

export function listUiResources(): UiResourceConfig[] {
  const resources = readWorkspaceResourcesConfig().resources || [];
  return resources
    .filter((resource) => resource.enabled !== false)
    .map((resource) => ({
      id: resource.id,
      label: resource.label || resource.id,
      assistantId: assistantIdForResource(resource.id),
      runtimeUrl: resource.remote_url,
      workspacePath: resource.workspace,
    }));
}

function nextRemoteResourceId(
  resources: ResourceRecord[],
  requested?: string
): string {
  const requestedId = safeId(requested || "");
  if (requestedId && REMOTE_SLOT_IDS.includes(requestedId)) {
    return requestedId;
  }
  const used = new Set(resources.map((resource) => resource.id));
  const freeSlot = REMOTE_SLOT_IDS.find((slot) => !used.has(slot));
  if (!freeSlot) {
    throw new Error("远程资源槽位已用完。当前版本支持 remote1 到 remote8。");
  }
  return freeSlot;
}

function assertRemoteWorkspace(value: unknown): string {
  const workspace = typeof value === "string" ? value.trim() : "";
  if (!workspace) {
    throw new Error("远端工作区路径不能为空。");
  }
  if (!workspace.startsWith("/") && !workspace.startsWith("~/")) {
    throw new Error("远端工作区需要使用绝对路径或 ~/ 开头路径。");
  }
  return workspace;
}

async function portIsAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function chooseLocalPort(requested?: number): Promise<number> {
  if (requested && Number.isInteger(requested) && requested > 0) {
    if (await portIsAvailable(requested)) {
      return requested;
    }
    if (await urlOk(`http://127.0.0.1:${requested}/ok`)) {
      return requested;
    }
    throw new Error(`本地端口 ${requested} 已被占用。`);
  }
  for (
    let port = LOCAL_REMOTE_PORT_START;
    port <= LOCAL_REMOTE_PORT_END;
    port += 1
  ) {
    if (await portIsAvailable(port)) {
      return port;
    }
  }
  throw new Error("没有可用的本地 tunnel 端口。");
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

async function waitForUrl(url: string, timeoutMs = 45_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await urlOk(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("bash", [
      "-lc",
      `command -v ${shellQuote(command)} >/dev/null 2>&1`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function syncSourceToRemote(
  sshCommand: string,
  installDir: string,
  copyEnv: boolean,
  log: string[],
  onLog?: LogSink
): Promise<void> {
  if (!(await commandExists("tar"))) {
    throw new Error("本机缺少 tar，无法同步 InternAgents runtime 代码。");
  }
  const root = getWorkspaceRoot();
  const excludes = [
    ".codex",
    ".git",
    ".venv",
    ".internagents",
    ".langgraph_api",
    ".next",
    ".omx",
    ".pytest_cache",
    "tmp",
    "ui/.next",
    "ui/node_modules",
    "node_modules",
    "internagent.resources.local.json",
  ];
  if (!copyEnv) {
    excludes.push(".env", ".env.*", "ui/.env", "ui/.env.*");
  } else {
    excludes.push("ui/.env", "ui/.env.*");
  }

  const tarArgs = [
    "-czf",
    "-",
    ...excludes.map((item) => `--exclude=${item}`),
    ".",
  ];
  const [sshBinary, ...baseSshArgs] = sshArgsFromCommand(sshCommand, [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
  ]);
  const remoteScript = [
    "set -e",
    `mkdir -p ${shellQuote(installDir)}`,
    `tar -xzf - -C ${shellQuote(installDir)}`,
  ].join(" && ");

  pushLog(
    log,
    `同步当前 InternAgents runtime 到远端安装目录: ${installDir}`,
    onLog
  );
  await new Promise<void>((resolve, reject) => {
    const tar = spawn("tar", tarArgs, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ssh = spawn(
      sshBinary,
      [...baseSshArgs, `bash -lc ${shellQuote(remoteScript)}`],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    const errors: string[] = [];
    tar.stderr.on("data", (chunk) => errors.push(String(chunk)));
    ssh.stderr.on("data", (chunk) => errors.push(String(chunk)));
    tar.stdout.pipe(ssh.stdin);
    tar.on("error", reject);
    ssh.on("error", reject);
    let tarExit: number | null = null;
    let sshExit: number | null = null;
    const done = () => {
      if (tarExit === null || sshExit === null) return;
      if (tarExit === 0 && sshExit === 0) {
        resolve();
      } else {
        reject(
          new Error(
            errors.join("\n") || `代码同步失败 tar=${tarExit} ssh=${sshExit}`
          )
        );
      }
    };
    tar.on("close", (code) => {
      tarExit = code ?? 1;
      done();
    });
    ssh.on("close", (code) => {
      sshExit = code ?? 1;
      done();
    });
  });
}

async function configureRemoteRuntime(
  sshCommand: string,
  installDir: string,
  resource: ResourceRecord,
  log: string[],
  onLog?: LogSink
): Promise<void> {
  const workspace = assertRemoteWorkspace(resource.workspace || "");
  const runtimeConfig = JSON.stringify(
    {
      default_resource: resource.id,
      resources: [
        {
          id: resource.id,
          label: resource.label || resource.id,
          backend: "local_shell",
          workspace,
          remote_url: `http://127.0.0.1:${REMOTE_RUNTIME_PORT}`,
          remote_assistant_id: "agent",
          enabled: true,
        },
      ],
    },
    null,
    2
  );
  const script = String.raw`
set -euo pipefail
cd __INSTALL_DIR__
mkdir -p __RESOURCE_WORKSPACE__
cat > internagent.runtime.local.json <<'JSON'
__RUNTIME_CONFIG__
JSON
python3 - <<'PY'
from pathlib import Path
path = Path('.env')
lines = path.read_text().splitlines() if path.exists() else []
key = 'INTERNAGENT_RESOURCES_FILE'
next_lines = []
seen = False
for line in lines:
    if line.strip().startswith(key + '='):
        next_lines.append(f'{key}="internagent.runtime.local.json"')
        seen = True
    else:
        next_lines.append(line)
if not seen:
    next_lines.append(f'{key}="internagent.runtime.local.json"')
path.write_text('\n'.join(next_lines).rstrip() + '\n')
PY
python3 -m venv .venv
.venv/bin/python -m pip install -U pip setuptools wheel
.venv/bin/python -m pip install -e .
mkdir -p .internagents/logs .internagents/pids
pidfile=.internagents/pids/runtime-__RESOURCE_ID__.pid
logfile=.internagents/logs/runtime-__RESOURCE_ID__.log
if [ -s "$pidfile" ] && kill -0 "$(cat "$pidfile")" >/dev/null 2>&1; then
  echo "runtime already running pid=$(cat "$pidfile")"
else
  nohup env INTERNAGENT_PROCESS_ROLE=runtime INTERNAGENT_RUNTIME_ID=__RESOURCE_ID__ \
    .venv/bin/python -m langgraph_cli dev \
      --host 127.0.0.1 \
      --port __REMOTE_RUNTIME_PORT__ \
      --no-browser \
      --no-reload \
      --config langgraph.runtime.json > "$logfile" 2>&1 &
  echo $! > "$pidfile"
  echo "runtime started pid=$(cat "$pidfile")"
fi
.venv/bin/python - <<'PY'
import sys, time, urllib.request
url = 'http://127.0.0.1:__REMOTE_RUNTIME_PORT__/ok'
for _ in range(60):
    try:
        with urllib.request.urlopen(url, timeout=1) as response:
            if 200 <= response.status < 300:
                print('runtime ok')
                sys.exit(0)
    except Exception:
        time.sleep(1)
print('runtime health check timed out', file=sys.stderr)
sys.exit(1)
PY
`
    .replace(/__INSTALL_DIR__/g, () => shellQuote(installDir))
    .replace(/__RESOURCE_WORKSPACE__/g, () => shellQuote(workspace))
    .replace("__RUNTIME_CONFIG__", () => runtimeConfig)
    .replace(/__RESOURCE_ID__/g, resource.id)
    .replace(/__REMOTE_RUNTIME_PORT__/g, String(REMOTE_RUNTIME_PORT));

  pushLog(
    log,
    "安装远端 Python 依赖并启动 runtime，这一步可能需要几分钟...",
    onLog
  );
  const result = await runSshCommand(sshCommand, script, 180_000);
  pushLog(log, result.stdout.trim() || "远端 runtime 已启动。", onLog);
}

async function ensureRuntimeTunnel(
  sshCommand: string,
  resourceId: string,
  localPort: number,
  log: string[],
  onLog?: LogSink
): Promise<string> {
  const url = `http://127.0.0.1:${localPort}`;
  if (await urlOk(`${url}/ok`)) {
    pushLog(log, `复用已有本地 tunnel: ${url}`, onLog);
    return url;
  }

  const root = getWorkspaceRoot();
  const runtimeDir = path.join(root, ".internagents");
  const logDir = path.join(runtimeDir, "logs");
  const pidDir = path.join(runtimeDir, "pids");
  await mkdir(logDir, { recursive: true });
  await mkdir(pidDir, { recursive: true });
  const pidFile = path.join(pidDir, `remote-tunnel-${resourceId}.pid`);
  try {
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // No previous tunnel to stop.
  }

  const [sshBinary, ...baseSshArgs] = sshArgsFromCommand(sshCommand, [
    "-N",
    "-L",
    `${localPort}:127.0.0.1:${REMOTE_RUNTIME_PORT}`,
  ]);
  const logFile = path.join(logDir, `remote-tunnel-${resourceId}.log`);
  const out = createWriteStream(logFile, { flags: "a" });
  const child = spawn(sshBinary, baseSshArgs, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  child.unref();
  await writeFile(pidFile, `${child.pid}\n`);
  pushLog(log, `启动本地 tunnel: ${url}`, onLog);

  if (!(await waitForUrl(`${url}/ok`))) {
    throw new Error(
      `本地 tunnel 已启动但 runtime 健康检查超时。日志: ${logFile}`
    );
  }
  return url;
}

async function resolveRemotePath(
  sshCommand: string,
  remotePath: string,
  description: string,
  log: string[],
  onLog?: LogSink
): Promise<string> {
  pushLog(log, `解析${description}: ${remotePath}`, onLog);
  const script = [
    "python3 - <<'PY'",
    "from pathlib import Path",
    `print(Path(${JSON.stringify(
      remotePath
    )}).expanduser().resolve(strict=False))`,
    "PY",
  ].join("\n");
  const result = await runSshCommand(sshCommand, script, 15_000);
  const resolved = result.stdout.trim().split(/\r?\n/).pop()?.trim() || "";
  if (!resolved.startsWith("/")) {
    throw new Error(
      `${description}解析失败: ${result.stdout || result.stderr}`
    );
  }
  pushLog(log, `${description}将使用: ${resolved}`, onLog);
  return resolved;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function setupRemoteConnection(
  request: RemoteConnectionSetupRequest,
  onLog?: LogSink
): Promise<RemoteConnectionSetupResult> {
  const label = typeof request.label === "string" ? request.label.trim() : "";
  if (!label) {
    throw new Error("机器名称不能为空。");
  }
  const connection = await resolveSshConnection(request);
  const sshCommand = connection.sshCommand;
  const requestedWorkspace = assertRemoteWorkspace(request.workspace);
  const { configPath, config } = await getWritableResourcesConfig();
  const resources = config.resources || [];
  const resourceId = nextRemoteResourceId(resources, request.resourceId);
  const localPort = await chooseLocalPort(request.localPort);
  const log: string[] = [];

  const test = await testSshConnection(request);
  if (!test.ok) {
    throw new Error(`SSH 连接失败: ${test.stderr || test.stdout}`);
  }
  pushLog(log, `SSH 连接可用: ${connection.displayName}`, onLog);
  const workspace = await resolveRemotePath(
    sshCommand,
    requestedWorkspace,
    "远端工作区路径",
    log,
    onLog
  );
  const installDir = await resolveRemotePath(
    sshCommand,
    defaultRemoteInstallDir(resourceId),
    "远端 runtime 安装目录",
    log,
    onLog
  );

  const envPath = path.join(getWorkspaceRoot(), ".env");
  if (request.copyEnv && !(await fileExists(envPath))) {
    throw new Error("已选择同步 .env，但本机仓库根目录没有 .env 文件。");
  }

  await syncSourceToRemote(
    sshCommand,
    installDir,
    request.copyEnv === true,
    log,
    onLog
  );

  const resource: ResourceRecord = {
    id: resourceId,
    label,
    backend: "ssh_shell",
    ssh_command: sshCommand,
    workspace,
    remote_url: `http://127.0.0.1:${localPort}`,
    remote_assistant_id: "agent",
    enabled: true,
  };
  await configureRemoteRuntime(sshCommand, installDir, resource, log, onLog);
  const remoteUrl = await ensureRuntimeTunnel(
    sshCommand,
    resourceId,
    localPort,
    log,
    onLog
  );

  const nextResources = [
    ...resources.filter((candidate) => candidate.id !== resourceId),
    resource,
  ];
  config.resources = nextResources;
  config.default_resource ||= "local";
  await writeResourcesConfigAtPath(configPath, config);
  pushLog(log, `已写入资源配置: ${getResourcesConfigPath()}`, onLog);

  const uiResource = {
    id: resourceId,
    label,
    assistantId: assistantIdForResource(resourceId),
    runtimeUrl: remoteUrl,
    workspacePath: workspace,
  };
  return {
    resource: uiResource,
    resources: listUiResources(),
    remoteUrl,
    log,
  };
}
