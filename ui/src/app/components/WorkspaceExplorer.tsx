"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ExternalLink,
  File,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  Presentation,
  RefreshCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/app/hooks/useLanguage";
import { useWorkspaceFiles } from "@/app/hooks/useWorkspaceFiles";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";
import {
  WORKSPACE_FILE_DRAG_MIME,
  createWorkspaceFileDragPayload,
} from "@/app/utils/workspaceDrag";

const COMPOSER_DRAFT_EVENT = "internagents.composer-draft";

interface WorkspaceExplorerProps {
  selectedPath?: string | null;
  resourceId?: string;
  workspaceId?: string;
  refreshKey?: number;
  activeWorkspace?: LocalWorkspace | null;
  onFileSelect: (entry: WorkspaceEntry) => void;
  onCollapse?: () => void;
}

interface WorkspaceContextMenu {
  entry: WorkspaceEntry;
  x: number;
  y: number;
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
    return <FileText className="h-4 w-4 text-primary" />;
  }

  if (entry.previewKind === "pdf") {
    return <FileText className="h-4 w-4 text-[#A83232]" />;
  }

  if (entry.previewKind === "docx") {
    return <FileText className="h-4 w-4 text-primary" />;
  }

  if (entry.previewKind === "xlsx") {
    return <FileSpreadsheet className="h-4 w-4 text-[#9A5B13]" />;
  }

  if (entry.previewKind === "pptx") {
    return <Presentation className="h-4 w-4 text-[#A85D32]" />;
  }

  if (entry.extension === ".json") {
    return <FileJson className="h-4 w-4 text-[#6D5BD0]" />;
  }

  if (
    [".js", ".jsx", ".py", ".ts", ".tsx", ".sh"].includes(entry.extension || "")
  ) {
    return <FileCode2 className="h-4 w-4 text-[#0284c7]" />;
  }

  return <File className="h-4 w-4 text-muted-foreground" />;
}

function matchesFilter(entry: WorkspaceEntry, filter: string): boolean {
  if (!filter) return true;
  return entry.path.toLowerCase().includes(filter.toLowerCase());
}

export function WorkspaceExplorer({
  selectedPath,
  resourceId,
  workspaceId,
  refreshKey,
  activeWorkspace,
  onFileSelect,
  onCollapse,
}: WorkspaceExplorerProps) {
  const { t } = useLanguage();
  const {
    directories,
    expandedPaths,
    loadingPaths,
    error,
    toggleDirectory,
    refresh,
  } = useWorkspaceFiles(resourceId, workspaceId, refreshKey);
  const [filter, setFilter] = useState("");

  const rootEntries = useMemo(() => directories[""] ?? [], [directories]);
  const rootLoading = loadingPaths.has("") && rootEntries.length === 0;
  const normalizedFilter = filter.trim();
  const canOpenWorkspaceFolder = Boolean(activeWorkspace);
  const [openingWorkspaceFolder, setOpeningWorkspaceFolder] = useState(false);
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenu | null>(
    null
  );
  const explorerRef = useRef<HTMLDivElement | null>(null);

  const openWorkspaceFolder = useCallback(async () => {
    if (!canOpenWorkspaceFolder || openingWorkspaceFolder) {
      return;
    }

    setOpeningWorkspaceFolder(true);
    try {
      const response = await fetch("/api/workspace/open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId, workspaceId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || t("openProjectFolder"));
      }
    } catch (openError) {
      const message =
        openError instanceof Error
          ? openError.message
          : t("openProjectFolder");
      toast.error(message);
    } finally {
      setOpeningWorkspaceFolder(false);
    }
  }, [
    canOpenWorkspaceFolder,
    openingWorkspaceFolder,
    resourceId,
    t,
    workspaceId,
  ]);

  const handleEntryOpen = useCallback(
    (entry: WorkspaceEntry) => {
      setContextMenu(null);
      if (entry.kind === "directory") {
        void toggleDirectory(entry.path);
        return;
      }

      onFileSelect(entry);
    },
    [onFileSelect, toggleDirectory]
  );

  const handleEntryContextMenu = useCallback(
    (event: React.MouseEvent, entry: WorkspaceEntry) => {
      event.preventDefault();
      event.stopPropagation();
      const menuWidth = 210;
      const menuHeight = entry.kind === "file" ? 86 : 46;
      const explorerRect = explorerRef.current?.getBoundingClientRect();
      const explorerLeft = explorerRect?.left ?? 0;
      const explorerTop = explorerRect?.top ?? 0;
      const explorerWidth = explorerRect?.width ?? event.clientX + menuWidth;
      const explorerHeight = explorerRect?.height ?? event.clientY + menuHeight;
      const localX = event.clientX - explorerLeft;
      const localY = event.clientY - explorerTop;
      setContextMenu({
        entry,
        x: Math.max(8, Math.min(localX, explorerWidth - menuWidth - 8)),
        y: Math.max(8, Math.min(localY, explorerHeight - menuHeight - 8)),
      });
    },
    []
  );

  const handleOpenContextEntry = useCallback(() => {
    if (!contextMenu) {
      return;
    }

    handleEntryOpen(contextMenu.entry);
  }, [contextMenu, handleEntryOpen]);

  const handleAddContextEntryToChat = useCallback(() => {
    if (!contextMenu || contextMenu.entry.kind === "directory") {
      return;
    }

    const entry = contextMenu.entry;
    const draft = t("analyzeThisFileDraft", { path: entry.path });
    setContextMenu(null);
    onFileSelect(entry);

    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(COMPOSER_DRAFT_EVENT, { detail: { draft } })
    );
  }, [contextMenu, onFileSelect, t]);

  useEffect(() => {
    if (!contextMenu || typeof window === "undefined") {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenu]);

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
      const dragPayload = createWorkspaceFileDragPayload(
        entry,
        resourceId,
        workspaceId
      );

      return (
        <div key={entry.path}>
          <button
            type="button"
            draggable={Boolean(dragPayload)}
            onDragStart={(event) => {
              if (!dragPayload) return;
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(
                WORKSPACE_FILE_DRAG_MIME,
                JSON.stringify(dragPayload)
              );
              event.dataTransfer.setData("text/plain", entry.path);
            }}
            onClick={() => handleEntryOpen(entry)}
            onContextMenu={(event) => handleEntryContextMenu(event, entry)}
            className={cn(
              "grid h-8 w-full grid-cols-[20px_20px_minmax(0,1fr)_auto] items-center gap-1 rounded-md border border-transparent px-2 text-left text-sm transition-[background-color,border-color,color]",
              "hover:border-border hover:bg-card",
              dragPayload && "cursor-grab active:cursor-grabbing",
              isSelected &&
                "border-primary/25 bg-primary/10 text-primary ring-1 ring-inset ring-primary/15 hover:bg-primary/15 dark:border-primary/35 dark:bg-primary/15 dark:text-foreground dark:ring-primary/20 dark:hover:bg-primary/20"
            )}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            aria-expanded={isDirectory ? isExpanded : undefined}
            aria-current={isSelected ? "page" : undefined}
            title={dragPayload ? t("dragFileHint") : undefined}
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
              <span className="pl-2 text-xs text-muted-foreground">
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
                  {t("emptyFolder")}
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
      handleEntryContextMenu,
      handleEntryOpen,
      loadingPaths,
      normalizedFilter,
      resourceId,
      selectedPath,
      t,
      workspaceId,
    ]
  );

  const renderedEntries = useMemo(
    () => rootEntries.map((entry) => renderEntry(entry, 0)),
    [renderEntry, rootEntries]
  );

  return (
    <div
      ref={explorerRef}
      className="absolute inset-0 flex flex-col bg-sidebar"
    >
      <div className="border-b border-border bg-card/60 px-4 py-2">
        <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 items-center gap-2">
              {onCollapse && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={onCollapse}
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                      aria-label={t("shrinkProjectFiles")}
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="bottom"
                    align="center"
                    sideOffset={6}
                    className="whitespace-nowrap"
                  >
                    {t("shrinkProjectFiles")}
                  </TooltipContent>
                </Tooltip>
              )}
              <h2 className="shrink-0 text-sm font-semibold leading-none tracking-tight text-foreground">
                {t("projectFiles")}
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canOpenWorkspaceFolder && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => void openWorkspaceFolder()}
                    disabled={openingWorkspaceFolder}
                    className="h-7 w-7 text-muted-foreground hover:text-primary"
                    aria-label={t("openProjectFolder")}
                  >
                    {openingWorkspaceFolder ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="center"
                  sideOffset={6}
                  className="whitespace-nowrap"
                >
                  {t("openProjectFolder")}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={refresh}
                  className="h-7 w-7 text-muted-foreground hover:text-primary"
                  aria-label={t("refreshProjectFiles")}
                >
                  <RefreshCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="center"
                sideOffset={6}
                className="whitespace-nowrap"
              >
                {t("refreshProjectFiles")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("filterFiles")}
            className="h-8 rounded-md border-border bg-card pl-8 text-xs"
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
                className="h-8 w-full bg-muted"
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
                {t("noMatchingFiles")}
              </div>
            )}
          </div>
        )}
      </ScrollArea>
      {contextMenu && (
        <div
          className="absolute z-50 min-w-[190px] overflow-hidden rounded-md border border-border bg-popover/95 p-1 text-popover-foreground shadow-lg shadow-black/15 backdrop-blur"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleOpenContextEntry}
            className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs font-semibold hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span>{t("open")}</span>
          </button>
          {contextMenu.entry.kind === "file" && (
            <button
              type="button"
              role="menuitem"
              onClick={handleAddContextEntryToChat}
              className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs font-semibold hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>{t("addFilePathToChat")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
