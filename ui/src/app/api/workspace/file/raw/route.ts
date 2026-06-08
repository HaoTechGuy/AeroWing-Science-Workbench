import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  assertReadableFilePath,
  getMimeType,
  getWorkspaceResource,
  readWorkspaceRawFile,
  streamLocalWorkspaceRawFile,
  WorkspaceRangeNotSatisfiableError,
} from "../../_lib/workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  try {
    assertReadableFilePath(requestedPath);
    const resource = getWorkspaceResource(resourceId);
    const isLocalWorkspace =
      (resource.backend || "local_shell") === "local_shell";

    if (isLocalWorkspace) {
      const fileData = await streamLocalWorkspaceRawFile(
        requestedPath,
        resourceId,
        workspaceId,
        request.headers.get("range")
      );
      if (!fileData.isFile) {
        return NextResponse.json(
          { error: "Selected workspace path is not a file." },
          { status: 400 }
        );
      }

      const headers: Record<string, string> = {
        "Content-Type": getMimeType(fileData.path),
        "Content-Disposition": `inline; filename="${path
          .basename(fileData.path)
          .replace(/["\r\n]/g, "_")}"`,
        "Cache-Control": "no-store",
        "Content-Length": String(fileData.contentLength),
      };
      headers["Accept-Ranges"] = "bytes";
      if (fileData.range) {
        headers[
          "Content-Range"
        ] = `bytes ${fileData.range.start}-${fileData.range.end}/${fileData.size}`;
      }

      return new NextResponse(fileData.stream, {
        status: fileData.range ? 206 : 200,
        headers,
      });
    }

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
        "Content-Disposition": `inline; filename="${path
          .basename(fileData.path)
          .replace(/["\r\n]/g, "_")}"`,
        "Cache-Control": "no-store",
        "Content-Length": String(fileData.data.byteLength),
      },
    });
  } catch (error) {
    if (error instanceof WorkspaceRangeNotSatisfiableError) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${error.size}`,
          "Cache-Control": "no-store",
        },
      });
    }

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
