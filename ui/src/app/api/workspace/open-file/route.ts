import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import { NextRequest, NextResponse } from "next/server";
import {
  assertReadableFilePath,
  resolveWorkspacePath,
} from "@/app/api/workspace/_lib/workspace";

const execFileAsync = promisify(execFile);
const OPEN_FILE_TIMEOUT_MS = 10_000;

export const runtime = "nodejs";

async function openFile(filePath: string) {
  if (process.platform === "darwin") {
    await execFileAsync("open", [filePath], {
      timeout: OPEN_FILE_TIMEOUT_MS,
    });
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("cmd.exe", ["/c", "start", "", filePath], {
      timeout: OPEN_FILE_TIMEOUT_MS,
    });
    return;
  }

  if (process.platform === "linux") {
    await execFileAsync("xdg-open", [filePath], {
      timeout: OPEN_FILE_TIMEOUT_MS,
    });
    return;
  }

  throw new Error("当前系统暂不支持打开本地文件。");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      path?: unknown;
      resourceId?: unknown;
      workspaceId?: unknown;
    };
    const requestedPath = typeof body.path === "string" ? body.path : "";
    const resourceId =
      typeof body.resourceId === "string" ? body.resourceId : undefined;
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId : undefined;

    assertReadableFilePath(requestedPath);
    const resolved = await resolveWorkspacePath(
      requestedPath,
      resourceId,
      workspaceId
    );

    if ((resolved.resource.backend || "local_shell") !== "local_shell") {
      throw new Error("只能打开本机项目文件。");
    }

    const stats = await fs.stat(resolved.absolutePath);
    if (!stats.isFile()) {
      throw new Error("选中的项目路径不是文件。");
    }

    await openFile(resolved.absolutePath);
    return NextResponse.json({ path: resolved.absolutePath });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法打开本地文件。",
      },
      { status: 500 }
    );
  }
}
