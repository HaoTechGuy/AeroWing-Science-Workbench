"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  File,
  FileText,
  Loader2,
  PanelRight,
} from "lucide-react";
import { toast } from "sonner";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import type { WorkspaceFileResponse } from "@/app/types/workspace";

interface WorkspaceViewerProps {
  selectedPath?: string | null;
  resourceId?: string;
  workspaceId?: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".css": "css",
  ".html": "html",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".py": "python",
  ".sh": "bash",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchWorkspaceFile(
  path: string,
  resourceId?: string,
  workspaceId?: string
): Promise<WorkspaceFileResponse> {
  const params = new URLSearchParams({ path });
  if (resourceId) {
    params.set("resourceId", resourceId);
  }
  if (workspaceId) {
    params.set("workspaceId", workspaceId);
  }
  const response = await fetch(`/api/workspace/file?${params.toString()}`);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Unable to load file.");
  }

  return response.json();
}

function EmptyViewer() {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card shadow-sm shadow-black/[0.025]">
          <PanelRight className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          从工作区选择代码、文本、图片或 PDF 文件后，会在这里预览。
        </p>
      </div>
    </div>
  );
}

export function WorkspaceViewer({
  selectedPath,
  resourceId,
  workspaceId,
}: WorkspaceViewerProps) {
  const [file, setFile] = useState<WorkspaceFileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpeningFile, setIsOpeningFile] = useState(false);

  useEffect(() => {
    if (!selectedPath) {
      setFile(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    fetchWorkspaceFile(selectedPath, resourceId, workspaceId)
      .then((payload) => {
        if (!isCancelled) {
          setFile(payload);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          setFile(null);
          setError(err instanceof Error ? err.message : "Unable to load file.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [resourceId, selectedPath, workspaceId]);

  const language = useMemo(() => {
    return file?.extension ? LANGUAGE_MAP[file.extension] || "text" : "text";
  }, [file?.extension]);

  async function openFileInSystemViewer() {
    if (!file || isOpeningFile) {
      return;
    }

    setIsOpeningFile(true);
    try {
      const response = await fetch("/api/workspace/open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file.path,
          resourceId,
          workspaceId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "无法打开本地文件。");
      }
    } catch (openError) {
      const message =
        openError instanceof Error ? openError.message : "无法打开本地文件。";
      toast.error(message);
    } finally {
      setIsOpeningFile(false);
    }
  }

  if (!selectedPath) {
    return (
      <div className="h-full bg-card">
        <EmptyViewer />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-border bg-card/80 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/70">
            {file?.previewKind === "pdf" ? (
              <FileText className="h-4 w-4 text-[#A83232]" />
            ) : (
              <File className="h-4 w-4 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {file?.name || selectedPath}
            </h2>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
              {file && <span>{formatBytes(file.size)}</span>}
              {file?.previewKind && <span>{file.previewKind}</span>}
            </div>
          </div>
        </div>
        {file?.rawUrl && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => void openFileInSystemViewer()}
            disabled={isOpeningFile}
            aria-label="用系统查看器打开文件"
            title="用系统查看器打开文件"
          >
            {isOpeningFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {isLoading && (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading file...
          </div>
        )}

        {!isLoading && error && (
          <div className="m-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!isLoading && !error && file?.previewKind === "pdf" && file.rawUrl && (
          <iframe
            src={file.rawUrl}
            title={file.path}
            className="h-full w-full border-0 bg-muted"
          />
        )}

        {!isLoading && !error && file?.previewKind === "image" && file.rawUrl && (
          <div className="flex h-full items-center justify-center bg-muted/30 p-6">
            <img
              src={file.rawUrl}
              alt={file.name}
              className="max-h-full max-w-full rounded-md border border-border bg-card shadow-sm shadow-black/[0.025]"
            />
          </div>
        )}

        {!isLoading && !error && file?.previewKind === "markdown" && (
          <ScrollArea className="h-full">
            <div className="px-6 py-5">
              <MarkdownContent content={file.content || ""} />
            </div>
          </ScrollArea>
        )}

        {!isLoading && !error && file?.previewKind === "text" && (
          <ScrollArea className="h-full">
            <div className="p-4">
              {file.tooLarge ? (
                <div className="rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
                  This text file is too large to preview inline.
                </div>
              ) : (
                <SyntaxHighlighter
                  language={language}
                  style={oneLight}
                  showLineNumbers
                  wrapLongLines
                  customStyle={{
                    margin: 0,
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "0.8125rem",
                    minHeight: "100%",
                    background: "hsl(var(--card))",
                  }}
                >
                  {file.content || ""}
                </SyntaxHighlighter>
              )}
            </div>
          </ScrollArea>
        )}

        {!isLoading &&
          !error &&
          file &&
          !["image", "markdown", "pdf", "text"].includes(file.previewKind) && (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <div className="max-w-xs rounded-md border border-border bg-muted p-5 text-sm text-muted-foreground">
                This file type cannot be previewed inline.
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
