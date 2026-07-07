import { spawn } from "child_process";
import crypto from "crypto";
import { existsSync } from "fs";
import { promises as fs } from "fs";
import path from "path";

export type AeroWingJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AeroWingJob {
  id: string;
  type: string;
  status: AeroWingJobStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  runnerPid?: number;
  exitCode?: number;
  error?: string;
}

export function resolveAppRoot(): string {
  const configuredRoot = process.env.INTERNAGENTS_APP_ROOT;
  if (configuredRoot && existsSync(path.join(configuredRoot, "skills"))) {
    return configuredRoot;
  }
  if (existsSync(path.join(process.cwd(), "skills"))) {
    return process.cwd();
  }
  return path.resolve(process.cwd(), "..");
}

export function jobsRoot(): string {
  return path.join(resolveAppRoot(), ".internagents", "jobs");
}

export function jobDir(jobId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new Error("Invalid job id.");
  }
  return path.join(jobsRoot(), jobId);
}

export async function readJob(jobId: string): Promise<AeroWingJob> {
  return JSON.parse(await fs.readFile(path.join(jobDir(jobId), "job.json"), "utf-8")) as AeroWingJob;
}

export async function writeJob(job: AeroWingJob): Promise<void> {
  const dir = jobDir(job.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "job.json"), `${JSON.stringify(job, null, 2)}\n`, "utf-8");
}

export async function readJobText(jobId: string, fileName: "stdout.log" | "stderr.log"): Promise<string> {
  return fs.readFile(path.join(jobDir(jobId), fileName), "utf-8").catch(() => "");
}

export async function readJobResult(jobId: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(jobDir(jobId), "result.json"), "utf-8"));
  } catch {
    return null;
  }
}

export async function createJob(type: string, payload: Record<string, unknown>): Promise<AeroWingJob> {
  const now = new Date().toISOString();
  const job: AeroWingJob = {
    id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`,
    type,
    status: "queued",
    payload,
    createdAt: now,
    updatedAt: now,
  };
  await writeJob(job);
  const appRoot = resolveAppRoot();
  const runner = path.join(appRoot, "scripts", "aerowing-job-runner.mjs");
  const child = spawn(process.execPath, [runner, appRoot, jobDir(job.id)], {
    cwd: appRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return job;
}
