"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { toast } from "sonner";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WorkspaceFileResponse } from "@/app/types/workspace";

interface WorkspaceViewerProps {
  selectedPath?: string | null;
  resourceId?: string;
  workspaceId?: string;
  compact?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  ".css": "css",
  caddyfile: "text",
  dockerfile: "dockerfile",
  ".html": "html",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  gemfile: "ruby",
  makefile: "makefile",
  procfile: "text",
  ".py": "python",
  rakefile: "ruby",
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

function CollapsePreviewButton({ onCollapse }: { onCollapse?: () => void }) {
  if (!onCollapse) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
          aria-label="缩小文件预览"
          onClick={onCollapse}
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="center"
        sideOffset={6}
        className="whitespace-nowrap"
      >
        缩小文件预览
      </TooltipContent>
    </Tooltip>
  );
}

function ViewerHeader({
  title,
  onCollapse,
}: {
  title: string;
  onCollapse?: () => void;
}) {
  return (
    <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold leading-5">{title}</h2>
      </div>
      <CollapsePreviewButton onCollapse={onCollapse} />
    </div>
  );
}

export function WorkspaceViewer({
  selectedPath,
  resourceId,
  workspaceId,
  compact,
  onCollapse,
  onExpand,
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

  if (compact) {
    return (
      <div className="flex h-full w-full items-start justify-center border-l border-border bg-card/70 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
              aria-label="展开文件预览"
              onClick={onExpand}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            align="center"
            sideOffset={8}
            className="whitespace-nowrap"
          >
            展开文件预览
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  if (!selectedPath) {
    return (
      <div className="flex h-full flex-col bg-card">
        <ViewerHeader
          title="文件预览"
          onCollapse={onCollapse}
        />
        <EmptyViewer />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="min-w-0 truncate text-sm font-semibold leading-5">
            {file?.name || selectedPath}
          </h2>
          <div className="flex shrink-0 items-center gap-2 text-xs leading-4 text-muted-foreground">
            {file && <span>{formatBytes(file.size)}</span>}
            {file?.previewKind && <span>{file.previewKind}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {file?.rawUrl && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
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
          <CollapsePreviewButton onCollapse={onCollapse} />
        </div>
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
          <div className="h-full overflow-auto">
            <div className="min-w-0 p-4">
              {file.tooLarge ? (
                <div className="rounded-md border border-border bg-muted p-4 text-sm text-muted-foreground">
                  This text file is too large to preview inline.
                </div>
              ) : (
                <SyntaxHighlighter
                  language={language}
                  style={oneLight}
                  showLineNumbers
                  wrapLines
                  wrapLongLines
                  codeTagProps={{
                    style: {
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                  }}
                  lineProps={{
                    style: {
                      overflowWrap: "anywhere",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                  }}
                  customStyle={{
                    margin: 0,
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.5rem",
                    fontSize: "0.8125rem",
                    minHeight: "100%",
                    maxWidth: "100%",
                    overflowWrap: "anywhere",
                    overflowX: "auto",
                    background: "hsl(var(--card))",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {file.content || ""}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
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
