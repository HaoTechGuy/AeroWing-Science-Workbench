"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useQueryState } from "nuqs";
import { getConfig, StandaloneConfig } from "@/lib/config";
import { Assistant } from "@langchain/langgraph-sdk";
import {
  RemoteAgentProvider,
  useRemoteAgent,
} from "@/providers/ClientProvider";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatProvider } from "@/providers/ChatProvider";
import { ChatInterface } from "@/app/components/ChatInterface";
import { WorkspacePanel } from "@/app/components/WorkspacePanel";
import { WorkspaceViewer } from "@/app/components/WorkspaceViewer";
import type { WorkspaceEntry } from "@/app/types/workspace";

interface HomePageInnerProps {
  config: StandaloneConfig;
}

function HomePageInner({ config }: HomePageInnerProps) {
  const remoteAgent = useRemoteAgent();
  const [, setThreadId] = useQueryState("threadId");
  const [selectedFilePath, setSelectedFilePath] = useQueryState("file");

  const [mutateThreads, setMutateThreads] = useState<(() => void) | null>(null);
  const [interruptCount, setInterruptCount] = useState(0);
  const [assistant, setAssistant] = useState<Assistant | null>(null);

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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">InternAgents</h1>
          {interruptCount > 0 && (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
              {interruptCount} interrupted
            </div>
          )}
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
              selectedFilePath={selectedFilePath}
              onFileSelect={handleFileSelect}
              onThreadSelect={async (id) => {
                await setThreadId(id);
              }}
              onNewThread={() => setThreadId(null)}
              onMutateReady={(fn) => setMutateThreads(() => fn)}
              onInterruptCountChange={setInterruptCount}
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
              activeAssistant={assistant}
              streamConfig={config.stream}
              onHistoryRevalidate={() => mutateThreads?.()}
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
            <WorkspaceViewer selectedPath={selectedFilePath} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

function HomePageContent() {
  const [config, setConfig] = useState<StandaloneConfig | null>(null);
  const [assistantId, setAssistantId] = useQueryState("assistantId");

  // On mount, connect to the local LangGraph dev server by default.
  useEffect(() => {
    const initialConfig = getConfig();
    setConfig(initialConfig);
    if (!assistantId) {
      setAssistantId(initialConfig.assistantId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If config changes, update the assistantId
  useEffect(() => {
    if (config && !assistantId) {
      setAssistantId(config.assistantId);
    }
  }, [config, assistantId, setAssistantId]);

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
    <RemoteAgentProvider
      deploymentUrl={config.deploymentUrl}
      assistantId={config.assistantId}
      apiKey={langsmithApiKey}
    >
      <HomePageInner config={config} />
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
