"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import {
  type Message,
  type Assistant,
  type Checkpoint,
} from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
import type { ChatAttachment, GoalState, TodoItem } from "@/app/types/types";
import type { StreamConfig } from "@/lib/config";
import { useRemoteAgent } from "@/providers/ClientProvider";
import { useQueryState } from "nuqs";
import { useStreamEventLayer } from "@/app/hooks/useStreamEventLayer";

type RunConfig = Record<string, any>;
type ParsedGoalCommand = {
  objective: string;
  tokenBudget?: number;
};

const MAX_GOAL_OBJECTIVE_CHARS = 4_000;

export type StateType = {
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, string>;
  goal?: GoalState | null;
  email?: {
    id?: string;
    subject?: string;
    page_content?: string;
  };
  ui?: any;
};

type LangGraphContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: string | { url: string; detail?: "auto" | "low" | "high" };
    };

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentMetadata(attachments: ChatAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    truncated: attachment.truncated,
    error: attachment.error,
  }));
}

function buildMessageContent(content: string, attachments: ChatAttachment[]) {
  const validAttachments = attachments.filter(
    (attachment) => !attachment.error
  );
  if (validAttachments.length === 0) {
    return content;
  }

  const blocks: LangGraphContentBlock[] = [
    {
      type: "text",
      text: content.trim() || "请查看附件。",
    },
  ];

  for (const attachment of validAttachments) {
    if (attachment.kind === "image" && attachment.dataUrl) {
      blocks.push({
        type: "image_url",
        image_url: { url: attachment.dataUrl },
      });
      continue;
    }

    if (attachment.kind === "text" && attachment.text !== undefined) {
      blocks.push({
        type: "text",
        text: [
          `<attachment name="${attachment.name}" mime_type="${
            attachment.mimeType
          }" size="${formatAttachmentSize(attachment.size)}">`,
          attachment.truncated
            ? `${attachment.text}\n\n[Attachment truncated before sending.]`
            : attachment.text,
          "</attachment>",
        ].join("\n"),
      });
      continue;
    }

    blocks.push({
      type: "text",
      text: `[附件: ${attachment.name}, type=${
        attachment.mimeType || "unknown"
      }, size=${formatAttachmentSize(attachment.size)}. 二进制内容未内嵌。]`,
    });
  }

  return blocks;
}

function parseGoalCommand(content: string): ParsedGoalCommand | null {
  const match = content.trim().match(/^\/goal(?:\s+([\s\S]+))?$/i);
  const rawObjective = match?.[1]?.trim();
  if (!rawObjective || rawObjective.length > MAX_GOAL_OBJECTIVE_CHARS) {
    return null;
  }

  const budgetMatch = rawObjective.match(
    /^(?:--tokens|--token-budget)\s+(\d+)\s+([\s\S]+)$/i
  );
  if (!budgetMatch) {
    return { objective: rawObjective };
  }

  const tokenBudget = Number.parseInt(budgetMatch[1], 10);
  const objective = budgetMatch[2].trim();
  if (!objective || !Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
    return { objective: rawObjective };
  }

  return { objective, tokenBudget };
}

function createGoalState(
  goalCommand: ParsedGoalCommand,
  threadId: string
): GoalState {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: uuidv4(),
    threadId,
    objective: goalCommand.objective,
    status: "active",
    tokenBudget: goalCommand.tokenBudget ?? null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function useChat({
  activeAssistant,
  streamConfig,
  onHistoryRevalidate,
  thread,
  resourceId,
  resourceLabel,
  workspaceId,
  workspacePath,
  workspaceLabel,
}: {
  activeAssistant: Assistant | null;
  streamConfig: StreamConfig;
  onHistoryRevalidate?: () => void;
  thread?: UseStreamThread<StateType>;
  resourceId?: string;
  resourceLabel?: string;
  workspaceId?: string;
  workspacePath?: string;
  workspaceLabel?: string;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const remoteAgent = useRemoteAgent();
  const client = remoteAgent.client;
  const streamEventLayer = useStreamEventLayer(remoteAgent);
  const { clearStreamEvents } = streamEventLayer;

  const streamSubmitOptions = useMemo(
    () => remoteAgent.getStreamSubmitOptions(streamConfig),
    [remoteAgent, streamConfig]
  );

  const workspaceMetadata = useMemo(
    () => ({
      ...(resourceId ? { resource_id: resourceId } : {}),
      ...(resourceLabel ? { resource_label: resourceLabel } : {}),
      ...(workspaceId ? { internagents_workspace_id: workspaceId } : {}),
      ...(workspacePath ? { internagents_workspace_path: workspacePath } : {}),
      ...(workspaceLabel ? { internagents_workspace_label: workspaceLabel } : {}),
    }),
    [resourceId, resourceLabel, workspaceId, workspacePath, workspaceLabel]
  );

  const buildRunConfig = useCallback(
    (overrides: RunConfig = {}) => {
      const base = (activeAssistant?.config || {}) as RunConfig;
      return {
        ...base,
        ...overrides,
        configurable: {
          ...(base.configurable || {}),
          ...workspaceMetadata,
          ...(overrides.configurable || {}),
        },
        metadata: {
          ...(base.metadata || {}),
          ...workspaceMetadata,
          ...(overrides.metadata || {}),
        },
      };
    },
    [activeAssistant?.config, workspaceMetadata]
  );

  const withStreamSubmitOptions = useCallback(
    <T extends object>(options: T) => ({
      ...streamSubmitOptions,
      ...options,
    }),
    [streamSubmitOptions]
  );

  const stream = useStream<StateType>({
    assistantId: activeAssistant?.assistant_id || "",
    client: client ?? undefined,
    reconnectOnMount: true,
    threadId: threadId ?? null,
    onThreadId: setThreadId,
    defaultHeaders: { "x-auth-scheme": "langsmith" },
    // Enable fetching state history when switching to existing threads
    fetchStateHistory: true,
    // Revalidate thread list when stream finishes, errors, or creates new thread
    onFinish: onHistoryRevalidate,
    onError: onHistoryRevalidate,
    onCreated: onHistoryRevalidate,
    experimental_thread: thread,
  });

  const streamScopeKey = useMemo(
    () =>
      [
        remoteAgent.url,
        activeAssistant?.assistant_id || "",
        resourceId || "",
        workspaceId || "",
        threadId || "__new_thread__",
      ].join("|"),
    [
      remoteAgent.url,
      activeAssistant?.assistant_id,
      resourceId,
      workspaceId,
      threadId,
    ]
  );
  const previousStreamScopeKey = useRef<string | null>(null);

  useEffect(() => {
    if (previousStreamScopeKey.current === streamScopeKey) return;
    previousStreamScopeKey.current = streamScopeKey;
    if (!stream.isLoading) {
      clearStreamEvents();
    }
  }, [streamScopeKey, stream.isLoading, clearStreamEvents]);

  const sendMessage = useCallback(
    (content: string, attachments: ChatAttachment[] = []) => {
      const goalCommand = parseGoalCommand(content);
      const existingGoal = threadId ? stream.values.goal : null;
      const shouldSeedGoal = Boolean(goalCommand && !existingGoal);
      const seededGoalThreadId = shouldSeedGoal ? threadId ?? uuidv4() : null;
      const seededGoal =
        shouldSeedGoal && goalCommand && seededGoalThreadId
          ? createGoalState(goalCommand, seededGoalThreadId)
          : null;
      const messageContent = seededGoal ? seededGoal.objective : content;
      const additionalKwargs = {
        ...(attachments.length > 0
          ? { attachments: attachmentMetadata(attachments) }
          : {}),
        ...(seededGoal
          ? {
              internagents_goal_command: {
                original_content: content,
                goal_id: seededGoal.id,
              },
            }
          : {}),
      };
      const newMessage: Message = {
        id: uuidv4(),
        type: "human",
        content: buildMessageContent(
          messageContent,
          attachments
        ) as Message["content"],
        additional_kwargs:
          Object.keys(additionalKwargs).length > 0
            ? additionalKwargs
            : undefined,
      };
      clearStreamEvents();
      stream.submit(
        {
          messages: [newMessage],
          ...(seededGoal ? { goal: seededGoal } : {}),
        },
        withStreamSubmitOptions({
          metadata: workspaceMetadata,
          ...(seededGoalThreadId && !threadId
            ? { threadId: seededGoalThreadId }
            : {}),
          optimisticValues: (prev: StateType) => ({
            messages: [...(prev.messages ?? []), newMessage],
            ...(seededGoal ? { goal: seededGoal } : {}),
          }),
          config: buildRunConfig({ recursion_limit: 100 }),
          ...(seededGoal ? { durability: "async" as const } : {}),
        })
      );
      // Update thread list immediately when sending a message
      onHistoryRevalidate?.();
    },
    [
      stream,
      clearStreamEvents,
      withStreamSubmitOptions,
      buildRunConfig,
      onHistoryRevalidate,
      workspaceMetadata,
      threadId,
    ]
  );

  const runSingleStep = useCallback(
    (
      messages: Message[],
      checkpoint?: Checkpoint,
      isRerunningSubagent?: boolean,
      optimisticMessages?: Message[]
    ) => {
      clearStreamEvents();
      if (checkpoint) {
        stream.submit(
          undefined,
          withStreamSubmitOptions({
            ...(optimisticMessages
              ? { optimisticValues: { messages: optimisticMessages } }
              : {}),
            checkpoint: checkpoint,
            ...(isRerunningSubagent
              ? { interruptAfter: ["tools"] }
              : { interruptBefore: ["tools"] }),
            config: buildRunConfig(),
          })
        );
      } else {
        stream.submit(
          { messages },
          withStreamSubmitOptions({
            config: buildRunConfig(),
            interruptBefore: ["tools"],
          })
        );
      }
    },
    [
      stream,
      clearStreamEvents,
      withStreamSubmitOptions,
      buildRunConfig,
    ]
  );

  const setFiles = useCallback(
    async (files: Record<string, string>) => {
      if (!threadId) return;
      // TODO: missing a way how to revalidate the internal state
      // I think we do want to have the ability to externally manage the state
      await remoteAgent.updateState(threadId, { files });
    },
    [remoteAgent, threadId]
  );

  const continueStream = useCallback(
    (hasTaskToolCall?: boolean) => {
      clearStreamEvents();
      stream.submit(
        undefined,
        withStreamSubmitOptions({
          config: {
            ...buildRunConfig(),
            recursion_limit: 100,
          },
          ...(hasTaskToolCall
            ? { interruptAfter: ["tools"] }
            : { interruptBefore: ["tools"] }),
        })
      );
      // Update thread list when continuing stream
      onHistoryRevalidate?.();
    },
    [
      stream,
      clearStreamEvents,
      withStreamSubmitOptions,
      buildRunConfig,
      onHistoryRevalidate,
    ]
  );

  const markCurrentThreadAsResolved = useCallback(() => {
    stream.submit(null, { command: { goto: "__end__", update: null } });
    // Update thread list when marking thread as resolved
    onHistoryRevalidate?.();
  }, [stream, onHistoryRevalidate]);

  const resumeInterrupt = useCallback(
    (value: any) => {
      clearStreamEvents();
      stream.submit(
        null,
        withStreamSubmitOptions({
          command: { resume: value },
          config: buildRunConfig(),
        })
      );
      // Update thread list when resuming from interrupt
      onHistoryRevalidate?.();
    },
    [
      stream,
      clearStreamEvents,
      withStreamSubmitOptions,
      buildRunConfig,
      onHistoryRevalidate,
    ]
  );

  const stopStream = useCallback(() => {
    stream.stop();
  }, [stream]);

  return {
    stream,
    todos: stream.values.todos ?? [],
    files: stream.values.files ?? {},
    goal: stream.values.goal ?? null,
    email: stream.values.email,
    ui: stream.values.ui,
    setFiles,
    messages: stream.messages,
    error: stream.error,
    isLoading: stream.isLoading,
    isThreadLoading: stream.isThreadLoading,
    interrupt: stream.interrupt ?? streamEventLayer.interrupt,
    getMessagesMetadata: stream.getMessagesMetadata,
    streamEvents: streamEventLayer.streamEvents,
    clearStreamEvents: streamEventLayer.clearStreamEvents,
    lastUpdateNamespace: streamEventLayer.lastUpdateNamespace,
    sendMessage,
    runSingleStep,
    continueStream,
    stopStream,
    markCurrentThreadAsResolved,
    resumeInterrupt,
  };
}
