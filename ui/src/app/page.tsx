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
  ArrowLeft,
  ChevronRight,
  Columns2,
  Eye,
  File,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  FolderOpen,
  LayoutGrid,
  Loader2,
  Plus,
  Presentation,
  Radio,
  RefreshCcw,
  Search,
  Settings,
  SlidersHorizontal,
  SquarePen,
  List,
  UploadCloud,
} from "lucide-react";
import { useQueryState } from "nuqs";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { RemoteConnectionDialog } from "@/app/components/RemoteConnectionDialog";
import { ThreadList } from "@/app/components/ThreadList";
import { WorkspaceViewer } from "@/app/components/WorkspaceViewer";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";
import { useLanguage } from "@/app/hooks/useLanguage";
import { useWorkspaceFiles } from "@/app/hooks/useWorkspaceFiles";
import {
  WORKBENCH_RETURN_STORAGE_KEY,
  pageHrefWithWorkbenchReturn,
  workbenchHrefFromSearchParams,
} from "@/app/utils/navigationContext";
import { displayResourceLabel } from "@/lib/i18n";
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
  const { t } = useLanguage();
  return (
    <div className="flex h-[calc(100vh-var(--app-footer-height))] items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t("appStarting")}</span>
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
  const { language, t } = useLanguage();
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
  const [inspectorOpen, setInspectorOpen] = useState(true);
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
        setInspectorOpen(true);
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
    const toastId = toast.loading(t("remoteRuntimeSyncing"));
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
          throw new Error(payload?.error || t("remoteRuntimeSyncFailed"));
        }
        if (!response.body) {
          toast.dismiss(toastId);
          throw new Error(t("remoteRuntimeNoLog"));
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
              streamError = event.error || t("remoteRuntimeSyncFailed");
            }
          }
          if (done) break;
        }

        if (buffer.trim()) {
          const event = parseLine(buffer);
          if (event?.type === "done" && event.result) {
            result = event.result;
          } else if (event?.type === "error") {
            streamError = event.error || t("remoteRuntimeSyncFailed");
          }
        }

        toast.dismiss(toastId);
        if (streamError) {
          throw new Error(streamError);
        }
        if (!result) {
          throw new Error(t("remoteRuntimeNoResult"));
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
    [onResourcesRefresh, t]
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
          error instanceof Error
            ? error.message
            : t("remoteProjectSwitchFailed");
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
      t,
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
          error instanceof Error ? error.message : t("projectSwitchFailed");
        toast.error(message);
      }
    },
    [mutateThreads, onWorkspaceChange, setSelectedFilePath, setThreadId, t]
  );

  const handleWorkspacePick = useCallback(async () => {
    try {
      setIsPickingWorkspace(true);
      await setThreadId(null);
      await setSelectedFilePath(null);
      await onWorkspacePick();
      mutateThreads?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("projectPickFailed");
      toast.error(message);
    } finally {
      setIsPickingWorkspace(false);
    }
  }, [mutateThreads, onWorkspacePick, setSelectedFilePath, setThreadId, t]);

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

  const environmentValue =
    isActiveLocalResource && activeWorkspace
      ? `workspace:${activeWorkspace.id}`
      : `resource:${activeResource.id}`;
  const remoteResources = config.resources.filter(
    (resource) => resource.id !== "local"
  );
  const environmentLabel =
    activeWorkspace?.label || displayResourceLabel(activeResource.label, language);
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
  const projectsHref = "/projects";

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
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="internagents-workbench-layout"
        className="ocs-workbench-panels"
      >
        <ResizablePanel
          id="workbench-sidebar"
          order={1}
          defaultSize={18}
          minSize={18}
          maxSize={28}
          className="ocs-workbench-panel"
        >
          <WorkbenchSidebar
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
            workspaces={workspaces}
            configHref={configHref}
            skillsHref={skillsHref}
            projectsHref={projectsHref}
            onEnvironmentChange={handleEnvironmentChange}
            onMutateReady={(fn) => setMutateThreads(() => fn)}
            onNewThread={handleNewThread}
            onPushBackendCli={handlePushBackendCli}
            onThreadSelect={handleThreadSelect}
          />
        </ResizablePanel>

        <ResizableHandle className="ocs-workbench-resize-handle" />

        <ResizablePanel
          id="workbench-chat"
          order={2}
          defaultSize={inspectorOpen ? 39 : 82}
          minSize={30}
          className="ocs-workbench-panel"
        >
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
              workspaceId={
                isActiveLocalResource ? activeWorkspace?.id : undefined
              }
              workspacePath={
                isActiveLocalResource
                  ? activeWorkspace?.resolvedPath
                  : undefined
              }
              workspaceLabel={
                isActiveLocalResource ? activeWorkspace?.label : undefined
              }
            >
              <ChatInterface
                assistant={assistant}
                headerActions={
                  !inspectorOpen ? (
                    <button
                      type="button"
                      className="ocs-split-toggle"
                      onClick={() => setInspectorOpen(true)}
                      title={t("openInspector")}
                      aria-label={t("openInspector")}
                    >
                      <Columns2 className="h-4 w-4" />
                    </button>
                  ) : null
                }
              />
            </ChatProvider>
          </section>
        </ResizablePanel>

        {inspectorOpen && (
          <>
            <ResizableHandle className="ocs-workbench-resize-handle" />

            <ResizablePanel
              id="workbench-inspector"
              order={3}
              defaultSize={43}
              minSize={22}
              className="ocs-workbench-panel"
            >
              <WorkbenchInspector
                activeResource={activeResource}
                activeWorkspace={activeWorkspace}
                selectedFilePath={selectedFilePath}
                workspaceRefreshKey={workspaceRefreshKey}
                workspaceId={
                  isActiveLocalResource ? activeWorkspace?.id : undefined
                }
                onClearSelectedFile={handleClearSelectedFile}
                onClose={() => setInspectorOpen(false)}
                onFileSelect={handleFileSelect}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      <RemoteConnectionDialog
        open={remoteDialogOpen}
        onOpenChange={setRemoteDialogOpen}
        onConfigured={handleRemoteConfigured}
      />
    </div>
  );
}

interface WorkbenchSidebarProps {
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
  workspaces: LocalWorkspace[];
  configHref: string;
  skillsHref: string;
  projectsHref: string;
  onEnvironmentChange: (value: string) => Promise<void>;
  onMutateReady: (mutate: () => void) => void;
  onNewThread: () => Promise<void>;
  onPushBackendCli: () => void;
  onThreadSelect: (id: string) => void;
}

function WorkbenchSidebar({
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
  workspaces,
  configHref,
  skillsHref,
  projectsHref,
  onEnvironmentChange,
  onMutateReady,
  onNewThread,
  onPushBackendCli,
  onThreadSelect,
}: WorkbenchSidebarProps) {
  const { language, t } = useLanguage();
  const runtimeLabel = isActiveLocalResource ? t("local") : t("remote");

  return (
    <aside
      className="ocs-sidebar"
    >
      <section className="ocs-brand">
        <Link
          href={projectsHref}
          className="ocs-project-list-link"
          aria-label={t("backToProjects")}
        >
          <ArrowLeft size={15} />
          <span>{t("projectList")}</span>
        </Link>
        <div>
          <h1>InternAgentS</h1>
          <span>{t("projectWorkbench")}</span>
        </div>
      </section>

      <section
        className="ocs-project-picker"
      >
        <div className="ocs-project-picker-label">
          <span>{t("currentProject")}</span>
          <span>{runtimeLabel}</span>
        </div>
        <Select
          value={environmentValue}
          onValueChange={(value) => void onEnvironmentChange(value)}
        >
          <SelectTrigger className="ocs-project-trigger">
            <span className="ocs-project-trigger-content">
              {isPickingWorkspace || ensuringResourceId ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className="ocs-project-status-dot"
                  aria-hidden="true"
                />
              )}
              <span className="ocs-project-name">{environmentLabel}</span>
            </span>
          </SelectTrigger>
          <SelectContent
            align="start"
            className="internagents-home ocs-select-content w-[340px]"
          >
            <SelectGroup>
              <SelectLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {t("localProjects")}
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
                textValue={t("openOrCreateLocalProject")}
                className="py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {isPickingWorkspace ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4 shrink-0" />
                  )}
                  <span>{t("openOrCreateLocalProject")}</span>
                </span>
              </SelectItem>
            </SelectGroup>

            <SelectSeparator />
            <SelectGroup>
              <SelectLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {t("remoteProjects")}
              </SelectLabel>
              {remoteResources.map((resource) => (
                <SelectItem
                  key={resource.id}
                  value={`resource:${resource.id}`}
                  textValue={displayResourceLabel(resource.label, language)}
                  className="py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                      {displayResourceLabel(resource.label, language)}
                    </span>
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
                textValue={t("connectRemoteProject")}
                className="py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Plus className="h-4 w-4 shrink-0" />
                  <span>{t("connectRemoteProject")}</span>
                </span>
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </section>

      <nav
        className="ocs-primary-actions"
        aria-label="project actions"
      >
        <button
          type="button"
          onClick={() => void onNewThread()}
        >
          <SquarePen size={18} />
          <span>{t("newThread")}</span>
        </button>
        <Link
          href={skillsHref}
        >
          <SlidersHorizontal size={18} />
          <span>{t("customize")}</span>
        </Link>
        <Link
          href={configHref}
        >
          <Settings size={18} />
          <span>{t("settings")}</span>
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
            <span>{t("syncRemote")}</span>
          </button>
        )}
      </nav>

      <div className="ocs-sidebar-body">
        <div className="ocs-panel-fill">
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
      </div>

      <footer className="ocs-sidebar-footer">
        <Link
          href={configHref}
          aria-label={t("settings")}
        >
          <Settings size={18} />
        </Link>
        <span>
          <Radio size={14} />
          {runtimeLabel}
        </span>
      </footer>
    </aside>
  );
}

type WorkbenchInspectorMode = "files" | "preview";
type InspectorFilesViewMode = "grid" | "list";

interface WorkbenchInspectorProps {
  activeResource: ResourceConfig;
  activeWorkspace: LocalWorkspace | null;
  selectedFilePath?: string | null;
  workspaceRefreshKey: number;
  workspaceId?: string;
  onClearSelectedFile: () => Promise<void>;
  onClose: () => void;
  onFileSelect: (entry: WorkspaceEntry) => void | Promise<void>;
}

interface InspectorFilesViewProps {
  selectedFilePath?: string | null;
  resourceId: string;
  workspaceId?: string;
  refreshKey: number;
  onFileSelect: (entry: WorkspaceEntry) => void | Promise<void>;
}

function formatInspectorBytes(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InspectorEntryIcon({ entry }: { entry: WorkspaceEntry }) {
  if (entry.kind === "directory") {
    return <Folder className="h-4 w-4" />;
  }

  if (entry.previewKind === "markdown") {
    return <FileText className="h-4 w-4" />;
  }

  if (entry.previewKind === "pdf") {
    return <FileText className="h-4 w-4" />;
  }

  if (entry.previewKind === "docx") {
    return <FileText className="h-4 w-4" />;
  }

  if (entry.previewKind === "xlsx") {
    return <FileSpreadsheet className="h-4 w-4" />;
  }

  if (entry.previewKind === "pptx") {
    return <Presentation className="h-4 w-4" />;
  }

  if (entry.extension === ".json") {
    return <FileJson className="h-4 w-4" />;
  }

  if (
    [".js", ".jsx", ".py", ".ts", ".tsx", ".sh"].includes(
      entry.extension || ""
    )
  ) {
    return <FileCode2 className="h-4 w-4" />;
  }

  return <File className="h-4 w-4" />;
}

function matchesInspectorFilter(entry: WorkspaceEntry, filter: string): boolean {
  if (!filter) return true;
  return entry.path.toLowerCase().includes(filter);
}

function InspectorFilesView({
  selectedFilePath,
  resourceId,
  workspaceId,
  refreshKey,
  onFileSelect,
}: InspectorFilesViewProps) {
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
  const [viewMode, setViewMode] = useState<InspectorFilesViewMode>("grid");

  const normalizedFilter = filter.trim().toLowerCase();
  const rootEntries = useMemo(() => directories[""] ?? [], [directories]);
  const rootLoading = loadingPaths.has("") && rootEntries.length === 0;

  const visibleEntries = useMemo(() => {
    const hasMatchingDescendant = (entry: WorkspaceEntry): boolean => {
      const children = directories[entry.path] ?? [];
      return children.some(
        (child) =>
          matchesInspectorFilter(child, normalizedFilter) ||
          hasMatchingDescendant(child)
      );
    };

    const walk = (
      entries: WorkspaceEntry[],
      depth: number
    ): Array<{ entry: WorkspaceEntry; depth: number }> => {
      return entries.flatMap((entry) => {
        const matches = matchesInspectorFilter(entry, normalizedFilter);
        const childrenMatch =
          entry.kind === "directory" && hasMatchingDescendant(entry);
        if (!matches && !childrenMatch) {
          return [];
        }

        const isExpanded =
          entry.kind === "directory" &&
          (expandedPaths.has(entry.path) || Boolean(normalizedFilter));
        const children = isExpanded
          ? walk(directories[entry.path] ?? [], depth + 1)
          : [];

        return [{ entry, depth }, ...children];
      });
    };

    return walk(rootEntries, 0);
  }, [directories, expandedPaths, normalizedFilter, rootEntries]);

  const handleEntryClick = useCallback(
    async (entry: WorkspaceEntry) => {
      if (entry.kind === "directory") {
        await toggleDirectory(entry.path);
        return;
      }

      await onFileSelect(entry);
    },
    [onFileSelect, toggleDirectory]
  );

  return (
    <section className="ocs-inspector-files">
      <div className="ocs-inspector-files-toolbar">
        <div className="ocs-inspector-search">
          <Search className="h-3.5 w-3.5" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("filterFiles")}
          />
        </div>
        <div className="ocs-inspector-view-toggle">
          <button
            type="button"
            className={cn(viewMode === "grid" && "active")}
            onClick={() => setViewMode("grid")}
            title={t("gridView")}
            aria-label={t("gridView")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            type="button"
            className={cn(viewMode === "list" && "active")}
            onClick={() => setViewMode("list")}
            title={t("listView")}
            aria-label={t("listView")}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            title={t("refreshProjectFiles")}
            aria-label={t("refreshProjectFiles")}
          >
            <RefreshCcw size={15} />
          </button>
        </div>
      </div>

      {error && <div className="ocs-inspector-file-error">{error}</div>}

      {rootLoading ? (
        <div className="ocs-inspector-empty">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      ) : visibleEntries.length === 0 ? (
        <div className="ocs-inspector-empty">{t("noMatchingFiles")}</div>
      ) : viewMode === "grid" ? (
        <div className="ocs-inspector-file-grid">
          {visibleEntries.map(({ entry, depth }) => {
            const isDirectory = entry.kind === "directory";
            const isExpanded = expandedPaths.has(entry.path);
            const isSelected = selectedFilePath === entry.path;

            return (
              <button
                key={entry.path}
                type="button"
                className={cn(
                  "ocs-inspector-file-card",
                  isSelected && "active"
                )}
                onClick={() => void handleEntryClick(entry)}
                title={entry.path}
              >
                <span className="ocs-inspector-file-icon">
                  {isDirectory ? (
                    <FolderOpen
                      className={cn("h-4 w-4", !isExpanded && "opacity-60")}
                    />
                  ) : (
                    <InspectorEntryIcon entry={entry} />
                  )}
                </span>
                <span className="ocs-inspector-file-name">{entry.name}</span>
                <span className="ocs-inspector-file-meta">
                  {isDirectory
                    ? t("folder")
                    : formatInspectorBytes(entry.size) ||
                      entry.previewKind ||
                      t("files")}
                </span>
                {depth > 0 && (
                  <span className="ocs-inspector-file-path">{entry.path}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="ocs-inspector-file-list">
          {visibleEntries.map(({ entry, depth }) => {
            const isDirectory = entry.kind === "directory";
            const isExpanded = expandedPaths.has(entry.path);
            const isLoading = loadingPaths.has(entry.path);
            const isSelected = selectedFilePath === entry.path;

            return (
              <button
                key={entry.path}
                type="button"
                className={cn("ocs-inspector-file-row", isSelected && "active")}
                style={{ paddingLeft: `${10 + depth * 16}px` }}
                onClick={() => void handleEntryClick(entry)}
                title={entry.path}
              >
                <span className="ocs-inspector-file-expander">
                  {isDirectory &&
                    (isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ChevronRight
                        className={cn(
                          "h-4 w-4",
                          isExpanded && "rotate-90"
                        )}
                      />
                    ))}
                </span>
                <span className="ocs-inspector-file-icon">
                  <InspectorEntryIcon entry={entry} />
                </span>
                <span className="ocs-inspector-file-name">{entry.name}</span>
                <span className="ocs-inspector-file-meta">
                  {isDirectory ? t("folder") : formatInspectorBytes(entry.size)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WorkbenchInspector({
  activeResource,
  activeWorkspace,
  selectedFilePath,
  workspaceRefreshKey,
  workspaceId,
  onClearSelectedFile,
  onClose,
  onFileSelect,
}: WorkbenchInspectorProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<WorkbenchInspectorMode>(
    selectedFilePath ? "preview" : "files"
  );
  const previousSelectedFilePathRef = useRef<string | null>(
    selectedFilePath ?? null
  );
  const selectedName = displayPathName(selectedFilePath, t("filePreview"));

  useEffect(() => {
    const previousSelectedFilePath = previousSelectedFilePathRef.current;
    const nextSelectedFilePath = selectedFilePath ?? null;
    if (previousSelectedFilePath === nextSelectedFilePath) {
      return;
    }

    previousSelectedFilePathRef.current = nextSelectedFilePath;
    if (selectedFilePath) {
      setMode("preview");
    } else {
      setMode((currentMode) =>
        currentMode === "preview" ? "files" : currentMode
      );
    }
  }, [selectedFilePath]);

  return (
    <aside className="ocs-inspector">
      <header className="ocs-inspector-header">
        <div>
          <span className="ocs-eyebrow">
            {mode === "files" ? t("projectFiles") : t("artifact")}
          </span>
          <h3>
            {mode === "files"
              ? t("projectFiles")
              : selectedFilePath
                ? selectedName
                : t("noArtifactOpen")}
          </h3>
        </div>
        <button
          type="button"
          className="ocs-inspector-close"
          onClick={onClose}
          title={t("closeInspector")}
          aria-label={t("closeInspector")}
        >
          <Columns2 className="h-4 w-4" />
        </button>
      </header>

      <div className="ocs-version-bar">
        <button
          type="button"
          className={cn(mode === "files" && "active")}
          onClick={() => setMode("files")}
        >
          <Files size={15} />
          {t("files")}
        </button>
        <button
          type="button"
          className={cn(mode === "preview" && "active")}
          onClick={() => setMode("preview")}
          disabled={!selectedFilePath}
        >
          <Eye size={15} />
          {t("preview")}
        </button>
      </div>

      {mode === "files" && (
        <div className="ocs-inspector-content">
          <InspectorFilesView
            selectedFilePath={selectedFilePath}
            resourceId={activeResource.id}
            workspaceId={workspaceId}
            refreshKey={workspaceRefreshKey}
            onFileSelect={onFileSelect}
          />
        </div>
      )}

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

    </aside>
  );
}

function displayPathName(path: string | null | undefined, fallback: string): string {
  if (!path) return fallback;
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function HomePageContent() {
  const { t } = useLanguage();
  const router = useRouter();
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
          throw new Error(payload.error || t("projectListReadFailed"));
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
    [t]
  );

  const loadWorkspaces = useCallback(async () => {
    const response = await fetch("/api/workspaces", { cache: "no-store" });
    const payload = (await response.json()) as {
      defaultWorkspaceId?: string;
      workspaces?: LocalWorkspace[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload.error || t("projectReadFailed"));
    }
    const nextWorkspaces = payload.workspaces || [];
    setWorkspaces(nextWorkspaces);
    return nextWorkspaces;
  }, [t]);

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
      const shouldOpenProjectList =
        isLocalDeploymentUrl(initialConfig.deploymentUrl) &&
        (!initialResource || initialResource.id === "local") &&
        !workspaceId;
      if (shouldOpenProjectList) {
        if (!cancelled) {
          router.replace("/projects");
        }
        return;
      }
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
          error instanceof Error ? error.message : t("projectReadFailed");
        toast.error(message);
      });
      if (isLocalDeploymentUrl(initialConfig.deploymentUrl)) {
        void refreshResources().catch((error) => {
          const message =
            error instanceof Error ? error.message : t("projectListReadFailed");
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
    if (!workspaceId) {
      router.replace("/projects");
      return;
    }
    if (workspaces.length > 0) {
      const workspaceExists = workspaces.some(
        (workspace) => workspace.id === workspaceId
      );
      if (!workspaceExists) {
        router.replace("/projects");
      }
    }
  }, [config, resourceId, router, setWorkspaceId, workspaceId, workspaces]);

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
    ? workspaces.find((workspace) => workspace.id === workspaceId) || null
    : {
        id: `resource:${activeResource.id}`,
        label: activeResource.label,
        path: activeResource.workspacePath || t("remoteProject"),
        resolvedPath: activeResource.workspacePath || t("remoteProject"),
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
            throw new Error(payload.error || t("projectSwitchFailed"));
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
            throw new Error(payload.error || t("projectPickFailed"));
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

function StartupFallback() {
  const { t } = useLanguage();
  return (
    <div className="flex h-[calc(100vh-var(--app-footer-height))] items-center justify-center">
      <p className="text-muted-foreground">{t("appStarting")}</p>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<StartupFallback />}>
      <HomePageContent />
    </Suspense>
  );
}
