"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCcw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkspaceFiles } from "@/app/hooks/useWorkspaceFiles";
import type { WorkspaceEntry } from "@/app/types/workspace";

interface WorkspaceExplorerProps {
  selectedPath?: string | null;
  onFileSelect: (entry: WorkspaceEntry) => void;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ entry }: { entry: WorkspaceEntry }) {
  if (entry.kind === "directory") {
    return <Folder className="h-4 w-4 text-[#B47A1F]" />;
  }

  if (entry.previewKind === "markdown") {
    return <FileText className="h-4 w-4 text-[#2F6868]" />;
  }

  if (entry.previewKind === "pdf") {
    return <FileText className="h-4 w-4 text-[#A83232]" />;
  }

  if (entry.extension === ".json") {
    return <FileJson className="h-4 w-4 text-[#6D5BD0]" />;
  }

  if (
    [".js", ".jsx", ".py", ".ts", ".tsx", ".sh"].includes(
      entry.extension || ""
    )
  ) {
    return <FileCode2 className="h-4 w-4 text-[#3B6FA8]" />;
  }

  return <File className="h-4 w-4 text-muted-foreground" />;
}

function matchesFilter(entry: WorkspaceEntry, filter: string): boolean {
  if (!filter) return true;
  return entry.path.toLowerCase().includes(filter.toLowerCase());
}

export function WorkspaceExplorer({
  selectedPath,
  onFileSelect,
}: WorkspaceExplorerProps) {
  const {
    directories,
    expandedPaths,
    loadingPaths,
    error,
    toggleDirectory,
    refresh,
  } = useWorkspaceFiles();
  const [filter, setFilter] = useState("");

  const rootEntries = useMemo(() => directories[""] ?? [], [directories]);
  const rootLoading = loadingPaths.has("") && rootEntries.length === 0;
  const normalizedFilter = filter.trim();

  const renderEntry = useCallback(
    (entry: WorkspaceEntry, depth: number): React.ReactNode => {
      if (!matchesFilter(entry, normalizedFilter)) {
        const children = directories[entry.path] ?? [];
        const hasMatchingChild = children.some((child) =>
          matchesFilter(child, normalizedFilter)
        );
        if (!hasMatchingChild) return null;
      }

      const isDirectory = entry.kind === "directory";
      const isExpanded = expandedPaths.has(entry.path);
      const isLoading = loadingPaths.has(entry.path);
      const isSelected = selectedPath === entry.path;
      const children = directories[entry.path] ?? [];

      return (
        <div key={entry.path}>
          <button
            type="button"
            onClick={() =>
              isDirectory ? toggleDirectory(entry.path) : onFileSelect(entry)
            }
            className={cn(
              "grid h-8 w-full grid-cols-[20px_20px_minmax(0,1fr)_auto] items-center gap-1 rounded-md px-2 text-left text-sm transition-colors",
              "hover:bg-accent",
              isSelected && "bg-primary/10 text-primary hover:bg-primary/10"
            )}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            aria-expanded={isDirectory ? isExpanded : undefined}
          >
            <span className="flex h-5 w-5 items-center justify-center">
              {isDirectory &&
                (isLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90"
                    )}
                  />
                ))}
            </span>
            <span className="flex h-5 w-5 items-center justify-center">
              {isDirectory && isExpanded ? (
                <FolderOpen className="h-4 w-4 text-[#B47A1F]" />
              ) : (
                <FileIcon entry={entry} />
              )}
            </span>
            <span className="min-w-0 truncate font-medium">{entry.name}</span>
            {!isDirectory && (
              <span className="pl-2 text-[11px] text-muted-foreground">
                {formatBytes(entry.size)}
              </span>
            )}
          </button>

          {isDirectory && isExpanded && (
            <div>
              {children.length === 0 && !isLoading ? (
                <div
                  className="px-2 py-1 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${44 + depth * 14}px` }}
                >
                  Empty
                </div>
              ) : (
                children.map((child) => renderEntry(child, depth + 1))
              )}
            </div>
          )}
        </div>
      );
    },
    [
      directories,
      expandedPaths,
      loadingPaths,
      normalizedFilter,
      onFileSelect,
      selectedPath,
      toggleDirectory,
    ]
  );

  const renderedEntries = useMemo(
    () => rootEntries.map((entry) => renderEntry(entry, 0)),
    [renderEntry, rootEntries]
  );

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              工作区
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              当前项目文件
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            className="h-8 w-8 shrink-0"
            aria-label="刷新工作区文件"
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter files"
            className="h-8 rounded-md pl-8 text-xs"
          />
        </div>
      </div>

      <ScrollArea className="h-0 flex-1">
        {error && (
          <div className="m-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </div>
        )}
        {rootLoading && (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton
                key={index}
                className="h-8 w-full"
              />
            ))}
          </div>
        )}
        {!rootLoading && (
          <div className="p-2">
            {renderedEntries.some(Boolean) ? (
              renderedEntries
            ) : (
              <div className="flex h-32 items-center justify-center text-center text-xs text-muted-foreground">
                No files match this filter
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
