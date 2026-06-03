"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStream } from "@langchain/langgraph-sdk/react";
import {
  Client,
  type Message,
  type Assistant,
  type Checkpoint,
  type Thread,
  type ThreadState,
} from "@langchain/langgraph-sdk";
import { v4 as uuidv4 } from "uuid";
import type { UseStreamThread } from "@langchain/langgraph-sdk/react";
import type { ChatAttachment, GoalState, TodoItem } from "@/app/types/types";
import type { StreamConfig } from "@/lib/config";
import { useRemoteAgent } from "@/providers/ClientProvider";
import { useQueryState } from "nuqs";
import { useStreamEventLayer } from "@/app/hooks/useStreamEventLayer";
import {
  inferThreadTitle,
  THREAD_TITLE_METADATA_KEY,
  THREAD_TITLE_UPDATED_AT_METADATA_KEY,
} from "@/app/utils/threadTitle";

type RunConfig = Record<string, any>;
type ParsedGoalCommand = {
  objective: string;
  tokenBudget?: number;
};
type RunLifecycleStatus =
  | "idle"
  | "running"
  | "completed"
  | "interrupted"
  | "error"
  | "stopped";
type RunLifecycle = {
  status: RunLifecycleStatus;
  updatedAt?: number;
  runId?: string;
  threadId?: string;
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

function threadToState(
  threadId: string,
  thread: Thread<StateType>
): ThreadState<StateType> {
  const rawValues =
    thread.values && typeof thread.values === "object" ? thread.values : {};
  const values = rawValues as Partial<StateType>;

  return {
    values: {
      ...values,
      messages: Array.isArray(values.messages) ? values.messages : [],
    } as StateType,
    next: [],
    tasks: [],
    metadata:
      thread.metadata && typeof thread.metadata === "object"
        ? (thread.metadata as Record<string, unknown>)
        : {},
    created_at: thread.updated_at,
    checkpoint: {
      thread_id: threadId,
      checkpoint_ns: "",
      checkpoint_id: null,
      checkpoint_map: {},
    },
    parent_checkpoint: null,
  };
}

function messagesFromValues(values: unknown): Message[] {
  if (!values || typeof values !== "object") {
    return [];
  }
  const messages = (values as Partial<StateType>).messages;
  return Array.isArray(messages) ? messages : [];
}

function stateHasMessages(
  state?: ThreadState<StateType> | null
): state is ThreadState<StateType> {
  return messagesFromValues(state?.values).length > 0;
}

function findStateWithMessages(
  states: ThreadState<StateType>[]
): ThreadState<StateType> | undefined {
  return states.find((state) => stateHasMessages(state));
}

function stateHasInterrupts(state?: ThreadState<StateType> | null): boolean {
  const values = state?.values as Record<string, unknown> | undefined;
  if (
    Array.isArray(values?.__interrupt__) &&
    values.__interrupt__.length > 0
  ) {
    return true;
  }

  return (
    state?.tasks?.some((task: any) => {
      return Array.isArray(task?.interrupts) && task.interrupts.length > 0;
    }) ?? false
  );
}

function sanitizeThreadState(
  state: ThreadState<StateType>
): ThreadState<StateType> {
  return {
    ...state,
    checkpoint: {
      ...state.checkpoint,
      checkpoint_map: state.checkpoint.checkpoint_map ?? {},
    },
    parent_checkpoint: state.parent_checkpoint
      ? {
          ...state.parent_checkpoint,
          checkpoint_map: state.parent_checkpoint.checkpoint_map ?? {},
        }
      : null,
  };
}

function mergeStateValues(
  state: ThreadState<StateType>,
  values: unknown
): ThreadState<StateType> {
  const incomingValues =
    values && typeof values === "object" ? (values as Partial<StateType>) : {};
  const nextValues = {
    ...state.values,
    ...incomingValues,
  };

  return sanitizeThreadState({
    ...state,
    values: {
      ...nextValues,
      messages: Array.isArray(nextValues.messages) ? nextValues.messages : [],
    } as StateType,
  });
}

function mergeThreadRecord(
  state: ThreadState<StateType>,
  thread: Thread<StateType>
): ThreadState<StateType> {
  const mergedState = mergeStateValues(state, thread.values);
  const threadMetadata =
    thread.metadata && typeof thread.metadata === "object"
      ? (thread.metadata as Record<string, unknown>)
      : {};

  return sanitizeThreadState({
    ...mergedState,
    metadata: {
      ...(mergedState.metadata || {}),
      ...threadMetadata,
    },
  });
}

async function loadThreadSnapshot({
  client,
  runtimeClient,
  threadId,
}: {
  client: ReturnType<typeof useRemoteAgent>["client"];
  runtimeClient: Client<StateType> | null;
  threadId: string;
}): Promise<ThreadState<StateType>[]> {
  let primaryState: ThreadState<StateType> | null = null;
  let primaryError: unknown;

  try {
    const mainState = sanitizeThreadState(
      await client.threads.getState<StateType>(threadId)
    );
    primaryState = mainState;
  } catch (error) {
    primaryError = error;
  }

  try {
    const threadRecord = await client.threads.get<StateType>(threadId);
    const threadState = primaryState
      ? mergeThreadRecord(primaryState, threadRecord)
      : threadToState(threadId, threadRecord);
    if (stateHasMessages(threadState)) {
      return [sanitizeThreadState(threadState)];
    }
    primaryState = threadState;
  } catch (error) {
    primaryError ??= error;
  }

  if (stateHasMessages(primaryState)) {
    return [sanitizeThreadState(primaryState)];
  }

  try {
    const mainHistory = await client.threads.getHistory<StateType>(threadId, {
      limit: 80,
    });
    const sanitizedHistory = mainHistory.map(sanitizeThreadState);
    const mainStateWithMessages = findStateWithMessages(sanitizedHistory);
    if (mainStateWithMessages) {
      return [mainStateWithMessages];
    }
    if (!primaryState && sanitizedHistory[0]) {
      primaryState = sanitizedHistory[0];
    }
  } catch (error) {
    // The latest thread record above is enough for normal main-service threads.
    primaryError ??= error;
  }

  if (runtimeClient) {
    try {
      const runtimeThread = await runtimeClient.threads.get<StateType>(
        threadId
      );
      const runtimeState = threadToState(threadId, runtimeThread);
      if (stateHasMessages(runtimeState)) {
        return [
          primaryState
            ? mergeStateValues(primaryState, runtimeState.values)
            : sanitizeThreadState(runtimeState),
        ];
      }
    } catch {
      // Runtime may not know about every main-service thread.
    }

    try {
      const runtimeHistory = await runtimeClient.threads.getHistory<StateType>(
        threadId,
        { limit: 80 }
      );
      const runtimeStateWithMessages = findStateWithMessages(runtimeHistory);
      if (runtimeStateWithMessages) {
        return [
          primaryState
            ? mergeStateValues(primaryState, runtimeStateWithMessages.values)
            : sanitizeThreadState(runtimeStateWithMessages),
        ];
      }
    } catch {
      // Keep the primary snapshot below if runtime history is unavailable.
    }
  }

  if (primaryState) {
    return [sanitizeThreadState(primaryState)];
  }
  throw primaryError;
}

function useThreadSnapshot({
  client,
  runtimeClient,
  threadId,
  externalThread,
}: {
  client: ReturnType<typeof useRemoteAgent>["client"];
  runtimeClient: Client<StateType> | null;
  threadId: string | null;
  externalThread?: UseStreamThread<StateType>;
}): UseStreamThread<StateType> | undefined {
  const requestIdRef = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    data: ThreadState<StateType>[] | null | undefined;
    error: unknown;
    isLoading: boolean;
  }>({
    data: undefined,
    error: undefined,
    isLoading: false,
  });

  const mutate = useCallback(
    async (mutateId?: string) => {
      const targetThreadId = mutateId ?? threadId;
      const requestId = ++requestIdRef.current;

      if (!targetThreadId) {
        const empty = {
          data: undefined,
          error: undefined,
          isLoading: false,
        };
        setSnapshot(empty);
        return empty.data;
      }

      setSnapshot((current) => ({
        ...current,
        data: undefined,
        error: undefined,
        isLoading: true,
      }));

      try {
        const data = await loadThreadSnapshot({
          client,
          runtimeClient,
          threadId: targetThreadId,
        });
        if (requestIdRef.current === requestId) {
          setSnapshot({
            data,
            error: undefined,
            isLoading: false,
          });
        }
        return data;
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setSnapshot((current) => ({
            ...current,
            error,
            isLoading: false,
          }));
        }
        throw error;
      }
    },
    [client, runtimeClient, threadId]
  );

  useEffect(() => {
    if (externalThread) {
      return;
    }
    void mutate(threadId ?? undefined);
  }, [externalThread, mutate, threadId]);

  return useMemo(() => {
    if (externalThread) {
      return externalThread;
    }
    return {
      data: snapshot.data,
      error: snapshot.error,
      isLoading: snapshot.isLoading,
      mutate,
    };
  }, [
    externalThread,
    mutate,
    snapshot.data,
    snapshot.error,
    snapshot.isLoading,
  ]);
}

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
    workspacePath: attachment.workspacePath,
    pageCount: attachment.pageCount,
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

    if (attachment.kind === "pdf") {
      const pathHint = attachment.workspacePath
        ? ` path="${attachment.workspacePath}"`
        : "";
      const pagesHint = attachment.pageCount
        ? ` pages="${attachment.pageCount}"`
        : "";
      const extractedText = attachment.text?.trim();
      const body = extractedText
        ? attachment.truncated
          ? `${extractedText}\n\n[PDF text truncated before sending. The original PDF is available at ${
              attachment.workspacePath || "the workspace path above"
            }.]`
          : extractedText
        : `[PDF uploaded. The original file is available at ${
            attachment.workspacePath || "the workspace path above"
          }. No extractable text was found in the uploaded PDF.]`;
      blocks.push({
        type: "text",
        text: [
          `<attachment name="${attachment.name}" mime_type="${
            attachment.mimeType || "application/pdf"
          }" size="${formatAttachmentSize(
            attachment.size
          )}"${pathHint}${pagesHint}>`,
          body,
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
  runtimeUrl,
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
  runtimeUrl?: string;
  workspaceId?: string;
  workspacePath?: string;
  workspaceLabel?: string;
}) {
  const [threadId, setThreadId] = useQueryState("threadId");
  const [optimisticThreadTitle, setOptimisticThreadTitle] = useState<
    string | null
  >(null);
  const [runLifecycle, setRunLifecycle] = useState<RunLifecycle>({
    status: "idle",
  });
  const previousThreadIdRef = useRef<string | null>(threadId ?? null);
  const pendingNewThreadTitleRef = useRef<string | null>(null);
  const pendingNewThreadTitleThreadIdRef = useRef<string | null>(null);
  const remoteAgent = useRemoteAgent();
  const client = remoteAgent.client;
  const runtimeClient = useMemo(
    () =>
      runtimeUrl
        ? new Client<StateType>({
            apiUrl: runtimeUrl,
            defaultHeaders: { "Content-Type": "application/json" },
          })
        : null,
    [runtimeUrl]
  );
  const streamEventLayer = useStreamEventLayer(remoteAgent, threadId ?? null);
  const { clearStreamEvents } = streamEventLayer;
  const markRunStarting = useCallback(() => {
    setRunLifecycle({
      status: "running",
      updatedAt: Date.now(),
    });
  }, []);
  const threadSnapshot = useThreadSnapshot({
    client,
    runtimeClient,
    threadId: threadId ?? null,
    externalThread: thread,
  });
  const threadMetadata = useMemo(() => {
    const metadata = threadSnapshot?.data?.[0]?.metadata;
    return metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  }, [threadSnapshot?.data]);

  useEffect(() => {
    const previousThreadId = previousThreadIdRef.current;
    const nextThreadId = threadId ?? null;

    if (previousThreadId === nextThreadId) return;

    previousThreadIdRef.current = nextThreadId;
    const shouldCarryPendingTitle =
      Boolean(nextThreadId) &&
      pendingNewThreadTitleThreadIdRef.current === nextThreadId &&
      Boolean(pendingNewThreadTitleRef.current);

    if (!shouldCarryPendingTitle) {
      pendingNewThreadTitleRef.current = null;
      pendingNewThreadTitleThreadIdRef.current = null;
      setOptimisticThreadTitle(null);
    }
  }, [threadId]);

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
      ...(workspaceLabel
        ? { internagents_workspace_label: workspaceLabel }
        : {}),
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

  const handleStreamCreated = useCallback(
    (run?: { run_id?: string; thread_id?: string }) => {
      setRunLifecycle({
        status: "running",
        updatedAt: Date.now(),
        runId: run?.run_id,
        threadId: run?.thread_id,
      });
      onHistoryRevalidate?.();
    },
    [onHistoryRevalidate]
  );

  const handleStreamFinish = useCallback(
    (
      state: ThreadState<StateType>,
      run?: { run_id?: string; thread_id?: string }
    ) => {
      setRunLifecycle({
        status: stateHasInterrupts(state) ? "interrupted" : "completed",
        updatedAt: Date.now(),
        runId: run?.run_id,
        threadId: run?.thread_id,
      });
      onHistoryRevalidate?.();
    },
    [onHistoryRevalidate]
  );

  const handleStreamError = useCallback(
    (_error: unknown, run?: { run_id?: string; thread_id?: string }) => {
      setRunLifecycle({
        status: "error",
        updatedAt: Date.now(),
        runId: run?.run_id,
        threadId: run?.thread_id,
      });
      onHistoryRevalidate?.();
    },
    [onHistoryRevalidate]
  );

  const handleStreamStop = useCallback(() => {
    setRunLifecycle((current) => ({
      ...current,
      status: "stopped",
      updatedAt: Date.now(),
    }));
  }, []);

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
    onFinish: handleStreamFinish,
    onError: handleStreamError,
    onCreated: handleStreamCreated,
    onStop: handleStreamStop,
    experimental_thread: threadSnapshot,
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
      setRunLifecycle({ status: "idle" });
    }
  }, [streamScopeKey, stream.isLoading, clearStreamEvents]);

  const sendMessage = useCallback(
    (content: string, attachments: ChatAttachment[] = []) => {
      const goalCommand = parseGoalCommand(content);
      const existingGoal = threadId ? stream.values.goal : null;
      const hasActiveGoal = existingGoal?.status === "active";
      const shouldSeedGoal = Boolean(goalCommand && !hasActiveGoal);
      const pendingNewThreadTitle = pendingNewThreadTitleRef.current;
      const newThreadId =
        !threadId && (shouldSeedGoal || pendingNewThreadTitle)
          ? uuidv4()
          : null;
      const seededGoalThreadId = shouldSeedGoal
        ? threadId ?? newThreadId ?? uuidv4()
        : null;
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
      markRunStarting();
      if (newThreadId && pendingNewThreadTitle) {
        pendingNewThreadTitleThreadIdRef.current = newThreadId;
      }
      stream.submit(
        {
          messages: [newMessage],
          ...(seededGoal ? { goal: seededGoal } : {}),
        },
        withStreamSubmitOptions({
          metadata: workspaceMetadata,
          ...(newThreadId ? { threadId: newThreadId } : {}),
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
      markRunStarting,
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
      markRunStarting();
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
      markRunStarting,
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

  const isThreadScopedStateLoading = Boolean(
    threadId && (stream.isThreadLoading || threadSnapshot?.isLoading)
  );
  const scopedValues = useMemo<StateType>(() => {
    if (!isThreadScopedStateLoading) {
      return stream.values;
    }

    return {
      messages: [],
      todos: [],
      files: {},
      goal: null,
    };
  }, [isThreadScopedStateLoading, stream.values]);
  const scopedMessages = useMemo(
    () => (isThreadScopedStateLoading ? [] : stream.messages),
    [isThreadScopedStateLoading, stream.messages]
  );
  const activeGoal = scopedValues.goal ?? null;

  const threadTitle = useMemo(() => {
    if (optimisticThreadTitle) {
      return optimisticThreadTitle;
    }
    return inferThreadTitle({
      metadata: threadMetadata,
      goal: activeGoal,
      messages: scopedMessages,
      fallback: threadId ? `会话 ${threadId.slice(0, 8)}` : "新会话",
    });
  }, [
    activeGoal,
    optimisticThreadTitle,
    scopedMessages,
    threadId,
    threadMetadata,
  ]);

  const updateThreadTitle = useCallback(
    async (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        throw new Error("标题不能为空。");
      }

      if (!threadId) {
        pendingNewThreadTitleRef.current = trimmed;
        setOptimisticThreadTitle(trimmed);
        return;
      }

      await client.threads.update(threadId, {
        metadata: {
          ...threadMetadata,
          [THREAD_TITLE_METADATA_KEY]: trimmed,
          [THREAD_TITLE_UPDATED_AT_METADATA_KEY]: new Date().toISOString(),
        },
      });
      setOptimisticThreadTitle(trimmed);
      await threadSnapshot?.mutate?.(threadId);
      onHistoryRevalidate?.();
    },
    [
      client.threads,
      onHistoryRevalidate,
      threadId,
      threadMetadata,
      threadSnapshot,
    ]
  );

  useEffect(() => {
    const pendingTitle = pendingNewThreadTitleRef.current;
    if (
      !threadId ||
      !pendingTitle ||
      pendingNewThreadTitleThreadIdRef.current !== threadId
    ) {
      return;
    }

    if (threadMetadata[THREAD_TITLE_METADATA_KEY] === pendingTitle) {
      pendingNewThreadTitleRef.current = null;
      pendingNewThreadTitleThreadIdRef.current = null;
      return;
    }

    let cancelled = false;

    void client.threads
      .update(threadId, {
        metadata: {
          ...threadMetadata,
          [THREAD_TITLE_METADATA_KEY]: pendingTitle,
          [THREAD_TITLE_UPDATED_AT_METADATA_KEY]: new Date().toISOString(),
        },
      })
      .then(async () => {
        if (cancelled) return;
        pendingNewThreadTitleRef.current = null;
        pendingNewThreadTitleThreadIdRef.current = null;
        setOptimisticThreadTitle(pendingTitle);
        await threadSnapshot?.mutate?.(threadId);
        onHistoryRevalidate?.();
      })
      .catch((error) => {
        console.error("Failed to persist pending thread title", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    client.threads,
    onHistoryRevalidate,
    threadId,
    threadMetadata,
    threadSnapshot,
  ]);

  const continueStream = useCallback(
    (hasTaskToolCall?: boolean) => {
      clearStreamEvents();
      markRunStarting();
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
      markRunStarting,
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
      markRunStarting();
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
      markRunStarting,
      withStreamSubmitOptions,
      buildRunConfig,
      onHistoryRevalidate,
    ]
  );

  const stopStream = useCallback(() => {
    setRunLifecycle((current) => ({
      ...current,
      status: "stopped",
      updatedAt: Date.now(),
    }));
    stream.stop();
  }, [stream]);

  const activeInterrupt = isThreadScopedStateLoading
    ? undefined
    : stream.interrupt ?? streamEventLayer.interrupt;
  const runStatus: RunLifecycleStatus = stream.error
    ? "error"
    : activeInterrupt
    ? "interrupted"
    : stream.isLoading
    ? "running"
    : runLifecycle.status;

  return {
    stream,
    todos: scopedValues.todos ?? [],
    files: scopedValues.files ?? {},
    goal: activeGoal,
    email: scopedValues.email,
    ui: scopedValues.ui,
    threadId,
    resourceId,
    workspaceId,
    threadTitle,
    threadMetadata,
    updateThreadTitle,
    setFiles,
    messages: scopedMessages,
    error: stream.error,
    isLoading: stream.isLoading,
    isThreadLoading: stream.isThreadLoading || Boolean(threadSnapshot?.isLoading),
    interrupt: activeInterrupt,
    runStatus,
    runUpdatedAt: runLifecycle.updatedAt,
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
