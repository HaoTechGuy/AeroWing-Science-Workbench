#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, payload) {
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function pythonExecutable(appRoot) {
  return process.platform === "win32"
    ? path.join(appRoot, ".venv", "Scripts", "python.exe")
    : path.join(appRoot, ".venv", "bin", "python");
}

function buildCommand(appRoot, job) {
  const payload = job.payload || {};
  if (job.type === "geometry_audit") {
    return {
      command: pythonExecutable(appRoot),
      args: [
        path.join(appRoot, "skills", "aircraft-geometry-audit", "tools", "audit_geometry.py"),
        String(payload.path || ""),
      ],
    };
  }
  if (job.type === "nastran_review") {
    return {
      command: pythonExecutable(appRoot),
      args: [
        path.join(appRoot, "skills", "nastran-structure-review", "tools", "review_bdf.py"),
        String(payload.path || ""),
      ],
    };
  }
  if (job.type === "flight_condition") {
    const args = [path.join(appRoot, "skills", "flight-condition-calculator", "tools", "flight_condition.py")];
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined || value === null || value === "") continue;
      args.push(`--${key.replaceAll("_", "-")}`, String(value));
    }
    return { command: pythonExecutable(appRoot), args };
  }
  throw new Error(`Unsupported job type: ${job.type}`);
}

async function main() {
  const [appRoot, jobDir] = process.argv.slice(2);
  if (!appRoot || !jobDir) {
    throw new Error("Usage: aerowing-job-runner.mjs <appRoot> <jobDir>");
  }
  await mkdir(jobDir, { recursive: true });
  const jobPath = path.join(jobDir, "job.json");
  const resultPath = path.join(jobDir, "result.json");
  const stdoutPath = path.join(jobDir, "stdout.log");
  const stderrPath = path.join(jobDir, "stderr.log");
  const job = await readJson(jobPath);
  const startedAt = new Date().toISOString();
  await writeJson(jobPath, { ...job, status: "running", startedAt, updatedAt: startedAt, runnerPid: process.pid });

  try {
    const command = buildCommand(appRoot, job);
    const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
    const stderrStream = createWriteStream(stderrPath, { flags: "a" });
    const child = spawn(command.command, command.args, {
      cwd: appRoot,
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    child.stdout.pipe(stdoutStream);
    child.stderr.pipe(stderrStream);
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    stdoutStream.end();
    stderrStream.end();
    const finishedAt = new Date().toISOString();
    const stdout = await readFile(stdoutPath, "utf8").catch(() => "");
    if (exitCode === 0) {
      let result = { raw: stdout };
      try {
        result = JSON.parse(stdout);
      } catch {
        const start = stdout.indexOf("{");
        const end = stdout.lastIndexOf("}");
        if (start >= 0 && end > start) {
          result = JSON.parse(stdout.slice(start, end + 1));
        }
      }
      await writeJson(resultPath, result);
      await writeJson(jobPath, { ...job, status: "succeeded", startedAt, finishedAt, updatedAt: finishedAt, runnerPid: process.pid, exitCode });
      return;
    }
    const stderr = await readFile(stderrPath, "utf8").catch(() => "");
    await writeJson(jobPath, { ...job, status: "failed", startedAt, finishedAt, updatedAt: finishedAt, runnerPid: process.pid, exitCode, error: stderr.slice(-4000) || `Exited with ${exitCode}` });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await writeJson(jobPath, { ...job, status: "failed", startedAt, finishedAt, updatedAt: finishedAt, runnerPid: process.pid, error: error instanceof Error ? error.message : String(error) });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
