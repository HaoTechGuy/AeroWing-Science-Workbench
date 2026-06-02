import { execFile } from "child_process";
import { promisify } from "util";
import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspacePath } from "@/app/api/workspace/_lib/workspace";

const execFileAsync = promisify(execFile);
const OPEN_FOLDER_TIMEOUT_MS = 10_000;

export const runtime = "nodejs";

async function openFolder(folderPath: string) {
  if (process.platform === "darwin") {
    await execFileAsync("open", [folderPath], {
      timeout: OPEN_FOLDER_TIMEOUT_MS,
    });
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("explorer.exe", [folderPath], {
      timeout: OPEN_FOLDER_TIMEOUT_MS,
    });
    return;
  }

  if (process.platform === "linux") {
    await execFileAsync("xdg-open", [folderPath], {
      timeout: OPEN_FOLDER_TIMEOUT_MS,
    });
    return;
  }

  throw new Error("当前系统暂不支持打开工作区文件夹。");
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      resourceId?: unknown;
      workspaceId?: unknown;
    };
    const resourceId =
      typeof body.resourceId === "string" ? body.resourceId : undefined;
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId : undefined;
    const resolved = await resolveWorkspacePath("", resourceId, workspaceId);

    if ((resolved.resource.backend || "local_shell") !== "local_shell") {
      throw new Error("只能打开本机工作区文件夹。");
    }

    await openFolder(resolved.root);
    return NextResponse.json({ path: resolved.root });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法打开工作区文件夹。",
      },
      { status: 500 }
    );
  }
}
