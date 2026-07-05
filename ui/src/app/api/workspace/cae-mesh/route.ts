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
const MESH_CACHE_VERSION = "cae-mesh-v2";
const CAE_EXTENSIONS = new Set([
  ".bdf",
  ".dat",
  ".f06",
  ".inp",
  ".k",
  ".nas",
  ".op2",
  ".pch",
  ".stl",
  ".vti",
  ".vtk",
  ".vtu",
  ".vtp",
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
    throw new Error("CAE parser did not return valid JSON.");
  }
}

function meshCachePath(
  appRoot: string,
  rawFile: { path: string; size: number; modifiedAt: string }
): string {
  const key = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        version: MESH_CACHE_VERSION,
        path: rawFile.path,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
      })
    )
    .digest("hex");
  return path.join(appRoot, ".internagents", "cache", "cae-mesh", `${key}.json`);
}

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  try {
    assertReadableFilePath(requestedPath);
    const extension = getFileExtension(requestedPath);
    if (!CAE_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { error: "Selected file is not a supported CAE format." },
        { status: 400 }
      );
    }

    const rawFile = await readWorkspaceRawFile(requestedPath, resourceId, workspaceId);
    const appRoot = resolveAppRoot();
    const parserPath = path.join(appRoot, "skills", "cad-cae-parser", "tools", "parse_cae_file.py");
    if (!existsSync(parserPath)) {
      throw new Error("CAE parser script was not found in this workbench.");
    }

    const cachePath = meshCachePath(appRoot, rawFile);
    try {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf-8"));
      return NextResponse.json({
        path: rawFile.path,
        name: rawFile.name,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
        cacheHit: true,
        mesh: cached,
      });
    } catch {
      // Cache misses and corrupt cache files fall through to regeneration.
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aerowing-cae-"));
    const tempFile = path.join(tempDir, `${Date.now()}-${rawFile.name}`);
    try {
      await fs.writeFile(tempFile, rawFile.data);
      const python = resolvePythonExecutable(appRoot);
      const { stdout } = await execFileAsync(python, [parserPath, tempFile, "--mesh-json"], {
        cwd: appRoot,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      const mesh = parseJsonPayload(stdout);
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify(mesh), "utf-8");
      return NextResponse.json({
        path: rawFile.path,
        name: rawFile.name,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
        cacheHit: false,
        mesh,
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
            : "Unable to generate CAE mesh.",
      },
      { status: 400 }
    );
  }
}

