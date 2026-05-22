import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  assertReadableFilePath,
  getMimeType,
  readWorkspaceRawFile,
} from "../../_lib/workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  try {
    assertReadableFilePath(requestedPath);
    const fileData = await readWorkspaceRawFile(
      requestedPath,
      resourceId,
      workspaceId
    );

    if (!fileData.isFile) {
      return NextResponse.json(
        { error: "Selected workspace path is not a file." },
        { status: 400 }
      );
    }

    const body = new Uint8Array(fileData.data);

    return new NextResponse(body, {
      headers: {
        "Content-Type": getMimeType(fileData.path),
        "Content-Disposition": `inline; filename="${path.basename(
          fileData.path
        )}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to stream workspace file.",
      },
      { status: 400 }
    );
  }
}
