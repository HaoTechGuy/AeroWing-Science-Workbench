import crypto from "crypto";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { writeWorkspaceRawFile } from "../_lib/workspace";

export const runtime = "nodejs";

const MAX_PDF_UPLOAD_SIZE = 16 * 1024 * 1024;
const MAX_PDF_EXTRACT_PAGES = 20;
const MAX_PDF_EXTRACT_CHARS = 30_000;

function sanitizePathSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[/\\]/g, "-")
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return fallback;
  }
  return cleaned.startsWith(".") ? `file-${cleaned.slice(1)}` : cleaned;
}

function isPdfFile(file: File, data: Buffer): boolean {
  const name = file.name.toLowerCase();
  const mimeType = file.type.toLowerCase();
  const hasPdfName = name.endsWith(".pdf");
  const hasPdfMime = mimeType === "application/pdf";
  const hasPdfMagic = data.subarray(0, 5).toString("ascii") === "%PDF-";
  return hasPdfMagic && (hasPdfName || hasPdfMime || !mimeType);
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function extractPdfText(data: Buffer): Promise<{
  text: string;
  pageCount?: number;
  truncated: boolean;
  extractionError?: string;
}> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      const result = await parser.getText({ first: MAX_PDF_EXTRACT_PAGES });
      const normalizedText = normalizeExtractedText(result.text || "");
      const text =
        normalizedText.length > MAX_PDF_EXTRACT_CHARS
          ? normalizedText.slice(0, MAX_PDF_EXTRACT_CHARS).trimEnd()
          : normalizedText;

      return {
        text,
        pageCount: result.total,
        truncated:
          result.total > MAX_PDF_EXTRACT_PAGES ||
          normalizedText.length > MAX_PDF_EXTRACT_CHARS,
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    return {
      text: "",
      truncated: false,
      extractionError:
        error instanceof Error ? error.message : "Unable to extract PDF text.",
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing uploaded file." },
        { status: 400 }
      );
    }

    const data = Buffer.from(await file.arrayBuffer());
    if (data.length > MAX_PDF_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: "PDF file is too large to upload." },
        { status: 413 }
      );
    }

    if (!isPdfFile(file, data)) {
      return NextResponse.json(
        { error: "Only valid PDF attachments are supported here." },
        { status: 400 }
      );
    }

    const resourceId = form.get("resourceId");
    const workspaceId = form.get("workspaceId");
    const threadId = form.get("threadId");
    const uploadScope = sanitizePathSegment(
      typeof threadId === "string" && threadId ? threadId : "draft",
      "draft"
    );
    const originalName = sanitizePathSegment(
      file.name || "attachment.pdf",
      "attachment.pdf"
    );
    const extension = path.extname(originalName).toLowerCase();
    const filename =
      extension === ".pdf"
        ? originalName
        : `${path.basename(originalName, extension)}.pdf`;
    const workspacePath = [
      ".internagents",
      "uploads",
      uploadScope,
      `${crypto.randomUUID()}-${filename}`,
    ].join("/");

    const [fileData, extracted] = await Promise.all([
      writeWorkspaceRawFile(
        workspacePath,
        data,
        typeof resourceId === "string" ? resourceId : undefined,
        typeof workspaceId === "string" ? workspaceId : undefined
      ),
      extractPdfText(data),
    ]);

    return NextResponse.json({
      attachment: {
        name: file.name || fileData.name,
        mimeType: "application/pdf",
        size: fileData.size,
        kind: "pdf",
        workspacePath: `/${fileData.path.replace(/^\/+/, "")}`,
        text: extracted.text,
        pageCount: extracted.pageCount,
        truncated: extracted.truncated,
        extractionError: extracted.extractionError,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to upload attachment.",
      },
      { status: 400 }
    );
  }
}
