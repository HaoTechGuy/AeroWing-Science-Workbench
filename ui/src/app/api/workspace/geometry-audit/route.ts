import { execFile } from "child_process";
import crypto from "crypto";
import { existsSync } from "fs";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import {
  assertReadableFilePath,
  getFileExtension,
  readWorkspaceRawFile,
} from "../_lib/workspace";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const AUDIT_CACHE_VERSION = "geometry-audit-v1";
const GEOMETRY_EXTENSIONS = new Set([
  ".inp",
  ".obj",
  ".ply",
  ".stl",
  ".vtk",
  ".vtp",
  ".vtu",
]);

function resolveAppRoot(): string {
  const configuredRoot = process.env.INTERNAGENTS_APP_ROOT;
  if (configuredRoot && existsSync(path.join(configuredRoot, "skills"))) {
    return configuredRoot;
  }
  if (existsSync(path.join(process.cwd(), "skills"))) {
    return process.cwd();
  }
  return path.resolve(process.cwd(), "..");
}

function resolvePythonExecutable(appRoot: string): string {
  const candidates = process.platform === "win32"
    ? [
        path.join(appRoot, ".venv", "Scripts", "python.exe"),
        path.join(appRoot, "venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(appRoot, ".venv", "bin", "python"),
        path.join(appRoot, "venv", "bin", "python"),
      ];
  return candidates.find((candidate) => existsSync(candidate)) || "python";
}

function parseJsonPayload(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stdout.slice(start, end + 1));
    }
    throw new Error("Geometry audit did not return valid JSON.");
  }
}

function auditCachePath(
  appRoot: string,
  rawFile: { path: string; size: number; modifiedAt: string }
): string {
  const key = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: AUDIT_CACHE_VERSION,
        path: rawFile.path,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
      })
    )
    .digest("hex");
  return path.join(appRoot, ".internagents", "cache", "geometry-audit", `${key}.json`);
}

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  try {
    assertReadableFilePath(requestedPath);
    const extension = getFileExtension(requestedPath);
    if (!GEOMETRY_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { error: "Selected file is not a supported geometry audit format." },
        { status: 400 }
      );
    }

    const rawFile = await readWorkspaceRawFile(requestedPath, resourceId, workspaceId);
    const appRoot = resolveAppRoot();
    const auditPath = path.join(appRoot, "skills", "aircraft-geometry-audit", "tools", "audit_geometry.py");
    if (!existsSync(auditPath)) {
      throw new Error("Aircraft geometry audit script was not found in this workbench.");
    }

    const cachePath = auditCachePath(appRoot, rawFile);
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf-8"));
      return NextResponse.json({
        path: rawFile.path,
        name: rawFile.name,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
        cacheHit: true,
        audit: cached,
      });
    } catch {
      // Cache misses and corrupt cache files fall through to regeneration.
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aerowing-geometry-"));
    const tempFile = path.join(tempDir, `${Date.now()}-${rawFile.name}`);
    try {
      await fs.writeFile(tempFile, rawFile.data);
      const python = resolvePythonExecutable(appRoot);
      const { stdout } = await execFileAsync(python, [auditPath, tempFile], {
        cwd: appRoot,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      const audit = parseJsonPayload(stdout);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(audit), "utf-8");
      return NextResponse.json({
        path: rawFile.path,
        name: rawFile.name,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
        cacheHit: false,
        audit,
      });
    } finally {
      await fs.rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate geometry audit.",
      },
      { status: 400 }
    );
  }
}
