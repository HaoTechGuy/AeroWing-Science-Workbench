"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useQueryState } from "nuqs";
import { getConfig, getResource, StandaloneConfig } from "@/lib/config";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Assistant } from "@langchain/langgraph-sdk";
import { ClientProvider, useClient } from "@/providers/ClientProvider";
import { MessagesSquare, SquarePen } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ThreadList } from "@/app/components/ThreadList";
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";

interface HomePageInnerProps {
  config: StandaloneConfig;
}

type AssistantStatus = "loading" | "ready" | "fallback";

function createGraphAssistant(graphId: string): Assistant {
  return {
    assistant_id: graphId,
    graph_id: graphId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    config: {},
    metadata: {},
    version: 1,
    name: graphId,
    context: {},
  };
}

function HomePageInner({ config }: HomePageInnerProps) {
  const client = useClient();
  const [, setThreadId] = useQueryState("threadId");
  const [sidebar, setSidebar] = useQueryState("sidebar");
  const [resourceId, setResourceId] = useQueryState("resourceId");
  const activeResource = getResource(config, resourceId);
  const activeAssistantId = activeResource?.assistantId || config.assistantId;

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [assistantStatus, setAssistantStatus] =
    useState<AssistantStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    const graphAssistant = createGraphAssistant(activeAssistantId);
    setAssistantStatus("loading");
    // Keep chat usable while the default assistant UUID is being resolved.
    setAssistant(graphAssistant);

    const loadAssistant = async () => {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        activeAssistantId
      );

      if (isUUID) {
        try {
          const data = await client.assistants.get(activeAssistantId);
          if (cancelled) return;
          setAssistant(data);
          setAssistantStatus("ready");
        } catch (error) {
          if (cancelled) return;
          console.error("Failed to fetch assistant:", error);
          setAssistant(graphAssistant);
          setAssistantStatus("fallback");
        }
        return;
      }

      try {
        const assistants = await client.assistants.search({
          graphId: activeAssistantId,
          limit: 100,
        });
        const defaultAssistant = assistants.find(
          (assistant) => assistant.metadata?.["created_by"] === "system"
        );
        if (defaultAssistant === undefined) {
          throw new Error("No default assistant found");
        }
        if (cancelled) return;
        setAssistant(defaultAssistant);
        setAssistantStatus("ready");
      } catch (error) {
        if (cancelled) return;
        console.error(
          "Failed to find default assistant from graph_id; falling back to graph id:",
          error
        );
        setAssistant(graphAssistant);
        setAssistantStatus("fallback");
      }
    };

    loadAssistant();
    return () => {
      cancelled = true;
    };
  }, [client, activeAssistantId]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">InternAgents</h1>
          {!sidebar && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebar("1")}
              className="rounded-md border border-border bg-card p-3 text-foreground hover:bg-accent"
            >
              <MessagesSquare className="mr-2 h-4 w-4" />
              Threads
              {interruptCount > 0 && (
                <span className="ml-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
                  {interruptCount}
                </span>
              )}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={activeResource?.id || config.defaultResourceId}
            onValueChange={async (value) => {
              const nextResource =
                config.resources.find((resource) => resource.id === value) ||
                activeResource;
              const nextAssistantId =
                nextResource?.assistantId || config.assistantId;
              setAssistantStatus("loading");
              setAssistant(createGraphAssistant(nextAssistantId));
              await setThreadId(null);
              await setResourceId(value);
              mutateThreads?.();
            }}
          >
            <SelectTrigger className="w-[210px]">
              <SelectValue placeholder="Select resource" />
            </SelectTrigger>
            <SelectContent align="end">
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
          <div className="text-sm text-muted-foreground">
            <span className="font-medium">Assistant:</span> {activeAssistantId}
            <span className="ml-2 text-xs">
              {assistantStatus === "ready"
                ? "ready"
                : assistantStatus === "loading"
                ? "loading..."
                : "fallback"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setThreadId(null)}
            className="border-[#2F6868] bg-[#2F6868] text-white hover:bg-[#2F6868]/80"
          >
            <SquarePen className="mr-2 h-4 w-4" />
            New Thread
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="standalone-chat"
        >
          {sidebar && (
            <>
              <ResizablePanel
                id="thread-history"
                order={1}
                defaultSize={25}
                minSize={20}
                className="relative min-w-[380px]"
              >
                <ThreadList
                  onThreadSelect={async (id) => {
                    await setThreadId(id);
                  }}
                  onMutateReady={(fn) => setMutateThreads(() => fn)}
                  onClose={() => setSidebar(null)}
                  onInterruptCountChange={setInterruptCount}
                  resourceId={activeResource?.id}
                  assistantId={activeAssistantId}
                />
              </ResizablePanel>
              <ResizableHandle />
            </>
          )}

          <ResizablePanel
            id="chat"
            className="relative flex flex-col"
            order={2}
          >
            <ChatProvider
              key={`${activeResource?.id || "default"}:${activeAssistantId}`}
              activeAssistant={assistant}
              onHistoryRevalidate={() => mutateThreads?.()}
              resourceId={activeResource?.id}
              resourceLabel={activeResource?.label}
            >
              <ChatInterface
                assistant={assistant}
                assistantStatus={assistantStatus}
                resourceLabel={activeResource?.label}
                activeAssistantId={activeAssistantId}
              />
            </ChatProvider>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function HomePageContent() {
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [assistantId, setAssistantId] = useQueryState("assistantId");
  const [resourceId, setResourceId] = useQueryState("resourceId");
  const [threadId, setThreadId] = useQueryState("threadId");
  const previousResourceId = useRef<string | null>(null);

  // On mount, connect to the local LangGraph dev server by default.
  useEffect(() => {
    const initialConfig = getConfig();
    setConfig(initialConfig);
    const initialResource = getResource(initialConfig, resourceId);
    if (!resourceId && initialResource) {
      setResourceId(initialResource.id);
    }
    if (!assistantId) {
      setAssistantId(initialResource?.assistantId || initialConfig.assistantId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If config changes, update the assistantId
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

  return (
    <ClientProvider
      deploymentUrl={config.deploymentUrl}
      apiKey={langsmithApiKey}
    >
      <HomePageInner config={config} />
    </ClientProvider>
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
