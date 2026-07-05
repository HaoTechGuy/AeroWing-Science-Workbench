import { execFile } from "child_process";
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

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aerowing-cae-"));
    const tempFile = path.join(tempDir, `${Date.now()}-${rawFile.name}`);
    try {
      await fs.writeFile(tempFile, rawFile.data);
      const python = resolvePythonExecutable(appRoot);
      const { stdout } = await execFileAsync(python, [parserPath, tempFile], {
        cwd: appRoot,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      return NextResponse.json({
        path: rawFile.path,
        name: rawFile.name,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
        summary: parseJsonPayload(stdout),
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
            : "Unable to generate CAE summary.",
      },
      { status: 400 }
    );
  }
}
