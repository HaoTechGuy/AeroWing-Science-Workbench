"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
} from "react";
import Link from "next/link";
import {
  FolderOpen,
  Info,
  Loader2,
  Plus,
  Settings,
  UploadCloud,
} from "lucide-react";
import { useQueryState } from "nuqs";
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
import { ChatProvider } from "@/providers/ChatProvider";
import { Button } from "@/components/ui/button";
import { ChatInterface } from "@/app/components/ChatInterface";
import { RemoteConnectionDialog } from "@/app/components/RemoteConnectionDialog";
import { WorkspacePanel } from "@/app/components/WorkspacePanel";
import { WorkspaceViewer } from "@/app/components/WorkspaceViewer";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";

const OPEN_WORKSPACE_VALUE = "__open_workspace__";
const ADD_REMOTE_WORKSPACE_VALUE = "__add_remote_workspace__";

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
  const [, setThreadId] = useQueryState("threadId");
  const [selectedFilePath, setSelectedFilePath] = useQueryState("file");

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [pushingBackendCli, setPushingBackendCli] = useState(false);
  const [workspacePanelCompact, setWorkspacePanelCompact] = useState(false);
  const workspacePanelRef = useRef<ImperativePanelHandle>(null);
  const [viewerPanelCompact, setViewerPanelCompact] = useState(false);
  const viewerPanelRef = useRef<ImperativePanelHandle>(null);

  const fetchAssistant = useCallback(async () => {
    setAssistant(await remoteAgent.resolveAssistant());
  }, [remoteAgent]);

  useEffect(() => {
    fetchAssistant();
  }, [fetchAssistant]);

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

  const handleResourceChange = useCallback(
    async (resourceId: string) => {
      await setThreadId(null);
      await setSelectedFilePath(null);
      await onResourceChange(resourceId);
      mutateThreads?.();
    },
    [mutateThreads, onResourceChange, setSelectedFilePath, setThreadId]
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
              href="/config"
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
              href="/about"
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
            defaultSize={workspacePanelCompact ? 4 : 24}
            minSize={workspacePanelCompact ? 4 : 18}
            maxSize={workspacePanelCompact ? 6 : undefined}
            className={
              workspacePanelCompact
                ? "relative min-w-[44px] max-w-[56px] border-r border-border bg-sidebar"
                : "relative min-w-[300px] border-r border-border bg-sidebar"
            }
            data-tour="workspace-panel"
          >
            <WorkspacePanel
              key={activeWorkspace?.id || activeResource.id}
              selectedFilePath={selectedFilePath}
              onFileSelect={handleFileSelect}
              onThreadSelect={async (id) => {
                await setThreadId(id);
              }}
              onNewThread={() => setThreadId(null)}
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

          <ResizablePanel
            id="chat"
            className="relative flex min-w-[420px] flex-col bg-card/70"
            order={2}
            defaultSize={45}
            minSize={32}
          >
            <ChatProvider
              key={`${activeResource.id}:${activeAssistantId}:${
                activeWorkspace?.id || "workspace"
              }`}
              activeAssistant={assistant}
              streamConfig={config.stream}
              onHistoryRevalidate={handleRunActivity}
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
              <ChatInterface assistant={assistant} />
            </ChatProvider>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            ref={viewerPanelRef}
            id="viewer"
            order={3}
            defaultSize={viewerPanelCompact ? 4 : 31}
            minSize={viewerPanelCompact ? 4 : 22}
            maxSize={viewerPanelCompact ? 6 : undefined}
            className={
              viewerPanelCompact
                ? "relative min-w-[44px] max-w-[56px] border-l border-border bg-card"
                : "relative min-w-[320px] border-l border-border bg-card"
            }
          >
            <WorkspaceViewer
              key={activeWorkspace?.id || activeResource.id}
              selectedPath={selectedFilePath}
              resourceId={activeResource.id}
              workspaceId={
                isActiveLocalResource ? activeWorkspace?.id : undefined
              }
              compact={viewerPanelCompact}
              onCollapse={() => handleViewerPanelCompactChange(true)}
              onExpand={() => handleViewerPanelCompactChange(false)}
            />
          </ResizablePanel>
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
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [resourceId, setResourceId] = useQueryState("resourceId");
  const [workspaceId, setWorkspaceId] = useQueryState("workspaceId");
  const [threadId, setThreadId] = useQueryState("threadId");
  const previousResourceId = useRef<string | null>(null);

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
      try {
        const response = await fetch("/api/config", { cache: "no-store" });
        const payload = (await response.json()) as {
          needsOnboarding?: boolean;
        };
        if (!cancelled && response.ok && payload.needsOnboarding) {
          window.location.replace("/config?onboarding=1");
          return;
        }
      } catch {
        // The workspace can still render config errors through its own panels.
      }

      if (cancelled) {
        return;
      }

      const initialConfig = getConfig();
      setConfig(initialConfig);
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

    void initialize();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return (
      <div className="flex h-[calc(100vh-var(--app-footer-height))] items-center justify-center">
        <p className="text-muted-foreground">
          Connecting to local InternAgents...
        </p>
      </div>
    );
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
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
