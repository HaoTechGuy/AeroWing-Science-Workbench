import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspacePath } from "@/app/api/workspace/_lib/workspace";
import { openLocalFolder } from "@/app/api/workspace/_lib/open-folder";

export const runtime = "nodejs";

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
      throw new Error("只能打开本机项目文件夹。");
    }

    await openLocalFolder(resolved.root);
    return NextResponse.json({ path: resolved.root });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法打开项目文件夹。",
      },
      { status: 500 }
    );
  }
}
