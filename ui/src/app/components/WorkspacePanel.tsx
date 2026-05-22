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
  assistantId?: string;
  workspaceId?: string;
  workspaceRefreshKey?: number;
  activeWorkspace?: LocalWorkspace | null;
  workspaces?: LocalWorkspace[];
  onWorkspaceChange?: (workspaceId: string) => void | Promise<void>;
  onWorkspacePick?: () => void | Promise<void>;
}

export function WorkspacePanel({
  selectedFilePath,
  onFileSelect,
  onThreadSelect,
  onNewThread,
  onMutateReady,
  onInterruptCountChange,
  resourceId,
  assistantId,
  workspaceId,
  workspaceRefreshKey,
  activeWorkspace,
  workspaces = [],
  onWorkspaceChange,
  onWorkspacePick,
}: WorkspacePanelProps) {
  return (
    <div className="h-full bg-background">
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
            workspaces={workspaces}
            onWorkspaceChange={onWorkspaceChange}
            onWorkspacePick={onWorkspacePick}
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
        >
          <ThreadList
            onThreadSelect={onThreadSelect}
            onNewThread={onNewThread}
            onMutateReady={onMutateReady}
            onInterruptCountChange={onInterruptCountChange}
            resourceId={resourceId}
            assistantId={assistantId}
            workspaceId={workspaceId}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
