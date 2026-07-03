import { NextRequest, NextResponse } from "next/server";
import {
  assertReadableFilePath,
  getFileExtension,
  getMimeType,
  getPreviewContentSizeLimit,
  getPreviewKind,
  readWorkspaceFileData,
  readWorkspaceRawFile,
} from "../_lib/workspace";
import {
  buildOfficePreview,
  isOfficePreviewKind,
} from "../_lib/office-preview";
import type { WorkspaceFileResponse } from "@/app/types/workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");

  try {
    assertReadableFilePath(requestedPath);
    const fileData = await readWorkspaceFileData(
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

    const previewKind = getPreviewKind(fileData.path);
    const rawParams = new URLSearchParams({ path: fileData.path });
    if (resourceId) {
      rawParams.set("resourceId", resourceId);
    }
    if (workspaceId) {
      rawParams.set("workspaceId", workspaceId);
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

    const previewContentSizeLimit = getPreviewContentSizeLimit(previewKind);
    if (previewContentSizeLimit > 0) {
      if (
        fileData.size <= previewContentSizeLimit &&
        fileData.content !== undefined
      ) {
        payload.content = fileData.content;
      } else {
        payload.tooLarge = true;
      }
    }

    if (isOfficePreviewKind(previewKind)) {
      try {
        const rawFile = await readWorkspaceRawFile(
          fileData.path,
          resourceId,
          workspaceId
        );
        payload.officePreview = buildOfficePreview(rawFile.path, rawFile.data);
      } catch (previewError) {
        payload.officePreview = {
          kind: previewKind,
          blocks: [],
          error:
            previewError instanceof Error
              ? previewError.message
              : "无法生成 Office 文件预览。",
        };
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
