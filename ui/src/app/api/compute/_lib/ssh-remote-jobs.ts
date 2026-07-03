import { execFile, spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import {
  assertSshCommand,
  sshArgsFromCommand as baseSshArgsFromCommand,
} from "@/lib/ssh-command";
import { getWorkspaceRoot } from "../../workspace/_lib/workspace";
import { assertKnownSshHost } from "../../remote-connections/_lib/remote-connections";

const execFileAsync = promisify(execFile);

const SSH_CONNECT_TIMEOUT_SECONDS = 8;
const COMMAND_MAX_BUFFER = 1024 * 1024 * 16;
const DEFAULT_SCRATCH_ROOT = "~/.internagents/remote-jobs";
const DEFAULT_JOB_TIMEOUT_SECONDS = 30 * 60;
const MAX_COMMAND_LENGTH = 20_000;
const MAX_INPUT_FILES = 16;
const MAX_INPUT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OUTPUT_GLOBS = 20;
const MAX_OUTPUT_FILES = 64;
const MAX_OUTPUT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_FILE_BYTES = 5 * 1024 * 1024;
const STATE_DIR = path.join(getWorkspaceRoot(), ".internagents", "compute");
const HOSTS_FILE = path.join(STATE_DIR, "ssh-hosts.json");
const JOBS_FILE = path.join(STATE_DIR, "remote-jobs.json");
let storeWriteQueue: Promise<void> = Promise.resolve();

export type RemoteJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timeout"
  | "unknown";

export interface SshComputeHost {
  id: string;
  label: string;
  hostAlias?: string;
  sshCommand: string;
  scratchRoot: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  probe?: SshComputeProbe;
}

export interface SshComputeProbe {
  ok: boolean;
  checkedAt: string;
  os?: string;
  kernel?: string;
  arch?: string;
  user?: string;
  host?: string;
  python?: string;
  bash?: string;
  timeout?: string;
  workdir?: string;
  error?: string;
}

export interface RemoteJobRecord {
  id: string;
  hostId: string;
  command: string;
  remoteJobDir: string;
  pid?: number;
  status: RemoteJobStatus;
  submittedAt: string;
  updatedAt: string;
  finishedAt?: string;
  timeoutSeconds: number;
  outputGlobs: string[];
  maxOutputFileBytes: number;
}

export interface RemoteJobInputFile {
  path: string;
  contentBase64: string;
}

export interface SubmitRemoteJobRequest {
  hostId: string;
  command: string;
  inputs?: RemoteJobInputFile[];
  outputGlobs?: string[];
  timeoutSeconds?: number;
  maxOutputFileBytes?: number;
}

export interface HarvestedOutputFile {
  path: string;
  size: number;
  contentBase64?: string;
  leftOnRemote?: boolean;
}

export interface RemoteJobSnapshot extends RemoteJobRecord {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  outputs?: HarvestedOutputFile[];
}

interface HostsStore {
  hosts: SshComputeHost[];
}

interface JobsStore {
  jobs: RemoteJobRecord[];
}

interface RemoteStatusPayload {
  status: RemoteJobStatus;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  stdout?: string;
  stderr?: string;
  outputs?: HarvestedOutputFile[];
}

function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  ensureStateDir();
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${JSON.stringify(fallback, null, 2)}\n`);
    return fallback;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function writeJsonFile<T>(filePath: string, value: T) {
  ensureStateDir();
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tempPath, filePath);
}

function readHostsStore(): HostsStore {
  return readJsonFile<HostsStore>(HOSTS_FILE, { hosts: [] });
}

async function writeHostsStore(store: HostsStore) {
  await writeJsonFile(HOSTS_FILE, store);
}

function readJobsStore(): JobsStore {
  return readJsonFile<JobsStore>(JOBS_FILE, { jobs: [] });
}

async function writeJobsStore(store: JobsStore) {
  await writeJsonFile(JOBS_FILE, store);
}

async function withStoreWrite<T>(operation: () => Promise<T> | T): Promise<T> {
  const previous = storeWriteQueue;
  let release!: () => void;
  storeWriteQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function sshArgsFromCommand(sshCommand: string): string[] {
  return baseSshArgsFromCommand(sshCommand, [
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
  ]);
}

function hostIdFromLabel(label: string): string {
  const clean = label
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || `host-${randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertSafeRelativePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    throw new Error("Input/output path cannot be empty.");
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalized.startsWith("~") ||
    normalized.split("/").some((part) => !part || part === "..")
  ) {
    throw new Error(`Unsafe relative path: ${raw}`);
  }
  return normalized;
}

function normalizeTimeoutSeconds(value: unknown): number {
  if (value == null) {
    return DEFAULT_JOB_TIMEOUT_SECONDS;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 24 * 60 * 60) {
    throw new Error("timeoutSeconds must be an integer between 1 and 86400.");
  }
  return parsed;
}

function normalizeMaxOutputFileBytes(value: unknown): number {
  if (value == null) {
    return DEFAULT_MAX_OUTPUT_FILE_BYTES;
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_OUTPUT_FILE_BYTES
  ) {
    throw new Error(
      `maxOutputFileBytes must be an integer between 1 and ${MAX_OUTPUT_FILE_BYTES}.`
    );
  }
  return parsed;
}

function normalizeOutputGlobs(value: unknown): string[] {
  if (value == null) {
    return ["out/**", "*.txt", "*.json", "*.csv", "*.png", "*.pdf", "*.md"];
  }
  if (!Array.isArray(value)) {
    throw new Error("outputGlobs must be an array.");
  }
  if (value.length > MAX_OUTPUT_GLOBS) {
    throw new Error(`outputGlobs cannot include more than ${MAX_OUTPUT_GLOBS} patterns.`);
  }
  return value.map((item) => assertSafeRelativePath(item));
}

function normalizeInputs(value: unknown): RemoteJobInputFile[] {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("inputs must be an array.");
  }
  if (value.length > MAX_INPUT_FILES) {
    throw new Error(`inputs cannot include more than ${MAX_INPUT_FILES} files.`);
  }
  let totalBytes = 0;
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("Each input must be an object.");
    }
    const record = item as Record<string, unknown>;
    const contentBase64 =
      typeof record.contentBase64 === "string" ? record.contentBase64 : "";
    if (!contentBase64) {
      throw new Error("Each input must include contentBase64.");
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw new Error("Each input contentBase64 must be valid base64 text.");
    }
    const byteLength = Buffer.byteLength(contentBase64, "base64");
    if (byteLength > MAX_INPUT_FILE_BYTES) {
      throw new Error(`Each input file must be at most ${MAX_INPUT_FILE_BYTES} bytes.`);
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
      throw new Error(`Total input files must be at most ${MAX_TOTAL_INPUT_BYTES} bytes.`);
    }
    return {
      path: assertSafeRelativePath(record.path),
      contentBase64,
    };
  });
}

async function runSshCommand(
  sshCommand: string,
  script: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  const [binary, ...args] = sshArgsFromCommand(sshCommand);
  return execFileAsync(binary, [...args, `bash -lc ${shellQuote(script)}`], {
    timeout: timeoutMs,
    maxBuffer: COMMAND_MAX_BUFFER,
    windowsHide: true,
  });
}

function runRemotePythonWithInput<T>(
  sshCommand: string,
  source: string,
  payload: unknown,
  timeoutMs: number
): Promise<T> {
  const [binary, ...args] = sshArgsFromCommand(sshCommand);
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [...args, `python3 -c ${shellQuote(source)}`], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`SSH Python command timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > COMMAND_MAX_BUFFER && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGTERM");
        reject(new Error("SSH Python stdout exceeded the local output limit."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > COMMAND_MAX_BUFFER && !settled) {
        settled = true;
        clearTimeout(timeout);
        child.kill("SIGTERM");
        reject(new Error("SSH Python stderr exceeded the local output limit."));
        return;
      }
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const out = Buffer.concat(stdout).toString("utf8").trim();
      const err = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(err || `Remote Python exited ${code}.`));
        return;
      }
      try {
        const parsed = JSON.parse(out) as { ok: boolean; error?: string; data: T };
        if (!parsed.ok) {
          reject(new Error(parsed.error || "Remote Python command failed."));
          return;
        }
        resolve(parsed.data);
      } catch (error) {
        reject(
          new Error(
            `Invalid remote JSON: ${
              error instanceof Error ? error.message : String(error)
            }: ${out.slice(0, 1000)}`
          )
        );
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export async function listSshComputeHosts(): Promise<SshComputeHost[]> {
  return readHostsStore().hosts;
}

export async function probeSshComputeHost(
  sshCommand: string
): Promise<SshComputeProbe> {
  const checkedAt = nowIso();
  const script = [
    "set -e",
    "printf 'os=%s\\n' \"$(uname -s)\"",
    "printf 'kernel=%s\\n' \"$(uname -r)\"",
    "printf 'arch=%s\\n' \"$(uname -m)\"",
    "printf 'user=%s\\n' \"$(id -un)\"",
    "printf 'host=%s\\n' \"$(hostname)\"",
    "printf 'python=%s\\n' \"$(command -v python3 || true)\"",
    "printf 'bash=%s\\n' \"$(command -v bash || true)\"",
    "printf 'timeout=%s\\n' \"$(command -v timeout || true)\"",
    "printf 'workdir=%s\\n' \"$(pwd)\"",
  ].join("\n");

  try {
    const result = await runSshCommand(assertSshCommand(sshCommand), script, 15_000);
    const values = Object.fromEntries(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.split("=", 2))
        .filter(([key, value]) => key && value != null)
    );
    if (values.os !== "Linux") {
      return {
        ok: false,
        checkedAt,
        os: values.os,
        error: `Only Linux SSH compute hosts are supported; got ${values.os || "unknown"}.`,
      };
    }
    if (!values.python || !values.bash || !values.timeout) {
      return {
        ok: false,
        checkedAt,
        ...values,
        error: "Linux host must have python3, bash, and timeout.",
      };
    }
    return {
      ok: true,
      checkedAt,
      os: values.os,
      kernel: values.kernel,
      arch: values.arch,
      user: values.user,
      host: values.host,
      python: values.python,
      bash: values.bash,
      timeout: values.timeout,
      workdir: values.workdir,
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function upsertSshComputeHost(request: {
  id?: unknown;
  label?: unknown;
  host?: unknown;
  sshCommand?: unknown;
  scratchRoot?: unknown;
  notes?: unknown;
}): Promise<SshComputeHost> {
  if (typeof request.sshCommand === "string" && request.sshCommand.trim()) {
    throw new Error("SSH compute hosts must use a Host alias from ~/.ssh/config.");
  }
  const hostAlias = await assertKnownSshHost(request.host);
  const sshCommand = assertSshCommand(`ssh ${hostAlias}`);
  const label =
    typeof request.label === "string" && request.label.trim()
      ? request.label.trim()
      : hostAlias;
  const id =
    typeof request.id === "string" && request.id.trim()
      ? hostIdFromLabel(request.id)
      : hostIdFromLabel(hostAlias);
  const scratchRoot =
    typeof request.scratchRoot === "string" && request.scratchRoot.trim()
      ? request.scratchRoot.trim()
      : DEFAULT_SCRATCH_ROOT;
  if (!scratchRoot.startsWith("/") && !scratchRoot.startsWith("~/")) {
    throw new Error("scratchRoot must be absolute or start with ~/.");
  }

  const probe = await probeSshComputeHost(sshCommand);
  if (!probe.ok) {
    throw new Error(probe.error || "SSH compute host probe failed.");
  }

  const existing = readHostsStore().hosts.find((host) => host.id === id);
  const now = nowIso();
  const next: SshComputeHost = {
    id,
    label,
    hostAlias,
    sshCommand,
    scratchRoot,
    notes:
      typeof request.notes === "string" && request.notes.trim()
        ? request.notes.trim()
        : existing?.notes,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    probe,
  };
  await withStoreWrite(async () => {
    const store = readHostsStore();
    store.hosts = [next, ...store.hosts.filter((host) => host.id !== id)];
    await writeHostsStore(store);
  });
  return next;
}

function getHostOrThrow(hostId: string): SshComputeHost {
  const host = readHostsStore().hosts.find((candidate) => candidate.id === hostId);
  if (!host) {
    throw new Error(`Unknown SSH compute host: ${hostId}`);
  }
  return host;
}

export async function submitLinuxSshJob(
  request: SubmitRemoteJobRequest
): Promise<RemoteJobRecord> {
  const hostId = typeof request.hostId === "string" ? request.hostId.trim() : "";
  if (!hostId) {
    throw new Error("hostId is required.");
  }
  const host = getHostOrThrow(hostId);
  const command = typeof request.command === "string" ? request.command.trim() : "";
  if (!command) {
    throw new Error("command is required.");
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`command must be at most ${MAX_COMMAND_LENGTH} characters.`);
  }
  const timeoutSeconds = normalizeTimeoutSeconds(request.timeoutSeconds);
  const maxOutputFileBytes = normalizeMaxOutputFileBytes(request.maxOutputFileBytes);
  const outputGlobs = normalizeOutputGlobs(request.outputGlobs);
  const inputs = normalizeInputs(request.inputs);
  const jobId = `job_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

  const submitPayload = {
    scratchRoot: host.scratchRoot,
    jobId,
    command,
    timeoutSeconds,
    inputs,
    maxOutputFiles: MAX_OUTPUT_FILES,
    maxTotalOutputBytes: MAX_TOTAL_OUTPUT_BYTES,
  };
  const data = await runRemotePythonWithInput<{
    remoteJobDir: string;
    pid: number;
  }>(host.sshCommand, REMOTE_SUBMIT_SCRIPT, submitPayload, 20_000);

  const now = nowIso();
  const record: RemoteJobRecord = {
    id: jobId,
    hostId,
    command,
    remoteJobDir: data.remoteJobDir,
    pid: data.pid,
    status: "running",
    submittedAt: now,
    updatedAt: now,
    timeoutSeconds,
    outputGlobs,
    maxOutputFileBytes,
  };
  await withStoreWrite(async () => {
    const store = readJobsStore();
    store.jobs = [record, ...store.jobs.filter((job) => job.id !== jobId)];
    await writeJobsStore(store);
  });
  return record;
}

export async function listRemoteJobs(): Promise<RemoteJobRecord[]> {
  return readJobsStore().jobs;
}

function statusFromExitCode(exitCode: number, timeoutSeconds: number): RemoteJobStatus {
  if (exitCode === 0) return "succeeded";
  if (exitCode === 124 && timeoutSeconds > 0) return "timeout";
  return "failed";
}

export async function getRemoteJobSnapshot(jobId: string): Promise<RemoteJobSnapshot> {
  const store = readJobsStore();
  const record = store.jobs.find((job) => job.id === jobId);
  if (!record) {
    throw new Error(`Unknown remote job: ${jobId}`);
  }
  const host = getHostOrThrow(record.hostId);
  const payload = {
    remoteJobDir: record.remoteJobDir,
    pid: record.pid,
    outputGlobs: record.outputGlobs,
    maxOutputFileBytes: record.maxOutputFileBytes,
    maxOutputFiles: MAX_OUTPUT_FILES,
    maxTotalOutputBytes: MAX_TOTAL_OUTPUT_BYTES,
  };
  const remote = await runRemotePythonWithInput<RemoteStatusPayload>(
    host.sshCommand,
    REMOTE_STATUS_SCRIPT,
    payload,
    20_000
  );
  const nextStatus =
    remote.status === "running" || remote.status === "unknown"
      ? remote.status
      : statusFromExitCode(remote.exitCode ?? 1, record.timeoutSeconds);
  const nextRecord: RemoteJobRecord = {
    ...record,
    status: nextStatus,
    updatedAt: nowIso(),
    finishedAt: remote.finishedAt || record.finishedAt,
  };
  await withStoreWrite(async () => {
    const latestStore = readJobsStore();
    latestStore.jobs = latestStore.jobs.map((job) =>
      job.id === jobId ? nextRecord : job
    );
    await writeJobsStore(latestStore);
  });
  return {
    ...nextRecord,
    stdout: remote.stdout,
    stderr: remote.stderr,
    exitCode: remote.exitCode,
    outputs: remote.outputs,
  };
}

const REMOTE_SUBMIT_SCRIPT = String.raw`
import base64
import json
import os
import pathlib
import stat
import subprocess
import sys


def safe_child(root, rel):
    rel = str(rel or "").replace("\\", "/").lstrip("/")
    if rel.startswith("~") or any(part in {"", ".."} for part in rel.split("/")):
        raise ValueError(f"Unsafe input path: {rel}")
    target = (root / rel).resolve()
    target.relative_to(root)
    return target


def main():
    request = json.loads(sys.stdin.read() or "{}")
    scratch = pathlib.Path(request["scratchRoot"]).expanduser().resolve()
    job_id = request["jobId"]
    if not job_id.startswith("job_"):
        raise ValueError("Invalid job id")
    job_dir = (scratch / job_id).resolve()
    job_dir.relative_to(scratch)
    work_dir = job_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=False)

    for item in request.get("inputs") or []:
        target = safe_child(work_dir, item["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(item["contentBase64"]))

    command_file = job_dir / "command.sh"
    command_file.write_text(request["command"], encoding="utf-8")
    wrapper = job_dir / "run.sh"
    wrapper.write_text(f"""#!/usr/bin/env bash
set +e
cd {str(work_dir)!r}
date -u +%Y-%m-%dT%H:%M:%SZ > ../started_at.txt
if ! command -v timeout >/dev/null 2>&1; then
  echo "Remote host is missing the timeout command." > ../stderr.log
  code=127
else
  timeout {int(request["timeoutSeconds"])} bash -lc "$(cat ../command.sh)" > ../stdout.log 2> ../stderr.log
  code=$?
fi
printf '%s\n' "$code" > ../exit_code.txt
date -u +%Y-%m-%dT%H:%M:%SZ > ../finished_at.txt
exit "$code"
""", encoding="utf-8")
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR)
    proc = subprocess.Popen(
        ["nohup", "bash", str(wrapper)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    (job_dir / "pid.txt").write_text(str(proc.pid), encoding="utf-8")
    return {"remoteJobDir": str(job_dir), "pid": proc.pid}


try:
    print(json.dumps({"ok": True, "data": main()}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
`;

const REMOTE_STATUS_SCRIPT = String.raw`
import base64
import glob
import json
import os
import pathlib
import sys


def read_text(path, limit=200000):
    try:
        raw = pathlib.Path(path).read_bytes()
    except OSError:
        return ""
    if len(raw) > limit:
        return raw[:limit].decode("utf-8", "replace") + f"\n\n... truncated at {limit} bytes"
    return raw.decode("utf-8", "replace")


def is_running(pid):
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False


def safe_output(root, path):
    resolved = pathlib.Path(path).resolve()
    resolved.relative_to(root)
    return resolved


def collect_outputs(work_dir, globs, max_bytes, max_files, max_total_bytes):
    outputs = []
    seen = set()
    total_bytes = 0
    for pattern in globs:
        for matched in glob.glob(str(work_dir / pattern), recursive=True):
            if len(outputs) >= max_files:
                return outputs
            path = pathlib.Path(matched)
            if not path.is_file():
                continue
            resolved = safe_output(work_dir, path)
            if resolved in seen:
                continue
            seen.add(resolved)
            size = resolved.stat().st_size
            rel = resolved.relative_to(work_dir).as_posix()
            item = {"path": rel, "size": size}
            if size <= max_bytes and total_bytes + size <= max_total_bytes:
                item["contentBase64"] = base64.b64encode(resolved.read_bytes()).decode("ascii")
                total_bytes += size
            else:
                item["leftOnRemote"] = True
            outputs.append(item)
    outputs.sort(key=lambda item: item["path"])
    return outputs


def main():
    request = json.loads(sys.stdin.read() or "{}")
    job_dir = pathlib.Path(request["remoteJobDir"]).expanduser().resolve()
    work_dir = job_dir / "work"
    pid = request.get("pid")
    exit_file = job_dir / "exit_code.txt"
    finished_file = job_dir / "finished_at.txt"
    payload = {
        "stdout": read_text(job_dir / "stdout.log"),
        "stderr": read_text(job_dir / "stderr.log"),
    }
    if exit_file.exists():
        exit_code = int(exit_file.read_text(encoding="utf-8").strip())
        payload.update({
            "status": "succeeded" if exit_code == 0 else "failed",
            "exitCode": exit_code,
            "finishedAt": read_text(finished_file).strip() or None,
            "outputs": collect_outputs(
                work_dir,
                request.get("outputGlobs") or [],
                int(request.get("maxOutputFileBytes") or 0),
                int(request.get("maxOutputFiles") or 0),
                int(request.get("maxTotalOutputBytes") or 0),
            ),
        })
        return payload
    if is_running(pid):
        payload["status"] = "running"
        return payload
    payload["status"] = "unknown"
    return payload


try:
    print(json.dumps({"ok": True, "data": main()}))
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc)}))
`;
