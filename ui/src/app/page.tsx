"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  Suspense,
} from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  FolderOpen,
  Info,
  Loader2,
  MessageSquare,
  MessageSquareOff,
  Plus,
  Settings,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  getConfig,
  getResource,
  type ResourceConfig,
  type StandaloneConfig,
} from "@/lib/config";
import { Assistant } from "@langchain/langgraph-sdk";
import {
  RemoteAgentProvider,
  useRemoteAgent,
} from "@/providers/ClientProvider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatProvider } from "@/providers/ChatProvider";
import { Button } from "@/components/ui/button";
import { ChatInterface } from "@/app/components/ChatInterface";
import { RemoteConnectionDialog } from "@/app/components/RemoteConnectionDialog";
import { WorkspacePanel } from "@/app/components/WorkspacePanel";
import { WorkspaceViewer } from "@/app/components/WorkspaceViewer";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";
import { pageHrefWithWorkbenchReturn } from "@/app/utils/navigationContext";
import { cn } from "@/lib/utils";

const OPEN_WORKSPACE_VALUE = "__open_workspace__";
const ADD_REMOTE_WORKSPACE_VALUE = "__add_remote_workspace__";
const NEW_THREAD_MARKER = "__new_thread__";

interface BackendCliPushResult {
  resource: ResourceConfig;
  resources: ResourceConfig[];
  remoteUrl: string;
  backendCliFingerprint: string;
  log: string[];
}

type BackendCliPushStreamEvent =
  | { type: "log"; message?: string }
  | { type: "done"; result?: BackendCliPushResult }
  | { type: "error"; error?: string };

interface RuntimeConfigStatus {
  desktopMode?: boolean;
  needsOnboarding?: boolean;
}

function isLocalDeploymentUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
    );
  } catch {
    return false;
  }
}

async function isLocalBackendReady(deploymentUrl: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ url: deploymentUrl });
    const response = await fetch(`/api/runtime/backend/ready?${params}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      ready?: boolean;
    } | null;
    return response.ok && payload?.ready === true;
  } catch {
    return false;
  }
}

async function shouldOpenOnboarding(): Promise<boolean> {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as
      | RuntimeConfigStatus
      | null;
    return (
      response.ok &&
      payload?.desktopMode === true &&
      payload?.needsOnboarding === true
    );
  } catch {
    return false;
  }
}

function StartupState() {
  return (
    <div className="flex h-[calc(100vh-var(--app-footer-height))] items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>InternAgents正在启动中...</span>
      </div>
    </div>
  );
}

interface HomePageInnerProps {
  config: StandaloneConfig;
  activeResource: ResourceConfig;
  activeAssistantId: string;
  activeWorkspace: LocalWorkspace | null;
  workspaces: LocalWorkspace[];
  isActiveLocalResource: boolean;
  onResourceChange: (resourceId: string) => Promise<void>;
  onWorkspaceChange: (workspaceId: string) => Promise<void>;
  onWorkspacePick: () => Promise<void>;
  onResourcesRefresh: (
    resources?: ResourceConfig[]
  ) => Promise<ResourceConfig[]>;
}

interface RemoteEnsureResult {
  resource: ResourceConfig;
  resources: ResourceConfig[];
  remoteUrl: string;
  state: "up-to-date" | "updated";
  targetReleaseTag: string;
  log: string[];
}

type RemoteEnsureStreamEvent =
  | { type: "log"; message?: string }
  | { type: "done"; result?: RemoteEnsureResult }
  | { type: "error"; error?: string };

function HomePageInner({
  config,
  activeResource,
  activeAssistantId,
  activeWorkspace,
  workspaces,
  isActiveLocalResource,
  onResourceChange,
  onWorkspaceChange,
  onWorkspacePick,
  onResourcesRefresh,
}: HomePageInnerProps) {
  const remoteAgent = useRemoteAgent();
  const searchParams = useSearchParams();
  const [threadId, setThreadId] = useQueryState("threadId");
  const [selectedFilePath, setSelectedFilePath] = useQueryState("file");

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const [ensuringResourceId, setEnsuringResourceId] = useState<string | null>(
    null
  );
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [pushingBackendCli, setPushingBackendCli] = useState(false);
  const [chatAndFileSwapped, setChatAndFileSwapped] = useState(false);
  const [chatPanelHidden, setChatPanelHidden] = useState(false);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const [workspacePanelCompact, setWorkspacePanelCompact] = useState(false);
  const workspacePanelRef = useRef<ImperativePanelHandle>(null);
  const [viewerPanelCompact, setViewerPanelCompact] = useState(false);
  const viewerPanelRef = useRef<ImperativePanelHandle>(null);
  const previousObservedThreadIdRef = useRef<string | null>(threadId ?? null);
  const intentionalThreadChangeRef = useRef<string | null>(null);
  const generatedThreadIdRef = useRef<string | null>(null);

  const fetchAssistant = useCallback(async () => {
    setAssistant(await remoteAgent.resolveAssistant());
  }, [remoteAgent]);

  useEffect(() => {
    fetchAssistant();
  }, [fetchAssistant]);

  const resetForegroundChat = useCallback(() => {
    setChatInstanceKey((key) => key + 1);
  }, []);

  const handleThreadSelect = useCallback(
    async (id: string) => {
      if (id === threadId) return;
      intentionalThreadChangeRef.current = id;
      await setThreadId(id);
      resetForegroundChat();
    },
    [resetForegroundChat, setThreadId, threadId]
  );

  const handleNewThread = useCallback(async () => {
    intentionalThreadChangeRef.current = NEW_THREAD_MARKER;
    await setThreadId(null);
    resetForegroundChat();
  }, [resetForegroundChat, setThreadId]);

  const handleGeneratedThreadId = useCallback((id: string) => {
    generatedThreadIdRef.current = id;
  }, []);

  useEffect(() => {
    const previousThreadId = previousObservedThreadIdRef.current;
    const nextThreadId = threadId ?? null;
    if (previousThreadId === nextThreadId) return;

    previousObservedThreadIdRef.current = nextThreadId;

    const intentionalThreadId = intentionalThreadChangeRef.current;
    const expectedIntentionalThreadId = nextThreadId ?? NEW_THREAD_MARKER;
    if (intentionalThreadId === expectedIntentionalThreadId) {
      intentionalThreadChangeRef.current = null;
      return;
    }

    if (generatedThreadIdRef.current === nextThreadId) {
      generatedThreadIdRef.current = null;
      return;
    }

    resetForegroundChat();
  }, [resetForegroundChat, threadId]);

  const handleFileSelect = useCallback(
    async (entry: WorkspaceEntry) => {
      if (entry.kind === "file") {
        setViewerPanelCompact(false);
        window.requestAnimationFrame(() => {
          viewerPanelRef.current?.resize(31);
        });
        await setSelectedFilePath(entry.path);
      }
    },
    [setSelectedFilePath]
  );

  const handleClearSelectedFile = useCallback(async () => {
    await setSelectedFilePath(null);
  }, [setSelectedFilePath]);

  const ensureRemoteResource = useCallback(
    async (resourceId: string) => {
      const toastId = toast.loading("正在同步远程 backend runtime...");
      try {
        const response = await fetch("/api/remote-connections/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resourceId }),
        });
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/x-ndjson")) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          toast.dismiss(toastId);
          throw new Error(payload?.error || "远程 backend runtime 同步失败");
        }
        if (!response.body) {
          toast.dismiss(toastId);
          throw new Error("远程 backend runtime 同步失败：没有返回同步日志。");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result: RemoteEnsureResult | null = null;
        let streamError: string | null = null;

        const parseLine = (line: string): RemoteEnsureStreamEvent | null => {
          const trimmed = line.trim();
          return trimmed
            ? (JSON.parse(trimmed) as RemoteEnsureStreamEvent)
            : null;
        };

        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const event = parseLine(line);
            if (!event) {
              continue;
            }
            if (event.type === "done" && event.result) {
              result = event.result;
            } else if (event.type === "error") {
              streamError = event.error || "远程 backend runtime 同步失败";
            }
          }
          if (done) break;
        }

        if (buffer.trim()) {
          const event = parseLine(buffer);
          if (event?.type === "done" && event.result) {
            result = event.result;
          } else if (event?.type === "error") {
            streamError = event.error || "远程 backend runtime 同步失败";
          }
        }

        toast.dismiss(toastId);
        if (streamError) {
          throw new Error(streamError);
        }
        if (!result) {
          throw new Error("远程 backend runtime 同步失败：没有返回结果。");
        }

        await onResourcesRefresh(result.resources);
        toast.success(
          result.state === "updated"
            ? `远程 backend 已同步到 ${result.targetReleaseTag}`
            : `远程 backend 已是 ${result.targetReleaseTag}`
        );
        return result.resource;
      } catch (error) {
        toast.dismiss(toastId);
        throw error;
      }
    },
    [onResourcesRefresh]
  );

  const handleResourceChange = useCallback(
    async (resourceId: string) => {
      try {
        setEnsuringResourceId(resourceId);
        const nextResource = config.resources.find(
          (resource) => resource.id === resourceId
        );
        if (nextResource && nextResource.id !== "local") {
          await ensureRemoteResource(resourceId);
        }
        await setThreadId(null);
        await setSelectedFilePath(null);
        await onResourceChange(resourceId);
        mutateThreads?.();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "远程工作区切换失败";
        toast.error(message);
      } finally {
        setEnsuringResourceId(null);
      }
    },
    [
      config.resources,
      ensureRemoteResource,
      mutateThreads,
      onResourceChange,
      setSelectedFilePath,
      setThreadId,
    ]
  );

  const handleWorkspaceChange = useCallback(
    async (workspaceId: string) => {
      try {
        await setThreadId(null);
        await setSelectedFilePath(null);
        await onWorkspaceChange(workspaceId);
        mutateThreads?.();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "工作区切换失败";
        toast.error(message);
      }
    },
    [mutateThreads, onWorkspaceChange, setSelectedFilePath, setThreadId]
  );

  const handleWorkspacePick = useCallback(async () => {
    try {
      setIsPickingWorkspace(true);
      await setThreadId(null);
      await setSelectedFilePath(null);
      await onWorkspacePick();
      mutateThreads?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "工作区选择失败";
      toast.error(message);
    } finally {
      setIsPickingWorkspace(false);
    }
  }, [mutateThreads, onWorkspacePick, setSelectedFilePath, setThreadId]);

  const handleEnvironmentChange = useCallback(
    async (value: string) => {
      if (value === ADD_REMOTE_WORKSPACE_VALUE) {
        setRemoteDialogOpen(true);
        return;
      }

      if (value === OPEN_WORKSPACE_VALUE) {
        await handleWorkspacePick();
        return;
      }

      if (value.startsWith("workspace:")) {
        await handleWorkspaceChange(value.slice("workspace:".length));
        return;
      }

      if (value.startsWith("resource:")) {
        await handleResourceChange(value.slice("resource:".length));
      }
    },
    [handleResourceChange, handleWorkspaceChange, handleWorkspacePick]
  );

  const handleRunActivity = useCallback(() => {
    mutateThreads?.();
    setWorkspaceRefreshKey((key) => key + 1);
  }, [mutateThreads]);

  const isActiveSshResource =
    activeResource.backend === "ssh_shell" ||
    (!isActiveLocalResource && activeResource.id !== "local");

  const handleWorkspacePanelCompactChange = useCallback((compact: boolean) => {
    setWorkspacePanelCompact(compact);
    window.requestAnimationFrame(() => {
      workspacePanelRef.current?.resize(compact ? 4 : 24);
    });
  }, []);

  const handleViewerPanelCompactChange = useCallback((compact: boolean) => {
    setViewerPanelCompact(compact);
    window.requestAnimationFrame(() => {
      viewerPanelRef.current?.resize(compact ? 4 : 31);
    });
  }, []);

  const handleSwapChatAndFilePanels = useCallback(() => {
    setChatAndFileSwapped((swapped) => !swapped);
  }, []);

  const handleToggleChatPanel = useCallback(() => {
    setChatPanelHidden((hidden) => {
      const nextHidden = !hidden;
      if (nextHidden) {
        setViewerPanelCompact(false);
      }
      window.requestAnimationFrame(() => {
        chatPanelRef.current?.resize(nextHidden ? 4 : 51);
      });
      return nextHidden;
    });
  }, []);

  const handleRemoteConfigured = useCallback(
    async (resource: ResourceConfig, resources: ResourceConfig[]) => {
      await setThreadId(null);
      await setSelectedFilePath(null);
      await onResourcesRefresh(resources);
      await onResourceChange(resource.id);
      mutateThreads?.();
    },
    [
      mutateThreads,
      onResourceChange,
      onResourcesRefresh,
      setSelectedFilePath,
      setThreadId,
    ]
  );

  const handlePushBackendCli = useCallback(async () => {
    if (!isActiveSshResource || pushingBackendCli) {
      return;
    }

    setPushingBackendCli(true);
    const toastId = toast.loading("Pushing backend CLI...");
    try {
      const response = await fetch("/api/remote-connections/push-backend-cli", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId: activeResource.id, force: true }),
      });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/x-ndjson")) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Backend CLI push failed.");
      }
      if (!response.body) {
        throw new Error("Backend CLI push failed: no log stream returned.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: BackendCliPushResult | null = null;
      let streamError: string | null = null;

      const parseLine = (line: string): BackendCliPushStreamEvent | null => {
        const trimmed = line.trim();
        return trimmed
          ? (JSON.parse(trimmed) as BackendCliPushStreamEvent)
          : null;
      };

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const event = parseLine(line);
          if (event?.type === "log" && event.message) {
            toast.loading(event.message, { id: toastId });
          } else if (event?.type === "done" && event.result) {
            result = event.result;
          } else if (event?.type === "error") {
            streamError = event.error || "Backend CLI push failed.";
          }
        }
        if (done) break;
      }

      const lastEvent = parseLine(buffer);
      if (lastEvent?.type === "log" && lastEvent.message) {
        toast.loading(lastEvent.message, { id: toastId });
      } else if (lastEvent?.type === "done" && lastEvent.result) {
        result = lastEvent.result;
      } else if (lastEvent?.type === "error") {
        streamError = lastEvent.error || "Backend CLI push failed.";
      }

      if (streamError) {
        throw new Error(streamError);
      }
      if (!result) {
        throw new Error("Backend CLI push failed: completion event missing.");
      }

      await onResourcesRefresh(result.resources);
      mutateThreads?.();
      setWorkspaceRefreshKey((key) => key + 1);
      toast.success(`${result.resource.label} backend CLI updated`, {
        id: toastId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Backend CLI push failed.";
      toast.error(message, { id: toastId });
    } finally {
      setPushingBackendCli(false);
    }
  }, [
    activeResource.id,
    isActiveSshResource,
    mutateThreads,
    onResourcesRefresh,
    pushingBackendCli,
  ]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("internagents.quickstart.autostart")
      );
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const environmentValue =
    isActiveLocalResource && activeWorkspace
      ? `workspace:${activeWorkspace.id}`
      : `resource:${activeResource.id}`;
  const remoteResources = config.resources.filter(
    (resource) => resource.id !== "local"
  );
  const environmentLabel = activeWorkspace?.label || activeResource.label;
  const configHref = useMemo(
    () => pageHrefWithWorkbenchReturn("/config", searchParams),
    [searchParams]
  );
  const skillsHref = useMemo(
    () => pageHrefWithWorkbenchReturn("/skills", searchParams),
    [searchParams]
  );
  const aboutHref = useMemo(
    () => pageHrefWithWorkbenchReturn("/about", searchParams),
    [searchParams]
  );

  const chatHeaderActions = (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
            aria-label="隐藏会话区"
            onClick={handleToggleChatPanel}
          >
            <MessageSquareOff className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="whitespace-nowrap"
        >
          隐藏会话区
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
            aria-label={
              chatAndFileSwapped
                ? "恢复会话区和文件区位置"
                : "交换会话区和文件区位置"
            }
            aria-pressed={chatAndFileSwapped}
            onClick={handleSwapChatAndFilePanels}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="center"
          sideOffset={6}
          className="whitespace-nowrap"
        >
          {chatAndFileSwapped ? "恢复会话/文件位置" : "交换会话/文件位置"}
        </TooltipContent>
      </Tooltip>
    </>
  );

  const chatPanel = (
    <ResizablePanel
      key="chat-panel"
      ref={chatPanelRef}
      id="chat"
      className={
        chatPanelHidden
          ? "relative min-w-[44px] max-w-[56px] bg-card"
          : "relative flex min-w-[420px] flex-col bg-card/70"
      }
      order={chatAndFileSwapped ? 3 : 2}
      defaultSize={chatPanelHidden ? 4 : 51}
      minSize={chatPanelHidden ? 4 : 34}
      maxSize={chatPanelHidden ? 6 : undefined}
    >
      {chatPanelHidden && (
        <div className="flex h-full w-full items-start justify-center py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-muted-foreground hover:text-primary"
            aria-label="显示会话区"
            onClick={handleToggleChatPanel}
          >
            <MessageSquare className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div
        className={cn(
          "h-full min-h-0",
          chatPanelHidden ? "hidden" : "flex min-w-0 flex-col"
        )}
      >
        <ChatProvider
          key={`${activeResource.id}:${activeAssistantId}:${
            activeWorkspace?.id || "workspace"
          }:${chatInstanceKey}`}
          activeAssistant={assistant}
          streamConfig={config.stream}
          onHistoryRevalidate={handleRunActivity}
          onGeneratedThreadId={handleGeneratedThreadId}
          resourceId={activeResource.id}
          resourceLabel={activeResource.label}
          runtimeUrl={activeResource.runtimeUrl}
          workspaceId={isActiveLocalResource ? activeWorkspace?.id : undefined}
          workspacePath={
            isActiveLocalResource ? activeWorkspace?.resolvedPath : undefined
          }
          workspaceLabel={
            isActiveLocalResource ? activeWorkspace?.label : undefined
          }
        >
          <ChatInterface
            assistant={assistant}
            headerActions={chatHeaderActions}
          />
        </ChatProvider>
      </div>
    </ResizablePanel>
  );

  const viewerPanel = (
    <ResizablePanel
      key="viewer-panel"
      ref={viewerPanelRef}
      id="viewer"
      order={chatAndFileSwapped ? 2 : 3}
      defaultSize={viewerPanelCompact ? 4 : 31}
      minSize={viewerPanelCompact ? 4 : 22}
      maxSize={viewerPanelCompact ? 6 : undefined}
      className={
        viewerPanelCompact
          ? "relative min-w-[44px] max-w-[56px] border-l border-border bg-card"
          : "relative min-w-[320px] overflow-hidden border-l border-border bg-card"
      }
    >
      <WorkspaceViewer
        key={activeWorkspace?.id || activeResource.id}
        selectedPath={selectedFilePath}
        resourceId={activeResource.id}
        workspaceId={isActiveLocalResource ? activeWorkspace?.id : undefined}
        compact={viewerPanelCompact}
        onCollapse={() => handleViewerPanelCompactChange(true)}
        onExpand={() => handleViewerPanelCompactChange(false)}
        onClear={() => void handleClearSelectedFile()}
      />
    </ResizablePanel>
  );

  return (
    <div className="internagents-home flex h-[calc(100vh-var(--app-footer-height))] flex-col bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border bg-card/95 px-5 shadow-[0_1px_0_rgba(23,36,36,0.03)]">
        <div
          className="flex min-w-0 items-center gap-3"
          data-tour="local-agent"
        >
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            InternAgents
          </h1>
          <Select
            value={environmentValue}
            onValueChange={(value) => void handleEnvironmentChange(value)}
          >
            <SelectTrigger className="h-9 w-[260px] border-border bg-background/80 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {isPickingWorkspace ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
                {ensuringResourceId ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
                <span className="min-w-0 truncate">{environmentLabel}</span>
              </span>
            </SelectTrigger>
            <SelectContent
              align="start"
              className="internagents-home w-[340px]"
            >
              <SelectGroup>
                <SelectLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  本地工作区
                </SelectLabel>
                {workspaces.map((workspace) => (
                  <SelectItem
                    key={workspace.id}
                    value={`workspace:${workspace.id}`}
                    textValue={workspace.label}
                    className="py-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{workspace.label}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {workspace.resolvedPath || workspace.path}
                      </span>
                    </span>
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem
                  value={OPEN_WORKSPACE_VALUE}
                  textValue="打开或新增本地工作区"
                  className="py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {isPickingWorkspace ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <FolderOpen className="h-4 w-4 shrink-0" />
                    )}
                    <span>打开或新增本地工作区</span>
                  </span>
                </SelectItem>
              </SelectGroup>

              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  远程工作区
                </SelectLabel>
                {remoteResources.map((resource) => (
                  <SelectItem
                    key={resource.id}
                    value={`resource:${resource.id}`}
                    textValue={resource.label}
                    className="py-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{resource.label}</span>
                      {resource.workspacePath && (
                        <span className="truncate text-xs text-muted-foreground">
                          {resource.workspacePath}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem
                  value={ADD_REMOTE_WORKSPACE_VALUE}
                  textValue="接入远程工作区"
                  className="py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Plus className="h-4 w-4 shrink-0" />
                    <span>接入远程工作区</span>
                  </span>
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          {isActiveSshResource && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 border-border bg-card"
              disabled={pushingBackendCli}
              onClick={() => void handlePushBackendCli()}
            >
              {pushingBackendCli ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              同步远端智能体
            </Button>
          )}
          {interruptCount > 0 && (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 shadow-sm shadow-orange-900/5">
              {interruptCount} interrupted
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 border-border bg-card"
          >
            <Link
              href={skillsHref}
              data-tour="nav-capabilities"
            >
              <Sparkles className="h-4 w-4" />
              能力插件
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 border-border bg-card"
          >
            <Link
              href={configHref}
              data-tour="nav-config"
            >
              <Settings className="h-4 w-4" />
              配置
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 border-border bg-card"
          >
            <Link
              href={aboutHref}
              data-tour="nav-about"
            >
              <Info className="h-4 w-4" />
              关于与更新
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden bg-background">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="standalone-chat"
        >
          <ResizablePanel
            ref={workspacePanelRef}
            id="workspace"
            order={1}
            defaultSize={workspacePanelCompact ? 4 : 18}
            minSize={workspacePanelCompact ? 4 : 13}
            maxSize={workspacePanelCompact ? 6 : 20}
            className={
              workspacePanelCompact
                ? "relative min-w-[44px] max-w-[56px] border-r border-border bg-sidebar"
                : "relative min-w-[260px] border-r border-border bg-sidebar"
            }
            data-tour="workspace-panel"
          >
            <WorkspacePanel
              key={activeWorkspace?.id || activeResource.id}
              selectedFilePath={selectedFilePath}
              onFileSelect={handleFileSelect}
              onThreadSelect={handleThreadSelect}
              onNewThread={handleNewThread}
              onMutateReady={(fn) => setMutateThreads(() => fn)}
              onInterruptCountChange={setInterruptCount}
              resourceId={activeResource.id}
              runtimeUrl={activeResource.runtimeUrl}
              assistantId={activeAssistantId}
              workspaceId={
                isActiveLocalResource ? activeWorkspace?.id : undefined
              }
              workspaceRefreshKey={workspaceRefreshKey}
              activeWorkspace={activeWorkspace}
              onCompactChange={handleWorkspacePanelCompactChange}
            />
          </ResizablePanel>
          <ResizableHandle />

          {chatAndFileSwapped ? (
            <>
              {viewerPanel}
              <ResizableHandle />
              {chatPanel}
            </>
          ) : (
            <>
              {chatPanel}
              <ResizableHandle />
              {viewerPanel}
            </>
          )}
        </ResizablePanelGroup>
      </div>
      <RemoteConnectionDialog
        open={remoteDialogOpen}
        onOpenChange={setRemoteDialogOpen}
        onConfigured={handleRemoteConfigured}
      />
    </div>
  );
}

function HomePageContent() {
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([]);
  const [localBackendReady, setLocalBackendReady] = useState(false);
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [resourceId, setResourceId] = useQueryState("resourceId");
  const [workspaceId, setWorkspaceId] = useQueryState("workspaceId");
  const [threadId, setThreadId] = useQueryState("threadId");
  const previousResourceId = useRef<string | null>(null);
  const deploymentUrl = config?.deploymentUrl;

  const refreshResources = useCallback(
    async (knownResources?: ResourceConfig[]) => {
      let nextResources = knownResources;
      let defaultResourceId: string | undefined;
      if (!nextResources) {
        const response = await fetch("/api/resources", { cache: "no-store" });
        const payload = (await response.json()) as {
          defaultResourceId?: string;
          resources?: ResourceConfig[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "工作区列表读取失败");
        }
        nextResources = payload.resources || [];
        defaultResourceId = payload.defaultResourceId;
      }
      setConfig((current) => {
        if (!current || !isLocalDeploymentUrl(current.deploymentUrl)) {
          return current;
        }
        return {
          ...current,
          resources: nextResources?.length ? nextResources : current.resources,
          defaultResourceId: defaultResourceId || current.defaultResourceId,
        };
      });
      return nextResources || [];
    },
    []
  );

  const loadWorkspaces = useCallback(async () => {
    const response = await fetch("/api/workspaces", { cache: "no-store" });
    const payload = (await response.json()) as {
      defaultWorkspaceId?: string;
      workspaces?: LocalWorkspace[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || "工作区读取失败");
    }
    const nextWorkspaces = payload.workspaces || [];
    setWorkspaces(nextWorkspaces);
    if (!workspaceId && payload.defaultWorkspaceId) {
      await setWorkspaceId(payload.defaultWorkspaceId);
    }
    return nextWorkspaces;
  }, [setWorkspaceId, workspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      if (cancelled) {
        return;
      }

      const initialConfig = getConfig();
      setConfig(initialConfig);
      if (await shouldOpenOnboarding()) {
        if (!cancelled) {
          window.location.href = "/config?onboarding=1";
        }
        return;
      }
      const initialResource = getResource(initialConfig, resourceId);
      if (!resourceId && initialResource) {
        setResourceId(initialResource.id);
      }
      if (!assistantId) {
        setAssistantId(
          initialResource?.assistantId || initialConfig.assistantId
        );
      }
      void loadWorkspaces().catch((error) => {
        const message =
          error instanceof Error ? error.message : "工作区读取失败";
        toast.error(message);
      });
      if (isLocalDeploymentUrl(initialConfig.deploymentUrl)) {
        void refreshResources().catch((error) => {
          const message =
            error instanceof Error ? error.message : "工作区列表读取失败";
          toast.error(message);
        });
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!deploymentUrl) {
      setLocalBackendReady(false);
      return;
    }

    if (!isLocalDeploymentUrl(deploymentUrl)) {
      setLocalBackendReady(true);
      return;
    }

    let cancelled = false;
    let timeoutId = 0;

    setLocalBackendReady(false);

    const poll = async () => {
      if (await isLocalBackendReady(deploymentUrl)) {
        if (!cancelled) {
          setLocalBackendReady(true);
        }
        return;
      }

      if (!cancelled) {
        timeoutId = window.setTimeout(poll, 800);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deploymentUrl]);

  useEffect(() => {
    if (!config) return;
    const selectedResource = getResource(config, resourceId);
    if (selectedResource && assistantId !== selectedResource.assistantId) {
      setAssistantId(selectedResource.assistantId);
    }
  }, [config, resourceId, assistantId, setAssistantId]);

  useEffect(() => {
    if (!config) return;
    const selectedResource = getResource(config, resourceId);
    const selectedResourceId = selectedResource?.id || null;
    if (
      previousResourceId.current &&
      selectedResourceId &&
      previousResourceId.current !== selectedResourceId &&
      threadId
    ) {
      setThreadId(null);
    }
    previousResourceId.current = selectedResourceId;
  }, [config, resourceId, threadId, setThreadId]);

  useEffect(() => {
    if (!config) return;
    const selectedResource = getResource(config, resourceId);
    if (selectedResource?.id !== "local") {
      if (workspaceId) {
        setWorkspaceId(null);
      }
      return;
    }
    if (workspaces.length === 0) return;
    if (
      !workspaceId ||
      !workspaces.some((workspace) => workspace.id === workspaceId)
    ) {
      setWorkspaceId(workspaces[0].id);
    }
  }, [config, resourceId, setWorkspaceId, workspaceId, workspaces]);

  const langsmithApiKey =
    config?.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  if (!config) {
    return <StartupState />;
  }

  if (isLocalDeploymentUrl(config.deploymentUrl) && !localBackendReady) {
    return <StartupState />;
  }

  const activeResource = getResource(config, resourceId);
  const activeAssistantId = activeResource?.assistantId || config.assistantId;
  const isActiveLocalResource = activeResource?.id === "local";
  const activeWorkspace = isActiveLocalResource
    ? workspaces.find((workspace) => workspace.id === workspaceId) ||
      workspaces[0] ||
      null
    : {
        id: `resource:${activeResource.id}`,
        label: activeResource.label,
        path: activeResource.workspacePath || "远程工作区",
        resolvedPath: activeResource.workspacePath || "远程工作区",
        resourceId: activeResource.id,
        isRemote: true,
      };

  return (
    <RemoteAgentProvider
      key={`${config.deploymentUrl}:${activeAssistantId}`}
      deploymentUrl={config.deploymentUrl}
      assistantId={activeAssistantId}
      apiKey={langsmithApiKey}
    >
      <HomePageInner
        config={config}
        activeResource={activeResource}
        activeAssistantId={activeAssistantId}
        activeWorkspace={activeWorkspace}
        workspaces={workspaces}
        isActiveLocalResource={isActiveLocalResource}
        onResourceChange={async (nextResourceId) => {
          await setResourceId(nextResourceId);
          const nextResource = getResource(config, nextResourceId);
          if (nextResource?.id !== "local") {
            await setWorkspaceId(null);
          }
        }}
        onResourcesRefresh={refreshResources}
        onWorkspaceChange={async (nextWorkspaceId) => {
          const workspace = workspaces.find(
            (candidate) => candidate.id === nextWorkspaceId
          );
          if (!workspace) {
            return;
          }
          const response = await fetch("/api/workspaces", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspacePath: workspace.resolvedPath || workspace.path,
            }),
          });
          const payload = (await response.json()) as {
            defaultWorkspaceId?: string;
            workspaces?: LocalWorkspace[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(payload.error || "工作区切换失败");
          }
          if (payload.workspaces) {
            setWorkspaces(payload.workspaces);
          }
          await setResourceId("local");
          await setWorkspaceId(payload.defaultWorkspaceId || nextWorkspaceId);
        }}
        onWorkspacePick={async () => {
          const response = await fetch("/api/workspaces", {
            method: "POST",
          });
          const payload = (await response.json()) as {
            cancelled?: boolean;
            defaultWorkspaceId?: string;
            workspaceId?: string;
            workspaces?: LocalWorkspace[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(payload.error || "工作区选择失败");
          }
          if (payload.cancelled) {
            return;
          }
          if (payload.workspaces) {
            setWorkspaces(payload.workspaces);
          }
          const nextWorkspaceId =
            payload.workspaceId || payload.defaultWorkspaceId;
          if (nextWorkspaceId) {
            await setResourceId("local");
            await setWorkspaceId(nextWorkspaceId);
          }
        }}
      />
    </RemoteAgentProvider>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100vh-var(--app-footer-height))] items-center justify-center">
          <p className="text-muted-foreground">InternAgents正在启动中...</p>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
