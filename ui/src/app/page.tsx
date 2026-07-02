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
  Beaker,
  Eye,
  Files,
  FolderOpen,
  History,
  Info,
  Loader2,
  Plus,
  Radio,
  Settings,
  Sparkles,
  SquarePen,
  UploadCloud,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
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
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { RemoteConnectionDialog } from "@/app/components/RemoteConnectionDialog";
import { ThreadList } from "@/app/components/ThreadList";
import { WorkspaceExplorer } from "@/app/components/WorkspaceExplorer";
import { WorkspaceViewer } from "@/app/components/WorkspaceViewer";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";
import {
  WORKBENCH_RETURN_STORAGE_KEY,
  pageHrefWithWorkbenchReturn,
  workbenchHrefFromSearchParams,
} from "@/app/utils/navigationContext";
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
    const payload = (await response
      .json()
      .catch(() => null)) as RuntimeConfigStatus | null;
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
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const [ensuringResourceId, setEnsuringResourceId] = useState<string | null>(
    null
  );
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [pushingBackendCli, setPushingBackendCli] = useState(false);
  const [sidebarMode, setSidebarMode] =
    useState<WorkbenchSidebarMode>("sessions");
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
  const currentWorkbenchHref = useMemo(
    () => workbenchHrefFromSearchParams(searchParams),
    [searchParams]
  );
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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKBENCH_RETURN_STORAGE_KEY,
        currentWorkbenchHref
      );
    } catch {
      // Ignore storage failures; explicit returnTo links still carry context.
    }
  }, [currentWorkbenchHref]);

  return (
    <div className="internagents-home ocs-app-shell">
      <WorkbenchSidebar
        mode={sidebarMode}
        setMode={setSidebarMode}
        activeAssistantId={activeAssistantId}
        activeResource={activeResource}
        activeWorkspace={activeWorkspace}
        environmentLabel={environmentLabel}
        environmentValue={environmentValue}
        isActiveLocalResource={isActiveLocalResource}
        isActiveSshResource={isActiveSshResource}
        isPickingWorkspace={isPickingWorkspace}
        ensuringResourceId={ensuringResourceId}
        pushingBackendCli={pushingBackendCli}
        remoteResources={remoteResources}
        selectedFilePath={selectedFilePath}
        workspaceRefreshKey={workspaceRefreshKey}
        workspaces={workspaces}
        configHref={configHref}
        skillsHref={skillsHref}
        aboutHref={aboutHref}
        onEnvironmentChange={handleEnvironmentChange}
        onFileSelect={handleFileSelect}
        onMutateReady={(fn) => setMutateThreads(() => fn)}
        onNewThread={handleNewThread}
        onPushBackendCli={handlePushBackendCli}
        onThreadSelect={handleThreadSelect}
      />

      <section className="ocs-workspace">
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
          <ChatInterface assistant={assistant} />
        </ChatProvider>
      </section>

      <WorkbenchInspector
        activeAssistantId={activeAssistantId}
        activeResource={activeResource}
        activeWorkspace={activeWorkspace}
        isActiveLocalResource={isActiveLocalResource}
        selectedFilePath={selectedFilePath}
        threadId={threadId}
        workspaceId={isActiveLocalResource ? activeWorkspace?.id : undefined}
        onClearSelectedFile={handleClearSelectedFile}
        configHref={configHref}
        skillsHref={skillsHref}
        aboutHref={aboutHref}
      />

      <RemoteConnectionDialog
        open={remoteDialogOpen}
        onOpenChange={setRemoteDialogOpen}
        onConfigured={handleRemoteConfigured}
      />
    </div>
  );
}

type WorkbenchSidebarMode = "sessions" | "files" | "settings";

interface WorkbenchSidebarProps {
  mode: WorkbenchSidebarMode;
  setMode: (mode: WorkbenchSidebarMode) => void;
  activeAssistantId: string;
  activeResource: ResourceConfig;
  activeWorkspace: LocalWorkspace | null;
  environmentLabel: string;
  environmentValue: string;
  isActiveLocalResource: boolean;
  isActiveSshResource: boolean;
  isPickingWorkspace: boolean;
  ensuringResourceId: string | null;
  pushingBackendCli: boolean;
  remoteResources: ResourceConfig[];
  selectedFilePath?: string | null;
  workspaceRefreshKey: number;
  workspaces: LocalWorkspace[];
  configHref: string;
  skillsHref: string;
  aboutHref: string;
  onEnvironmentChange: (value: string) => Promise<void>;
  onFileSelect: (entry: WorkspaceEntry) => void;
  onMutateReady: (mutate: () => void) => void;
  onNewThread: () => Promise<void>;
  onPushBackendCli: () => void;
  onThreadSelect: (id: string) => void;
}

function WorkbenchSidebar({
  mode,
  setMode,
  activeAssistantId,
  activeResource,
  activeWorkspace,
  environmentLabel,
  environmentValue,
  isActiveLocalResource,
  isActiveSshResource,
  isPickingWorkspace,
  ensuringResourceId,
  pushingBackendCli,
  remoteResources,
  selectedFilePath,
  workspaceRefreshKey,
  workspaces,
  configHref,
  skillsHref,
  aboutHref,
  onEnvironmentChange,
  onFileSelect,
  onMutateReady,
  onNewThread,
  onPushBackendCli,
  onThreadSelect,
}: WorkbenchSidebarProps) {
  const runtimeLabel = isActiveLocalResource ? "local" : "remote";

  return (
    <aside
      className="ocs-sidebar"
      data-tour="workspace-panel"
    >
      <section className="ocs-brand">
        <div>
          <h1>InternAgents</h1>
          <span>agent workbench</span>
        </div>
        <Beaker size={24} />
      </section>

      <section
        className="ocs-project-picker"
        data-tour="local-agent"
      >
        <span>Project</span>
        <Select
          value={environmentValue}
          onValueChange={(value) => void onEnvironmentChange(value)}
        >
          <SelectTrigger className="ocs-project-trigger">
            <span className="flex min-w-0 items-center gap-2">
              {isPickingWorkspace || ensuringResourceId ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : null}
              <span className="min-w-0 truncate">{environmentLabel}</span>
            </span>
          </SelectTrigger>
          <SelectContent
            align="start"
            className="internagents-home ocs-select-content w-[340px]"
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
      </section>

      <nav
        className="ocs-primary-actions"
        aria-label="workspace actions"
      >
        <button
          type="button"
          onClick={() => void onNewThread()}
        >
          <SquarePen size={18} />
          <span>New</span>
        </button>
        <Link
          href={skillsHref}
          data-tour="nav-capabilities"
        >
          <Sparkles size={18} />
          <span>Capabilities</span>
        </Link>
        <Link
          href={configHref}
          data-tour="nav-config"
        >
          <Settings size={18} />
          <span>Config</span>
        </Link>
        <button
          id="workspace-files"
          type="button"
          onClick={() => setMode("files")}
        >
          <Files size={18} />
          <span>Files</span>
        </button>
        <Link
          href={aboutHref}
          data-tour="nav-about"
        >
          <Info size={18} />
          <span>About</span>
        </Link>
        {isActiveSshResource && (
          <button
            type="button"
            disabled={pushingBackendCli}
            onClick={onPushBackendCli}
          >
            {pushingBackendCli ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud size={18} />
            )}
            <span>Sync remote</span>
          </button>
        )}
      </nav>

      <div className="ocs-sidebar-tabs">
        {(["sessions", "files", "settings"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={cn(mode === item && "active")}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="ocs-sidebar-body">
        {mode === "sessions" && (
          <div
            className="ocs-panel-fill"
            data-tour="thread-list"
          >
            <ThreadList
              onThreadSelect={onThreadSelect}
              onNewThread={onNewThread}
              onMutateReady={onMutateReady}
              resourceId={activeResource.id}
              runtimeUrl={activeResource.runtimeUrl}
              assistantId={activeAssistantId}
              workspaceId={isActiveLocalResource ? activeWorkspace?.id : undefined}
            />
          </div>
        )}
        {mode === "files" && (
          <div className="ocs-panel-fill">
            <WorkspaceExplorer
              key={activeWorkspace?.id || activeResource.id}
              selectedPath={selectedFilePath}
              resourceId={activeResource.id}
              workspaceId={isActiveLocalResource ? activeWorkspace?.id : undefined}
              refreshKey={workspaceRefreshKey}
              activeWorkspace={activeWorkspace}
              onFileSelect={onFileSelect}
            />
          </div>
        )}
        {mode === "settings" && (
          <WorkbenchSidebarSettings
            aboutHref={aboutHref}
            configHref={configHref}
            skillsHref={skillsHref}
            activeAssistantId={activeAssistantId}
            activeResource={activeResource}
            activeWorkspace={activeWorkspace}
          />
        )}
      </div>

      <footer className="ocs-sidebar-footer">
        <button
          type="button"
          onClick={() => setMode("settings")}
          aria-label="Settings"
        >
          <Settings size={18} />
        </button>
        <span>
          <Radio size={14} />
          {runtimeLabel}
        </span>
      </footer>
    </aside>
  );
}

interface WorkbenchSidebarSettingsProps {
  aboutHref: string;
  configHref: string;
  skillsHref: string;
  activeAssistantId: string;
  activeResource: ResourceConfig;
  activeWorkspace: LocalWorkspace | null;
}

function WorkbenchSidebarSettings({
  aboutHref,
  configHref,
  skillsHref,
  activeAssistantId,
  activeResource,
  activeWorkspace,
}: WorkbenchSidebarSettingsProps) {
  return (
    <section className="ocs-sidebar-settings">
      <Settings size={18} />
      <p>Current runtime and workspace controls.</p>
      <div className="ocs-settings-row">
        <span>Assistant</span>
        <em>{activeAssistantId}</em>
      </div>
      <div className="ocs-settings-row">
        <span>Resource</span>
        <em>{activeResource.label}</em>
      </div>
      <div className="ocs-settings-row">
        <span>Workspace</span>
        <em>{activeWorkspace?.label ?? "remote"}</em>
      </div>
      <Link href={configHref}>
        <Settings size={16} />
        配置
      </Link>
      <Link href={skillsHref}>
        <Sparkles size={16} />
        能力插件
      </Link>
      <Link href={aboutHref}>
        <Info size={16} />
        关于与更新
      </Link>
    </section>
  );
}

type WorkbenchInspectorMode = "preview" | "provenance" | "settings";

interface WorkbenchInspectorProps {
  activeAssistantId: string;
  activeResource: ResourceConfig;
  activeWorkspace: LocalWorkspace | null;
  isActiveLocalResource: boolean;
  selectedFilePath?: string | null;
  threadId?: string | null;
  workspaceId?: string;
  configHref: string;
  skillsHref: string;
  aboutHref: string;
  onClearSelectedFile: () => Promise<void>;
}

function WorkbenchInspector({
  activeAssistantId,
  activeResource,
  activeWorkspace,
  isActiveLocalResource,
  selectedFilePath,
  threadId,
  workspaceId,
  configHref,
  skillsHref,
  aboutHref,
  onClearSelectedFile,
}: WorkbenchInspectorProps) {
  const [mode, setMode] = useState<WorkbenchInspectorMode>("preview");
  const selectedName = displayPathName(selectedFilePath);

  return (
    <aside className="ocs-inspector">
      <header className="ocs-inspector-header">
        <div>
          <span className="ocs-eyebrow">Artifact</span>
          <h3>{selectedFilePath ? selectedName : "No artifact open"}</h3>
        </div>
        <Files size={22} />
      </header>

      <div className="ocs-artifact-strip">
        <button
          type="button"
          className={cn(selectedFilePath && "active")}
          onClick={() => setMode("preview")}
        >
          <Files size={14} />
          {selectedFilePath ? selectedName : "File preview"}
        </button>
        <button
          type="button"
          onClick={() => setMode("settings")}
        >
          <Radio size={14} />
          {activeResource.label}
        </button>
      </div>

      <div className="ocs-version-bar">
        <button
          type="button"
          className={cn(mode === "preview" && "active")}
          onClick={() => setMode("preview")}
        >
          <Eye size={15} />
          Preview
        </button>
        <button
          type="button"
          className={cn(mode === "provenance" && "active")}
          onClick={() => setMode("provenance")}
        >
          <History size={15} />
          Provenance
        </button>
        <button
          type="button"
          className={cn(mode === "settings" && "active")}
          onClick={() => setMode("settings")}
        >
          <Settings size={15} />
          Settings
        </button>
      </div>

      {mode === "preview" && (
        <div className="ocs-inspector-content ocs-inspector-preview">
          <WorkspaceViewer
            key={activeWorkspace?.id || activeResource.id}
            selectedPath={selectedFilePath}
            resourceId={activeResource.id}
            workspaceId={workspaceId}
            onClear={() => void onClearSelectedFile()}
          />
        </div>
      )}

      {mode === "provenance" && (
        <section className="ocs-provenance-panel">
          <nav>
            <button
              type="button"
              className="active"
            >
              messages
            </button>
            <button type="button">runtime</button>
            <button type="button">files</button>
          </nav>
          <article className="ocs-execution-record">
            <strong>Thread</strong>
            <code>{threadId || "new thread"}</code>
          </article>
          <article className="ocs-execution-record">
            <strong>Workspace</strong>
            <code>
              {activeWorkspace?.resolvedPath ||
                activeWorkspace?.path ||
                activeResource.workspacePath ||
                "remote workspace"}
            </code>
          </article>
          <article className="ocs-execution-record">
            <strong>Selected file</strong>
            <code>{selectedFilePath || "No file selected"}</code>
          </article>
        </section>
      )}

      {mode === "settings" && (
        <section className="ocs-settings-inspector">
          <section>
            <h4>Runtime</h4>
            <div className="ocs-settings-row">
              <span>Resource</span>
              <em>{activeResource.label}</em>
            </div>
            <div className="ocs-settings-row">
              <span>Backend</span>
              <em>{activeResource.backend || "local"}</em>
            </div>
            <div className="ocs-settings-row">
              <span>Assistant</span>
              <em>{activeAssistantId}</em>
            </div>
            <div className="ocs-settings-row">
              <span>Scope</span>
              <em>{isActiveLocalResource ? "local" : "remote"}</em>
            </div>
          </section>
          <section>
            <h4>Navigation</h4>
            <Link href={configHref}>配置</Link>
            <Link href={skillsHref}>能力插件</Link>
            <Link href={aboutHref}>关于与更新</Link>
          </section>
        </section>
      )}
    </aside>
  );
}

function displayPathName(path?: string | null): string {
  if (!path) return "File preview";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
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
