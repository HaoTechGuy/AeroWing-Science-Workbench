import { NextRequest, NextResponse } from "next/server";
import {
  chooseLocalFolder,
  isUserCancelled,
} from "@/app/api/_lib/local-folder-picker";
import {
  listLocalWorkspaces,
  updateLocalResourceWorkspace,
} from "@/app/api/workspace/_lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listLocalWorkspaces());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法读取项目列表。",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      workspacePath?: unknown;
    };
    const workspacePath =
      typeof body.workspacePath === "string" ? body.workspacePath.trim() : "";
    if (!workspacePath) {
      throw new Error("项目路径不能为空。");
    }

    await updateLocalResourceWorkspace(workspacePath);
    return NextResponse.json(await listLocalWorkspaces());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法切换项目。",
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const selectedPath = await chooseLocalFolder("选择本机项目文件夹");
    if (!selectedPath) {
      return NextResponse.json({ cancelled: true });
    }

    const updated = await updateLocalResourceWorkspace(selectedPath);
    const localWorkspaces = await listLocalWorkspaces();
    return NextResponse.json({
      ...localWorkspaces,
      workspaceId: updated.workspaceId,
      workspacePath: updated.workspacePath,
    });
  } catch (error) {
    if (isUserCancelled(error)) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法打开本地项目选择器。",
      },
      { status: 500 }
    );
  }
}
