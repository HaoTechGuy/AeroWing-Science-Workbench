import { NextRequest, NextResponse } from "next/server";
import {
  MAX_TEXT_FILE_SIZE,
  assertReadableFilePath,
  getFileExtension,
  getMimeType,
  getPreviewKind,
  readWorkspaceFileData,
} from "../_lib/workspace";
import type { WorkspaceFileResponse } from "@/app/types/workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");

  try {
    assertReadableFilePath(requestedPath);
    const fileData = await readWorkspaceFileData(requestedPath, resourceId);

    if (!fileData.isFile) {
      return NextResponse.json(
        { error: "Selected workspace path is not a file." },
        { status: 400 }
      );
    }

    const previewKind = getPreviewKind(fileData.path);
    const rawParams = new URLSearchParams({ path: fileData.path });
    if (resourceId) {
      rawParams.set("resourceId", resourceId);
    }
    const payload: WorkspaceFileResponse = {
      name: fileData.name,
      path: fileData.path,
      extension: getFileExtension(fileData.path) || undefined,
      size: fileData.size,
      modifiedAt: fileData.modifiedAt,
      previewKind,
      mimeType: getMimeType(fileData.path),
      rawUrl: `/api/workspace/file/raw?${rawParams.toString()}`,
    };

    if (previewKind === "markdown" || previewKind === "text") {
      if (fileData.size <= MAX_TEXT_FILE_SIZE && fileData.content !== undefined) {
        payload.content = fileData.content;
      } else {
        payload.tooLarge = true;
      }
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to read workspace file.",
      },
      { status: 400 }
    );
  }
}
