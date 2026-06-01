import { NextResponse } from "next/server";
import { listUiResources } from "@/app/api/remote-connections/_lib/remote-connections";
import { readWorkspaceResourcesConfig } from "@/app/api/workspace/_lib/workspace";

export const runtime = "nodejs";

export async function GET() {
  try {
    const config = readWorkspaceResourcesConfig();
    return NextResponse.json({
      defaultResourceId: config.default_resource || "local",
      resources: listUiResources(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法读取机器资源。",
      },
      { status: 500 }
    );
  }
}
