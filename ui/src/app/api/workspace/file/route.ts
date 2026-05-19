import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  MAX_TEXT_FILE_SIZE,
  assertReadableFilePath,
  getFileExtension,
  getMimeType,
  getPreviewKind,
  resolveWorkspacePath,
} from "../_lib/workspace";
import type { WorkspaceFileResponse } from "@/app/types/workspace";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const requestedPath = request.nextUrl.searchParams.get("path") || "";

  try {
    assertReadableFilePath(requestedPath);
    const resolved = await resolveWorkspacePath(requestedPath);
    const stats = await fs.stat(resolved.absolutePath);

    if (!stats.isFile()) {
      return NextResponse.json(
        { error: "Selected workspace path is not a file." },
        { status: 400 }
      );
    }

    const previewKind = getPreviewKind(resolved.relativePath);
    const rawUrl = `/api/workspace/file/raw?path=${encodeURIComponent(
      resolved.relativePath
    )}`;
    const payload: WorkspaceFileResponse = {
      name: path.basename(resolved.relativePath),
      path: resolved.relativePath,
      extension: getFileExtension(resolved.relativePath) || undefined,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      previewKind,
      mimeType: getMimeType(resolved.relativePath),
      rawUrl,
    };

    if (
      (previewKind === "markdown" || previewKind === "text") &&
      stats.size <= MAX_TEXT_FILE_SIZE
    ) {
      payload.content = await fs.readFile(resolved.absolutePath, "utf8");
    } else if (previewKind === "markdown" || previewKind === "text") {
      payload.tooLarge = true;
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
