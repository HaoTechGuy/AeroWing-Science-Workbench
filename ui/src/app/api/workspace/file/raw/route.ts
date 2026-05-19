import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  assertReadableFilePath,
  getMimeType,
  resolveWorkspacePath,
} from "../../_lib/workspace";

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

    const data = await fs.readFile(resolved.absolutePath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": getMimeType(resolved.relativePath),
        "Content-Disposition": `inline; filename="${path.basename(
          resolved.relativePath
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
