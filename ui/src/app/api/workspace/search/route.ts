import { NextRequest, NextResponse } from "next/server";
import { searchWorkspaceFiles } from "../_lib/workspace";
import type { WorkspaceSearchResponse } from "@/app/types/workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("query") || searchParams.get("q") || "";
  const requestedPath = searchParams.get("path") || "";
  const resourceId = searchParams.get("resourceId");
  const workspaceId = searchParams.get("workspaceId");
  const limitValue = Number(searchParams.get("limit") || "");

  try {
    const entries = await searchWorkspaceFiles(query, resourceId, workspaceId, {
      relativePath: requestedPath,
      maxResults: Number.isFinite(limitValue) ? limitValue : undefined,
    });
    const payload: WorkspaceSearchResponse = {
      query,
      entries,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to search workspace files.",
      },
      { status: 400 }
    );
  }
}
