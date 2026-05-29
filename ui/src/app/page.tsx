"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
} from "react";
import Link from "next/link";
import { BookOpenText, Settings, Server, Sparkles } from "lucide-react";
import { useQueryState } from "nuqs";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatProvider } from "@/providers/ChatProvider";
import { Button } from "@/components/ui/button";
import { ChatInterface } from "@/app/components/ChatInterface";
import { WorkspacePanel } from "@/app/components/WorkspacePanel";
import { WorkspaceViewer } from "@/app/components/WorkspaceViewer";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";

interface HomePageInnerProps {
  config: StandaloneConfig;
  activeResource: ResourceConfig;
  activeAssistantId: string;
  activeWorkspace: LocalWorkspace | null;
  workspaces: LocalWorkspace[];
  onResourceChange: (resourceId: string) => Promise<void>;
  onWorkspaceChange: (workspaceId: string) => Promise<void>;
  onWorkspacePick: () => Promise<void>;
}

function HomePageInner({
  config,
  activeResource,
  activeAssistantId,
  activeWorkspace,
  workspaces,
  onResourceChange,
  onWorkspaceChange,
  onWorkspacePick,
}: HomePageInnerProps) {
  const remoteAgent = useRemoteAgent();
  const [, setThreadId] = useQueryState("threadId");
  const [selectedFilePath, setSelectedFilePath] = useQueryState("file");

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);

  const fetchAssistant = useCallback(async () => {
    setAssistant(await remoteAgent.resolveAssistant());
  }, [remoteAgent]);

  useEffect(() => {
    fetchAssistant();
  }, [fetchAssistant]);

  const handleFileSelect = useCallback(
    async (entry: WorkspaceEntry) => {
      if (entry.kind === "file") {
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
      await setThreadId(null);
      await setSelectedFilePath(null);
      await onWorkspacePick();
      mutateThreads?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "工作区选择失败";
      toast.error(message);
    }
  }, [mutateThreads, onWorkspacePick, setSelectedFilePath, setThreadId]);

  const handleRunActivity = useCallback(() => {
    mutateThreads?.();
    setWorkspaceRefreshKey((key) => key + 1);
  }, [mutateThreads]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-4">
          <h1 className="text-xl font-semibold">InternAgents</h1>
          <Select
            value={activeResource.id}
            onValueChange={handleResourceChange}
          >
            <SelectTrigger className="w-[210px]">
              <SelectValue placeholder="选择资源" />
            </SelectTrigger>
            <SelectContent align="start">
              {config.resources.map((resource) => (
                <SelectItem
                  key={resource.id}
                  value={resource.id}
                >
                  {resource.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="hidden truncate text-xs text-muted-foreground md:block">
            Assistant: {activeAssistantId}
          </div>
          {interruptCount > 0 && (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
              {interruptCount} interrupted
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8"
          >
            <Link href="/connect">
              <Server className="h-4 w-4" />
              连接服务器
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8"
          >
            <Link href="/knowledge">
              <BookOpenText className="h-4 w-4" />
              团队知识库
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8"
          >
            <Link href="/skills">
              <Sparkles className="h-4 w-4" />
              技能广场
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8"
          >
            <Link href="/config">
              <Settings className="h-4 w-4" />
              配置
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="standalone-chat"
        >
          <ResizablePanel
            id="workspace"
            order={1}
            defaultSize={24}
            minSize={18}
            className="relative min-w-[300px] border-r border-border"
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
              workspaceId={activeWorkspace?.id}
              workspaceRefreshKey={workspaceRefreshKey}
              activeWorkspace={activeWorkspace}
              workspaces={workspaces}
              onWorkspaceChange={handleWorkspaceChange}
              onWorkspacePick={handleWorkspacePick}
            />
          </ResizablePanel>
          <ResizableHandle />

          <ResizablePanel
            id="chat"
            className="relative flex min-w-[420px] flex-col"
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
              workspaceId={activeWorkspace?.id}
              workspacePath={activeWorkspace?.resolvedPath}
              workspaceLabel={activeWorkspace?.label}
            >
              <ChatInterface assistant={assistant} />
            </ChatProvider>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            id="viewer"
            order={3}
            defaultSize={31}
            minSize={22}
            className="relative min-w-[320px] border-l border-border"
          >
            <WorkspaceViewer
              key={activeWorkspace?.id || activeResource.id}
              selectedPath={selectedFilePath}
              resourceId={activeResource.id}
              workspaceId={activeWorkspace?.id}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
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
        setAssistantId(initialResource?.assistantId || initialConfig.assistantId);
      }
      void loadWorkspaces().catch((error) => {
        const message =
          error instanceof Error ? error.message : "工作区读取失败";
        toast.error(message);
      });
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
    if (workspaces.length === 0) return;
    if (!workspaceId || !workspaces.some((workspace) => workspace.id === workspaceId)) {
      setWorkspaceId(workspaces[0].id);
    }
  }, [setWorkspaceId, workspaceId, workspaces]);

  const langsmithApiKey =
    config?.langsmithApiKey || process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "";

  if (!config) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">
          Connecting to local InternAgents...
        </p>
      </div>
    );
  }

  const activeResource = getResource(config, resourceId);
  const activeAssistantId = activeResource?.assistantId || config.assistantId;
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === workspaceId) ||
    workspaces[0] ||
    null;

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
        onResourceChange={async (nextResourceId) => {
          await setResourceId(nextResourceId);
        }}
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
          const nextWorkspaceId = payload.workspaceId || payload.defaultWorkspaceId;
          if (nextWorkspaceId) {
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
        <div className="flex h-screen items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}
