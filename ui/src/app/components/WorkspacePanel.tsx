"use client";

import { ThreadList } from "@/app/components/ThreadList";
import { WorkspaceExplorer } from "@/app/components/WorkspaceExplorer";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { LocalWorkspace, WorkspaceEntry } from "@/app/types/workspace";

interface WorkspacePanelProps {
  selectedFilePath?: string | null;
  onFileSelect: (entry: WorkspaceEntry) => void;
  onThreadSelect: (id: string) => void;
  onNewThread?: () => void;
  onMutateReady?: (mutate: () => void) => void;
  onInterruptCountChange?: (count: number) => void;
  resourceId?: string;
  runtimeUrl?: string;
  assistantId?: string;
  workspaceId?: string;
  workspaceRefreshKey?: number;
  activeWorkspace?: LocalWorkspace | null;
}

export function WorkspacePanel({
  selectedFilePath,
  onFileSelect,
  onThreadSelect,
  onNewThread,
  onMutateReady,
  onInterruptCountChange,
  resourceId,
  runtimeUrl,
  assistantId,
  workspaceId,
  workspaceRefreshKey,
  activeWorkspace,
}: WorkspacePanelProps) {
  return (
    <div className="h-full bg-sidebar">
      <ResizablePanelGroup
        direction="vertical"
        autoSaveId="internagents-left-panel"
      >
        <ResizablePanel
          id="workspace-files"
          order={1}
          defaultSize={54}
          minSize={28}
          className="relative min-h-[220px]"
        >
          <WorkspaceExplorer
            selectedPath={selectedFilePath}
            resourceId={resourceId}
            workspaceId={workspaceId}
            refreshKey={workspaceRefreshKey}
            activeWorkspace={activeWorkspace}
            onFileSelect={onFileSelect}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id="workspace-threads"
          order={2}
          defaultSize={46}
          minSize={26}
          className="relative min-h-[220px]"
          data-tour="thread-list"
        >
          <ThreadList
            onThreadSelect={onThreadSelect}
            onNewThread={onNewThread}
            onMutateReady={onMutateReady}
            onInterruptCountChange={onInterruptCountChange}
            resourceId={resourceId}
            runtimeUrl={runtimeUrl}
            assistantId={assistantId}
            workspaceId={workspaceId}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
