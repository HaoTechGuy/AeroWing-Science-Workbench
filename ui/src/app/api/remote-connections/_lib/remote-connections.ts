import { execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { createServer } from "net";
import { createReadStream, createWriteStream } from "fs";
import { constants } from "fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "fs/promises";
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
const LEGACY_REMOTE_RUNTIME_PORT = 22024;
const REMOTE_RUNTIME_PORT_START = 22024;
const REMOTE_RUNTIME_PORT_END = 22150;
const REMOTE_INSTALL_ROOT = "~/.internagents/runtimes";
const REMOTE_BACKEND_CLI_ROOT = "~/.internagents/backend-cli";
const LOCAL_REMOTE_PORT_START = 22025;
const LOCAL_REMOTE_PORT_END = 22150;
const REMOTE_SLOT_IDS = Array.from(
  { length: 8 },
  (_, index) => `remote${index + 1}`
);
const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const COMMAND_MAX_BUFFER = 1024 * 1024 * 8;
const BACKEND_CLI_WHEELHOUSE_DIR = "backend-wheelhouse";
const BACKEND_CLI_ARCHIVE_NAME = "internagents-backend-cli.tar.gz";
const BACKEND_CLI_PACKAGE_ENTRIES = [
  ".env.example",
  "agent.py",
  "main.py",
  "internagent_resources.py",
  "ssh_backend.py",
  "dynamic_local_backend.py",
  "kb_sync_middleware.py",
  "mineru_middleware.py",
  "goal_middleware.py",
  "goal_state.py",
  "goal_tools.py",
  "internagents_backend_cli.py",
  "internagent.resources.json",
  "internagent.resources.example.json",
  "langgraph.runtime.json",
  "pyproject.toml",
  "requirements.txt",
  "deepagent.config.json",
  "skills",
];
type LogSink = (message: string) => void;
type RemoteInstallMode = "auto" | "venv" | "pythonPath" | "conda";

interface RemoteInstallOptions {
  installMode: RemoteInstallMode;
  pythonPath?: string;
  condaCommand?: string;
}

interface BackendCliPackage {
  artifactPath: string;
  fingerprint: string;
}

export interface UiResourceConfig {
  id: string;
  label: string;
  assistantId: string;
  runtimeUrl?: string;
  remoteRuntimePort?: number;
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
  installMode?: RemoteInstallMode;
  pythonPath?: string;
  condaCommand?: string;
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

function defaultRemoteRuntimeDir(resourceId: string): string {
  return `${REMOTE_INSTALL_ROOT}/${safeId(resourceId) || "runtime"}`;
}

function defaultRemoteBackendCliDir(fingerprint: string): string {
  return `${REMOTE_BACKEND_CLI_ROOT}/${safeId(fingerprint) || "package"}`;
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
      remoteRuntimePort: resource.remote_runtime_port,
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

function normalizeInstallMode(value: unknown): RemoteInstallMode {
  return value === "venv" || value === "pythonPath" || value === "conda"
    ? value
    : "auto";
}

function normalizeRemoteCommandPath(
  value: unknown,
  label: string
): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return undefined;
  }
  if (/[\r\n]/.test(text)) {
    throw new Error(`${label} 只能填写一行路径或命令。`);
  }
  return text;
}

function normalizeInstallOptions(
  request: RemoteConnectionSetupRequest
): RemoteInstallOptions {
  const installMode = normalizeInstallMode(request.installMode);
  const pythonPath = normalizeRemoteCommandPath(
    request.pythonPath,
    "自定义 Python 路径"
  );
  const condaCommand = normalizeRemoteCommandPath(
    request.condaCommand,
    "Conda/Mamba 命令"
  );

  if (installMode === "pythonPath" && !pythonPath) {
    throw new Error("指定 Python 安装方式需要填写自定义 Python 路径。");
  }

  return {
    installMode,
    pythonPath,
    condaCommand,
  };
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

function configuredRemoteRuntimePort(resource: ResourceRecord): number {
  const port = resource.remote_runtime_port;
  return typeof port === "number" && Number.isInteger(port) && port > 0
    ? port
    : LEGACY_REMOTE_RUNTIME_PORT;
}

async function chooseRemoteRuntimePort(
  sshCommand: string,
  resourceId: string,
  resources: ResourceRecord[],
  log: string[],
  onLog?: LogSink
): Promise<number> {
  const existing = resources.find((resource) => resource.id === resourceId);
  if (existing) {
    const port = configuredRemoteRuntimePort(existing);
    pushLog(log, `复用远端 runtime 端口: ${port}`, onLog);
    return port;
  }

  const reservedPorts = Array.from(
    new Set(
      resources
        .filter(
          (resource) =>
            resource.id !== resourceId &&
            resource.ssh_command?.trim() === sshCommand.trim()
        )
        .map((resource) => configuredRemoteRuntimePort(resource))
    )
  ).sort((a, b) => a - b);

  const script = String.raw`
set -euo pipefail
start=__REMOTE_PORT_START__
end=__REMOTE_PORT_END__
reserved_ports=__RESERVED_PORTS__

if command -v python3 >/dev/null 2>&1; then
  python3 - "$start" "$end" "$reserved_ports" <<'PY'
import socket
import sys

start = int(sys.argv[1])
end = int(sys.argv[2])
reserved = {int(port) for port in sys.argv[3].split() if port}
for port in range(start, end + 1):
    if port in reserved:
        continue
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", port))
    except OSError:
        continue
    finally:
        sock.close()
    print(port)
    break
else:
    raise SystemExit("No free remote runtime port.")
PY
  exit 0
fi

used_ports=""
if command -v ss >/dev/null 2>&1; then
  used_ports="$(ss -ltnH 2>/dev/null | awk '{print $4}' | sed 's/.*://')"
elif command -v netstat >/dev/null 2>&1; then
  used_ports="$(netstat -ltn 2>/dev/null | awk 'NR > 2 {print $4}' | sed 's/.*://')"
fi

for port in $(seq "$start" "$end"); do
  case " $reserved_ports $used_ports " in
    *" $port "*) continue ;;
  esac
  printf '%s\n' "$port"
  exit 0
done
echo "No free remote runtime port." >&2
exit 2
`
    .replace(/__REMOTE_PORT_START__/g, String(REMOTE_RUNTIME_PORT_START))
    .replace(/__REMOTE_PORT_END__/g, String(REMOTE_RUNTIME_PORT_END))
    .replace(/__RESERVED_PORTS__/g, () =>
      shellQuote(reservedPorts.join(" "))
    );

  let result: { stdout: string; stderr: string };
  try {
    result = await runSshCommand(sshCommand, script, 20_000);
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `没有可用的远端 runtime 端口 (${REMOTE_RUNTIME_PORT_START}-${REMOTE_RUNTIME_PORT_END}): ${
        err.stderr || err.stdout || err.message
      }`,
      { cause: error }
    );
  }
  const selected = Number(result.stdout.trim().split(/\r?\n/).pop());
  if (
    !Number.isInteger(selected) ||
    selected < REMOTE_RUNTIME_PORT_START ||
    selected > REMOTE_RUNTIME_PORT_END
  ) {
    throw new Error(
      `远端 runtime 端口选择失败: ${result.stdout || result.stderr}`
    );
  }
  pushLog(log, `选择远端 runtime 端口: ${selected}`, onLog);
  return selected;
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

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function updateHashWithFile(
  hash: ReturnType<typeof createHash>,
  filePath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
}

async function hashDirectoryContents(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(current: string): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        hash.update(`dir:${relativePath}\0`);
        await visit(fullPath);
      } else if (entry.isFile()) {
        hash.update(`file:${relativePath}\0`);
        await updateHashWithFile(hash, fullPath);
        hash.update("\0");
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function copyPackageEntryIfExists(
  root: string,
  stagingDir: string,
  entry: string
): Promise<void> {
  const source = path.join(root, entry);
  if (!(await fileExists(source))) {
    return;
  }
  await mkdir(path.dirname(path.join(stagingDir, entry)), { recursive: true });
  await cp(source, path.join(stagingDir, entry), {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
  });
}

async function resolveBundledBackendWheelhouse(root: string): Promise<string> {
  const bundledWheelhouse = path.join(root, BACKEND_CLI_WHEELHOUSE_DIR);
  if (await fileExists(bundledWheelhouse)) {
    return bundledWheelhouse;
  }

  if (process.env.INTERNAGENTS_DESKTOP !== "1") {
    const localDevWheelhouse = path.join(
      root,
      ".internagents",
      BACKEND_CLI_WHEELHOUSE_DIR
    );
    if (await fileExists(localDevWheelhouse)) {
      return localDevWheelhouse;
    }
  }

  throw new Error(
    "backend CLI 离线依赖包缺失。请使用 desktop 发布包内置的 backend-wheelhouse，或先运行 desktop 打包流程生成它。"
  );
}

async function buildBackendCliPackage(
  log: string[],
  onLog?: LogSink
): Promise<BackendCliPackage> {
  const root = getWorkspaceRoot();
  const prebuiltArchive = path.join(root, BACKEND_CLI_ARCHIVE_NAME);
  if (await fileExists(prebuiltArchive)) {
    pushLog(log, "使用 desktop 内置 backend CLI 包。", onLog);
    return {
      artifactPath: prebuiltArchive,
      fingerprint: (await hashFile(prebuiltArchive)).slice(0, 16),
    };
  }
  if (process.env.INTERNAGENTS_DESKTOP === "1") {
    throw new Error(
      `desktop 发布包缺少内置 backend CLI 包: ${BACKEND_CLI_ARCHIVE_NAME}`
    );
  }

  if (!(await commandExists("tar"))) {
    throw new Error("本机缺少 tar，无法打包 InternAgents backend CLI。");
  }

  const buildId = `${Date.now()}-${process.pid}`;
  const artifactsDir = path.join(root, ".internagents", "artifacts");
  const stagingDir = path.join(
    root,
    ".internagents",
    "backend-cli-build",
    buildId
  );
  const artifactPath = path.join(
    artifactsDir,
    `internagents-backend-cli-${buildId}.tar.gz`
  );

  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });
  for (const entry of BACKEND_CLI_PACKAGE_ENTRIES) {
    await copyPackageEntryIfExists(root, stagingDir, entry);
  }
  await cp(
    await resolveBundledBackendWheelhouse(root),
    path.join(stagingDir, BACKEND_CLI_WHEELHOUSE_DIR),
    {
      recursive: true,
      force: true,
      verbatimSymlinks: false,
    }
  );
  const fingerprint = (await hashDirectoryContents(stagingDir)).slice(0, 16);

  try {
    pushLog(log, "打包独立 InternAgents backend CLI...", onLog);
    await execFileAsync("tar", ["-czf", artifactPath, "-C", stagingDir, "."], {
      timeout: 120_000,
      maxBuffer: COMMAND_MAX_BUFFER,
    });
    return {
      artifactPath,
      fingerprint,
    };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

async function streamFileOverSsh(
  sshCommand: string,
  localPath: string,
  remoteScript: string
): Promise<void> {
  const [sshBinary, ...baseSshArgs] = sshArgsFromCommand(sshCommand, [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
  ]);
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(localPath);
    const ssh = spawn(
      sshBinary,
      [...baseSshArgs, `bash -lc ${shellQuote(remoteScript)}`],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    const errors: string[] = [];
    input.on("error", reject);
    ssh.on("error", reject);
    ssh.stderr.on("data", (chunk) => errors.push(String(chunk)));
    input.pipe(ssh.stdin);
    ssh.on("close", (code) => {
      if ((code ?? 1) === 0) {
        resolve();
      } else {
        reject(new Error(errors.join("\n") || `SSH upload failed: ${code}`));
      }
    });
  });
}

async function readRemoteBackendCliMarker(
  sshCommand: string,
  backendDir: string,
  fingerprint: string
): Promise<string | null> {
  const markerPath = path.posix.join(backendDir, ".internagents-backend-cli.env");
  const script = String.raw`
set -euo pipefail
marker=__MARKER_PATH__
expected_fingerprint=__FINGERPRINT__
if [ ! -f "$marker" ]; then
  exit 0
fi
installed_fingerprint="$(sed -n 's/^fingerprint=//p' "$marker" | head -n 1)"
backend_cli="$(sed -n 's/^backend_cli=//p' "$marker" | head -n 1)"
if [ "$installed_fingerprint" = "$expected_fingerprint" ] && [ -n "$backend_cli" ] && [ -x "$backend_cli" ]; then
  printf '%s\n' "$backend_cli"
fi
`
    .replace(/__MARKER_PATH__/g, () => shellQuote(markerPath))
    .replace(/__FINGERPRINT__/g, () => shellQuote(fingerprint));

  const result = await runSshCommand(sshCommand, script, 15_000);
  const backendCli = result.stdout.trim().split(/\r?\n/).pop()?.trim() || "";
  return backendCli || null;
}

function backendCliInstallScript(
  backendDir: string,
  fingerprint: string,
  installOptions: RemoteInstallOptions
): string {
  const packageDir = path.posix.join(backendDir, "package");
  const markerPath = path.posix.join(backendDir, ".internagents-backend-cli.env");
  return String.raw`
set -euo pipefail
cd __PACKAGE_DIR__
if [ ! -d __WHEELHOUSE_DIR__ ] || ! find __WHEELHOUSE_DIR__ -name '*.whl' -print -quit | grep -q .; then
  echo "backend-wheelhouse is missing from backend CLI package" >&2
  exit 1
fi

install_mode=__INSTALL_MODE__
custom_python=__CUSTOM_PYTHON__
conda_command=__CONDA_COMMAND__
venv_dir=__VENV_DIR__
conda_env_dir=__CONDA_ENV_DIR__
active_python=""
backend_cli=""

fail_python_env() {
  echo "远端缺少可用 Python 环境，请安装 Python 3.11/3.12 + venv，或配置 conda/mamba。" >&2
  exit 1
}

validate_python() {
  "$1" - <<'PY'
import platform
import sys
if sys.version_info[:2] not in {(3, 11), (3, 12)}:
    raise SystemExit("Remote Python must be 3.11 or 3.12 for the bundled backend wheelhouse.")
if platform.machine() not in {"x86_64", "AMD64"}:
    raise SystemExit("Remote machine must be Linux x86_64 for the bundled backend wheelhouse.")
libc_name, libc_version = platform.libc_ver()
if libc_name == "glibc":
    version = tuple(int(part) for part in libc_version.split(".")[:2])
    if version < (2, 28):
        raise SystemExit("Remote glibc must be >= 2.28 for the bundled backend wheelhouse.")
PY
}

try_venv() {
  python_bin="$1"
  label="$2"
  if [ -z "$python_bin" ]; then
    return 1
  fi
  if ! "$python_bin" -c 'import sys' >/dev/null 2>&1; then
    echo "$label 不可用，跳过。"
    return 1
  fi
  if ! validate_python "$python_bin" >/dev/null 2>&1; then
    echo "$label 不符合 Python 版本、架构或 glibc 要求，跳过。"
    return 1
  fi
  rm -rf "$venv_dir"
  if ! "$python_bin" -m venv "$venv_dir"; then
    echo "$label 无法创建 venv，跳过。"
    return 1
  fi
  active_python="$venv_dir/bin/python"
  backend_cli="$venv_dir/bin/internagents-backend"
  validate_python "$active_python"
  echo "检测到 $label，使用 venv 安装。"
  return 0
}

find_conda_command() {
  if [ -n "$conda_command" ]; then
    printf '%s\n' "$conda_command"
    return 0
  fi
  if command -v mamba >/dev/null 2>&1; then
    command -v mamba
    return 0
  fi
  if command -v conda >/dev/null 2>&1; then
    command -v conda
    return 0
  fi
  return 1
}

try_conda() {
  conda_bin="$(find_conda_command)" || return 1
  if ! "$conda_bin" --version >/dev/null 2>&1; then
    echo "Conda/Mamba 命令不可用，跳过。"
    return 1
  fi
  rm -rf "$conda_env_dir"
  if ! "$conda_bin" create -y -p "$conda_env_dir" python=3.12 pip; then
    echo "Conda/Mamba 创建环境失败，跳过。"
    return 1
  fi
  active_python="$conda_env_dir/bin/python"
  backend_cli="$conda_env_dir/bin/internagents-backend"
  validate_python "$active_python"
  echo "venv 不可用，检测到 $(basename "$conda_bin")，使用 conda-env 安装。"
  return 0
}

case "$install_mode" in
  auto)
    if try_venv "python3" "python3 + venv"; then
      :
    elif [ -n "$custom_python" ] && try_venv "$custom_python" "自定义 Python + venv"; then
      :
    elif try_conda; then
      :
    else
      fail_python_env
    fi
    ;;
  venv)
    try_venv "python3" "python3 + venv" || fail_python_env
    ;;
  pythonPath)
    try_venv "$custom_python" "自定义 Python + venv" || fail_python_env
    ;;
  conda)
    try_conda || fail_python_env
    ;;
  *)
    fail_python_env
    ;;
esac

"$active_python" -m pip install --no-index --find-links __WHEELHOUSE_DIR__ --upgrade pip setuptools wheel
"$active_python" -m pip install --no-index --find-links __WHEELHOUSE_DIR__ --no-build-isolation .
{
  printf 'fingerprint=%s\n' __FINGERPRINT__
  printf 'backend_cli=%s\n' "$backend_cli"
  printf 'package_dir=%s\n' __PACKAGE_DIR__
} > __MARKER_PATH__
printf '__BACKEND_CLI__%s\n' "$backend_cli"
`
    .replace(/__PACKAGE_DIR__/g, () => shellQuote(packageDir))
    .replace(/__VENV_DIR__/g, () =>
      shellQuote(path.posix.join(backendDir, ".venv"))
    )
    .replace(/__CONDA_ENV_DIR__/g, () =>
      shellQuote(path.posix.join(backendDir, "conda-env"))
    )
    .replace(/__WHEELHOUSE_DIR__/g, () =>
      shellQuote(path.posix.join(packageDir, BACKEND_CLI_WHEELHOUSE_DIR))
    )
    .replace(/__INSTALL_MODE__/g, () => shellQuote(installOptions.installMode))
    .replace(/__CUSTOM_PYTHON__/g, () =>
      shellQuote(installOptions.pythonPath || "")
    )
    .replace(/__CONDA_COMMAND__/g, () =>
      shellQuote(installOptions.condaCommand || "")
    )
    .replace(/__FINGERPRINT__/g, () => shellQuote(fingerprint))
    .replace(/__MARKER_PATH__/g, () => shellQuote(markerPath));
}

async function ensureBackendCliInstalled(
  sshCommand: string,
  backendDir: string,
  backendPackage: BackendCliPackage,
  installOptions: RemoteInstallOptions,
  log: string[],
  onLog?: LogSink
): Promise<{ packageDir: string; backendCliPath: string }> {
  const packageDir = path.posix.join(backendDir, "package");
  const installed = await readRemoteBackendCliMarker(
    sshCommand,
    backendDir,
    backendPackage.fingerprint
  );
  if (installed) {
    pushLog(
      log,
      `复用已安装 backend CLI: ${backendPackage.fingerprint}`,
      onLog
    );
    return { packageDir, backendCliPath: installed };
  }

  pushLog(log, `安装 backend CLI: ${backendPackage.fingerprint}`, onLog);
  const remoteScript = [
    "set -euo pipefail",
    `rm -rf ${shellQuote(packageDir)}`,
    `mkdir -p ${shellQuote(packageDir)}`,
    `tar -xzf - -C ${shellQuote(packageDir)}`,
  ].join(" && ");
  await streamFileOverSsh(sshCommand, backendPackage.artifactPath, remoteScript);

  const result = await runSshCommand(
    sshCommand,
    backendCliInstallScript(
      backendDir,
      backendPackage.fingerprint,
      installOptions
    ),
    300_000
  );
  let backendCliPath = "";
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith("__BACKEND_CLI__")) {
      backendCliPath = line.slice("__BACKEND_CLI__".length).trim();
    } else if (line.trim()) {
      pushLog(log, line.trim(), onLog);
    }
  }
  if (!backendCliPath) {
    throw new Error("backend CLI 安装完成，但未返回可执行文件路径。");
  }
  return { packageDir, backendCliPath };
}

async function uploadEnvToRemoteState(
  sshCommand: string,
  stateDir: string,
  log: string[],
  onLog?: LogSink
): Promise<void> {
  const envPath = path.join(getWorkspaceRoot(), ".env");
  if (!(await fileExists(envPath))) {
    throw new Error("已选择同步 .env，但本机仓库根目录没有 .env 文件。");
  }
  const remoteEnvPath = path.posix.join(stateDir, ".env");
  pushLog(log, "同步本机 .env 到远端 runtime 状态目录。", onLog);
  await streamFileOverSsh(
    sshCommand,
    envPath,
    `set -e && mkdir -p ${shellQuote(stateDir)} && cat > ${shellQuote(remoteEnvPath)}`
  );
}

function remoteInstallPreflightScript(options: RemoteInstallOptions): string {
  return String.raw`
set -u
install_mode=__INSTALL_MODE__
custom_python=__CUSTOM_PYTHON__
conda_command=__CONDA_COMMAND__

echo "远端安装环境预检..."
echo "安装方式: $install_mode"

check_python() {
  label="$1"
  python_bin="$2"
  if [ -z "$python_bin" ]; then
    return 0
  fi
  if "$python_bin" -c 'import platform, sys; print(f"python={sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro} arch={platform.machine()} libc=%s.%s" % platform.libc_ver())' 2>/dev/null; then
    if "$python_bin" -m venv --help >/dev/null 2>&1; then
      echo "$label venv: 可用"
    else
      echo "$label venv: 不可用"
    fi
  else
    echo "$label: 不可用"
  fi
}

if command -v python3 >/dev/null 2>&1; then
  check_python "python3" "$(command -v python3)"
else
  echo "python3: 未检测到"
fi

if [ -n "$custom_python" ]; then
  check_python "自定义 Python" "$custom_python"
fi

if [ -n "$conda_command" ]; then
  if "$conda_command" --version >/dev/null 2>&1; then
    echo "Conda/Mamba: 使用 $conda_command"
  else
    echo "Conda/Mamba: $conda_command 不可用"
  fi
elif command -v mamba >/dev/null 2>&1; then
  echo "Conda/Mamba: 检测到 $(command -v mamba)"
elif command -v conda >/dev/null 2>&1; then
  echo "Conda/Mamba: 检测到 $(command -v conda)"
else
  echo "Conda/Mamba: 未检测到"
fi
`
    .replace(/__INSTALL_MODE__/g, () => shellQuote(options.installMode))
    .replace(/__CUSTOM_PYTHON__/g, () =>
      shellQuote(options.pythonPath || "")
    )
    .replace(/__CONDA_COMMAND__/g, () =>
      shellQuote(options.condaCommand || "")
    );
}

async function runRemoteInstallPreflight(
  sshCommand: string,
  options: RemoteInstallOptions,
  log: string[],
  onLog?: LogSink
): Promise<void> {
  const result = await runSshCommand(
    sshCommand,
    remoteInstallPreflightScript(options),
    20_000
  );
  for (const line of result.stdout.split(/\r?\n/)) {
    const message = line.trim();
    if (message) {
      pushLog(log, message, onLog);
    }
  }
}

async function startResourceRuntime(
  sshCommand: string,
  packageDir: string,
  backendCliPath: string,
  stateDir: string,
  resource: ResourceRecord,
  remoteRuntimePort: number,
  log: string[],
  onLog?: LogSink
): Promise<void> {
  const workspace = assertRemoteWorkspace(resource.workspace || "");
  const script = String.raw`
set -euo pipefail
mkdir -p __RESOURCE_WORKSPACE__
mkdir -p __STATE_DIR__
__BACKEND_CLI__ runtime stop \
  --install-dir __PACKAGE_DIR__ \
  --state-dir __STATE_DIR__ \
  --resource-id __RESOURCE_ID__ >/dev/null 2>&1 || true
__BACKEND_CLI__ runtime start \
  --install-dir __PACKAGE_DIR__ \
  --state-dir __STATE_DIR__ \
  --resource-id __RESOURCE_ID__ \
  --label __RESOURCE_LABEL__ \
  --workspace __RESOURCE_WORKSPACE__ \
  --host 127.0.0.1 \
  --port __REMOTE_RUNTIME_PORT__
`
    .replace(/__PACKAGE_DIR__/g, () => shellQuote(packageDir))
    .replace(/__STATE_DIR__/g, () => shellQuote(stateDir))
    .replace(/__BACKEND_CLI__/g, () => shellQuote(backendCliPath))
    .replace(/__RESOURCE_WORKSPACE__/g, () => shellQuote(workspace))
    .replace(/__RESOURCE_ID__/g, () => shellQuote(resource.id))
    .replace(/__RESOURCE_LABEL__/g, () =>
      shellQuote(resource.label || resource.id)
    )
    .replace(/__REMOTE_RUNTIME_PORT__/g, String(remoteRuntimePort));

  pushLog(
    log,
    `启动远端 runtime: 127.0.0.1:${remoteRuntimePort}`,
    onLog
  );
  const result = await runSshCommand(sshCommand, script, 90_000);
  pushLog(log, result.stdout.trim() || "远端 runtime 已启动。", onLog);
}

async function ensureRuntimeTunnel(
  sshCommand: string,
  resourceId: string,
  localPort: number,
  remotePort: number,
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
    `${localPort}:127.0.0.1:${remotePort}`,
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
  pushLog(log, `启动本地 tunnel: ${url} -> 127.0.0.1:${remotePort}`, onLog);

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
  const script = String.raw`
set -euo pipefail
raw_path=__REMOTE_PATH__
case "$raw_path" in
  "~")
    expanded="$HOME"
    ;;
  "~/"*)
    expanded="$HOME/\${raw_path#~/}"
    ;;
  /*)
    expanded="$raw_path"
    ;;
  *)
    echo "Remote path must be absolute or start with ~/" >&2
    exit 2
    ;;
esac

if command -v python3 >/dev/null 2>&1; then
  python3 - "$expanded" <<'PY'
from pathlib import Path
import sys
print(Path(sys.argv[1]).resolve(strict=False))
PY
elif readlink -m / >/dev/null 2>&1; then
  readlink -m "$expanded"
else
  printf '%s\n' "$expanded"
fi
`.replace(/__REMOTE_PATH__/g, () => shellQuote(remotePath));
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
  const installOptions = normalizeInstallOptions(request);
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
  const remoteRuntimePort = await chooseRemoteRuntimePort(
    sshCommand,
    resourceId,
    resources,
    log,
    onLog
  );
  const workspace = await resolveRemotePath(
    sshCommand,
    requestedWorkspace,
    "远端工作区路径",
    log,
    onLog
  );
  const backendPackage = await buildBackendCliPackage(log, onLog);
  const backendDir = await resolveRemotePath(
    sshCommand,
    defaultRemoteBackendCliDir(backendPackage.fingerprint),
    "远端 backend CLI 共享安装目录",
    log,
    onLog
  );
  const runtimeDir = await resolveRemotePath(
    sshCommand,
    defaultRemoteRuntimeDir(resourceId),
    "远端 runtime 状态目录",
    log,
    onLog
  );
  await runRemoteInstallPreflight(sshCommand, installOptions, log, onLog);

  const backendInstall = await ensureBackendCliInstalled(
    sshCommand,
    backendDir,
    backendPackage,
    installOptions,
    log,
    onLog
  );
  if (request.copyEnv) {
    await uploadEnvToRemoteState(
      sshCommand,
      runtimeDir,
      log,
      onLog
    );
  }

  const resource: ResourceRecord = {
    id: resourceId,
    label,
    backend: "ssh_shell",
    ssh_command: sshCommand,
    workspace,
    remote_url: `http://127.0.0.1:${localPort}`,
    remote_runtime_port: remoteRuntimePort,
    remote_assistant_id: "agent",
    enabled: true,
  };
  await startResourceRuntime(
    sshCommand,
    backendInstall.packageDir,
    backendInstall.backendCliPath,
    runtimeDir,
    resource,
    remoteRuntimePort,
    log,
    onLog
  );
  const remoteUrl = await ensureRuntimeTunnel(
    sshCommand,
    resourceId,
    localPort,
    remoteRuntimePort,
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
    remoteRuntimePort,
    workspacePath: workspace,
  };
  return {
    resource: uiResource,
    resources: listUiResources(),
    remoteUrl,
    log,
  };
}
