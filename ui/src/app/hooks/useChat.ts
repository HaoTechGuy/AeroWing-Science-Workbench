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
import type {
  ChatAttachment,
  GoalState,
  ScpCatalogItem,
  ScpInvocationState,
  TodoItem,
} from "@/app/types/types";
import type { StreamConfig } from "@/lib/config";
import { useRemoteAgent } from "@/providers/ClientProvider";
import { useQueryState } from "nuqs";
import { useStreamEventLayer } from "@/app/hooks/useStreamEventLayer";
import {
  inferThreadTitle,
  THREAD_TITLE_METADATA_KEY,
  THREAD_TITLE_UPDATED_AT_METADATA_KEY,
} from "@/app/utils/threadTitle";
import {
  loadPendingRunInputPreview,
  type PendingRunInputPreview,
} from "@/lib/pending-run-input";

type RunConfig = Record<string, any>;
type ParsedGoalCommand = {
  objective: string;
  tokenBudget?: number;
};
type SendMessageOptions = {
  scpSelection?: ScpCatalogItem | null;
};
type RetryMessageOptions = {
  checkpoint?: Checkpoint | null;
  previousMessages?: Message[];
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
const MAX_SCP_PROMPT_CHARS = 4_000;
const THREAD_SNAPSHOT_CACHE_MAX_ENTRIES = 40;
const THREAD_STATUS_METADATA_KEY = "internagents_thread_status";
const PENDING_RUN_STATUS_METADATA_KEY = "internagents_pending_run_status";
const STREAM_RECOVERY_VISIBLE_DELAY_MS = 700;
const ACTIVE_RUN_STATUSES = new Set(["busy", "pending", "running"]);

type ThreadSnapshotCacheEntry = {
  data?: ThreadState<StateType>[];
  updatedAt: number;
  pending?: Promise<ThreadState<StateType>[]>;
  requestId?: number;
};

const threadSnapshotCache = new Map<string, ThreadSnapshotCacheEntry>();
let threadSnapshotRequestSequence = 0;

export type StateType = {
  messages: Message[];
  todos: TodoItem[];
  files: Record<string, string>;
  goal?: GoalState | null;
  scpInvocation?: ScpInvocationState | null;
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
        ? {
            ...(thread.metadata as Record<string, unknown>),
            ...(typeof thread.status === "string"
              ? { [THREAD_STATUS_METADATA_KEY]: thread.status }
              : {}),
          }
        : typeof thread.status === "string"
        ? { [THREAD_STATUS_METADATA_KEY]: thread.status }
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

function emptyThreadState(threadId: string): ThreadState<StateType> {
  const now = new Date().toISOString();
  return sanitizeThreadState({
    values: {
      messages: [],
      todos: [],
      files: {},
      goal: null,
      scpInvocation: null,
    },
    next: [],
    tasks: [],
    metadata: {},
    created_at: now,
    checkpoint: {
      thread_id: threadId,
      checkpoint_ns: "",
      checkpoint_id: null,
      checkpoint_map: {},
    },
    parent_checkpoint: null,
  });
}

function pendingRunToState(
  threadId: string,
  preview: PendingRunInputPreview
): ThreadState<StateType> {
  const now = new Date().toISOString();

  return sanitizeThreadState({
    values: {
      messages: preview.messages,
      todos: [],
      files: {},
      goal: null,
      scpInvocation: null,
    },
    next: [],
    tasks: [],
    metadata: {
      ...preview.metadata,
      internagents_pending_run_id: preview.runId,
      internagents_pending_run_status: preview.status,
    },
    created_at: preview.updatedAt ?? preview.createdAt ?? now,
    checkpoint: {
      thread_id: threadId,
      checkpoint_ns: "",
      checkpoint_id: null,
      checkpoint_map: {},
    },
    parent_checkpoint: null,
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

function isThreadNotFoundError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const record = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  const status =
    typeof record.status === "number"
      ? record.status
      : typeof record.response?.status === "number"
      ? record.response.status
      : undefined;
  if (status === 404) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  return (
    /\b404\b/.test(message) ||
    message.includes("not found") ||
    message.includes("thread not found")
  );
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

function cloneStateValues(values: StateType): StateType {
  const cloned = {
    ...(values && typeof values === "object" ? values : {}),
  } as StateType;
  if (Array.isArray(cloned.messages)) {
    cloned.messages = [...cloned.messages];
  }
  return cloned;
}

function cloneThreadState(
  state: ThreadState<StateType>
): ThreadState<StateType> {
  return sanitizeThreadState({
    ...state,
    values: cloneStateValues(state.values),
    next: [...(state.next ?? [])],
    tasks: [...(state.tasks ?? [])],
    metadata:
      state.metadata && typeof state.metadata === "object"
        ? { ...(state.metadata as Record<string, unknown>) }
        : {},
    checkpoint: {
      ...state.checkpoint,
      checkpoint_map: state.checkpoint.checkpoint_map
        ? { ...state.checkpoint.checkpoint_map }
        : {},
    },
    parent_checkpoint: state.parent_checkpoint
      ? {
          ...state.parent_checkpoint,
          checkpoint_map: state.parent_checkpoint.checkpoint_map
            ? { ...state.parent_checkpoint.checkpoint_map }
            : {},
        }
      : null,
  });
}

function cloneThreadStates(
  states: ThreadState<StateType>[]
): ThreadState<StateType>[] {
  return states.map(cloneThreadState);
}

function threadSnapshotCacheKey(
  cacheScope: string,
  threadId: string
): string {
  return `${cacheScope}::${threadId}`;
}

function getCachedThreadSnapshot(
  cacheKey: string
): ThreadState<StateType>[] | undefined {
  const entry = threadSnapshotCache.get(cacheKey);
  if (!entry?.data) {
    return undefined;
  }

  threadSnapshotCache.delete(cacheKey);
  threadSnapshotCache.set(cacheKey, entry);
  return cloneThreadStates(entry.data);
}

function setCachedThreadSnapshot(
  cacheKey: string,
  data: ThreadState<StateType>[],
  requestId?: number
): ThreadState<StateType>[] {
  const cloned = cloneThreadStates(data);
  const existing = threadSnapshotCache.get(cacheKey);
  if (requestId !== undefined && existing?.requestId !== requestId) {
    return getCachedThreadSnapshot(cacheKey) ?? cloneThreadStates(cloned);
  }

  threadSnapshotCache.set(cacheKey, {
    ...existing,
    data: cloned,
    updatedAt: Date.now(),
    pending: undefined,
    requestId,
  });

  while (threadSnapshotCache.size > THREAD_SNAPSHOT_CACHE_MAX_ENTRIES) {
    const oldestKey = threadSnapshotCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    threadSnapshotCache.delete(oldestKey);
  }

  return cloneThreadStates(cloned);
}

function setPendingThreadSnapshot(
  cacheKey: string,
  pending: Promise<ThreadState<StateType>[]>,
  requestId: number
) {
  const existing = threadSnapshotCache.get(cacheKey);
  threadSnapshotCache.set(cacheKey, {
    ...existing,
    updatedAt: existing?.updatedAt ?? 0,
    pending,
    requestId,
  });
}

function clearPendingThreadSnapshot(
  cacheKey: string,
  pending: Promise<ThreadState<StateType>[]>
) {
  const existing = threadSnapshotCache.get(cacheKey);
  if (existing?.pending !== pending) {
    return;
  }
  if (!existing.data) {
    threadSnapshotCache.delete(cacheKey);
    return;
  }
  threadSnapshotCache.set(cacheKey, {
    ...existing,
    pending: undefined,
  });
}

function isActiveThreadSnapshotRequest(
  cacheKey: string,
  requestId?: number
): boolean {
  return (
    requestId === undefined ||
    threadSnapshotCache.get(cacheKey)?.requestId === requestId
  );
}

function hasUsableCheckpoint(
  checkpoint?: Checkpoint | null
): checkpoint is Checkpoint & { checkpoint_id: string } {
  return (
    typeof checkpoint?.checkpoint_id === "string" &&
    checkpoint.checkpoint_id.length > 0
  );
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

function mergeStateSnapshot(
  primaryState: ThreadState<StateType>,
  snapshotState: ThreadState<StateType>
): ThreadState<StateType> {
  const primaryValues =
    primaryState.values && typeof primaryState.values === "object"
      ? (primaryState.values as Partial<StateType>)
      : {};
  const snapshotValues =
    snapshotState.values && typeof snapshotState.values === "object"
      ? (snapshotState.values as Partial<StateType>)
      : {};
  const snapshotMessages = messagesFromValues(snapshotState.values);
  const primaryMessages = messagesFromValues(primaryState.values);

  return sanitizeThreadState({
    ...snapshotState,
    values: {
      ...primaryValues,
      ...snapshotValues,
      messages:
        snapshotMessages.length > 0 ? snapshotMessages : primaryMessages,
    } as StateType,
    metadata: {
      ...(primaryState.metadata || {}),
      ...(snapshotState.metadata || {}),
    },
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
      ...(typeof thread.status === "string"
        ? { [THREAD_STATUS_METADATA_KEY]: thread.status }
        : {}),
    },
  });
}

function useDelayedBoolean(value: boolean, delayMs: number): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) {
      setVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return visible;
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

  if (!primaryState && isThreadNotFoundError(primaryError)) {
    return [emptyThreadState(threadId)];
  }

  const pendingRunPreview = await loadPendingRunInputPreview(client, threadId);
  if (pendingRunPreview) {
    const pendingState = pendingRunToState(threadId, pendingRunPreview);
    return [
      primaryState
        ? mergeStateSnapshot(primaryState, pendingState)
        : pendingState,
    ];
  }

  if (runtimeClient) {
    try {
      const runtimeState = sanitizeThreadState(
        await runtimeClient.threads.getState<StateType>(threadId)
      );
      if (stateHasMessages(runtimeState)) {
        return [
          primaryState
            ? mergeStateSnapshot(primaryState, runtimeState)
            : runtimeState,
        ];
      }
      if (!primaryState) {
        primaryState = runtimeState;
      }
    } catch {
      // Runtime may not have a materialized state for queued main-service runs.
    }

    try {
      const runtimeThread = await runtimeClient.threads.get<StateType>(
        threadId
      );
      const runtimeState = threadToState(threadId, runtimeThread);
      if (stateHasMessages(runtimeState)) {
        return [
          primaryState
            ? mergeStateSnapshot(primaryState, runtimeState)
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
            ? mergeStateSnapshot(primaryState, runtimeStateWithMessages)
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
  cacheScope,
}: {
  client: ReturnType<typeof useRemoteAgent>["client"];
  runtimeClient: Client<StateType> | null;
  threadId: string | null;
  externalThread?: UseStreamThread<StateType>;
  cacheScope: string;
}): UseStreamThread<StateType> | undefined {
  const requestIdRef = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    cacheKey: string | null;
    threadId: string | null;
    data: ThreadState<StateType>[] | null | undefined;
    error: unknown;
    isLoading: boolean;
  }>(() => {
    const initialCacheKey = threadId
      ? threadSnapshotCacheKey(cacheScope, threadId)
      : null;
    const cachedData = initialCacheKey
      ? getCachedThreadSnapshot(initialCacheKey)
      : undefined;

    return {
      cacheKey: initialCacheKey,
      threadId,
      data: cachedData,
      error: undefined,
      isLoading: Boolean(threadId && !cachedData),
    };
  });

  const mutate = useCallback(
    async (mutateId?: string) => {
      const targetThreadId = mutateId ?? threadId;
      const requestId = ++requestIdRef.current;

      if (!targetThreadId) {
        const empty = {
          cacheKey: null,
          threadId: null,
          data: undefined,
          error: undefined,
          isLoading: false,
        };
        setSnapshot(empty);
        return empty.data;
      }

      const cacheKey = threadSnapshotCacheKey(cacheScope, targetThreadId);
      const cachedData = getCachedThreadSnapshot(cacheKey);

      setSnapshot((current) => ({
        ...current,
        cacheKey,
        threadId: targetThreadId,
        data:
          cachedData ??
          (current.cacheKey === cacheKey ? current.data : undefined),
        error: undefined,
        isLoading: true,
      }));

      let pending: Promise<ThreadState<StateType>[]> | undefined;
      let cacheRequestId: number | undefined;
      try {
        const existingEntry = threadSnapshotCache.get(cacheKey);
        const existingPending = existingEntry?.data
          ? undefined
          : existingEntry?.pending;
        if (existingPending) {
          pending = existingPending;
          cacheRequestId = existingEntry?.requestId;
        } else {
          pending = loadThreadSnapshot({
            client,
            runtimeClient,
            threadId: targetThreadId,
          });
          cacheRequestId = ++threadSnapshotRequestSequence;
          setPendingThreadSnapshot(cacheKey, pending, cacheRequestId);
        }

        const data = await pending;
        if (!isActiveThreadSnapshotRequest(cacheKey, cacheRequestId)) {
          return getCachedThreadSnapshot(cacheKey) ?? cloneThreadStates(data);
        }

        const cachedResult = setCachedThreadSnapshot(
          cacheKey,
          data,
          cacheRequestId
        );
        if (
          requestIdRef.current === requestId &&
          isActiveThreadSnapshotRequest(cacheKey, cacheRequestId)
        ) {
          setSnapshot({
            cacheKey,
            threadId: targetThreadId,
            data: cachedResult,
            error: undefined,
            isLoading: false,
          });
        }
        return cloneThreadStates(cachedResult);
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setSnapshot((current) => ({
            ...current,
            cacheKey,
            data:
              current.cacheKey === cacheKey
                ? current.data
                : getCachedThreadSnapshot(cacheKey),
            error,
            isLoading: false,
          }));
        }
        throw error;
      } finally {
        if (pending) {
          clearPendingThreadSnapshot(cacheKey, pending);
        }
      }
    },
    [cacheScope, client, runtimeClient, threadId]
  );

  useEffect(() => {
    if (externalThread) {
      return;
    }
    void mutate(threadId ?? undefined).catch(() => undefined);
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

function formatAttachmentAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function attachmentMetadata(attachments: ChatAttachment[]) {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    kind: attachment.kind,
    workspacePath: attachment.workspacePath,
    extractedWorkspacePath: attachment.extractedWorkspacePath,
    extractedTextSize: attachment.extractedTextSize,
    pageCount: attachment.pageCount,
    extractedPageCount: attachment.extractedPageCount,
    truncated: attachment.truncated,
    extractionError: attachment.extractionError,
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
        ? ` path="${formatAttachmentAttribute(attachment.workspacePath)}"`
        : "";
      const extractedPathHint = attachment.extractedWorkspacePath
        ? ` extracted_path="${formatAttachmentAttribute(
            attachment.extractedWorkspacePath
          )}"`
        : "";
      const pagesHint = attachment.pageCount
        ? ` pages="${attachment.pageCount}"`
        : "";
      const extractedPagesHint = attachment.extractedPageCount
        ? ` extracted_pages="${attachment.extractedPageCount}"`
        : "";
      const extractionError = attachment.extractionError?.trim();
      const extractedText = attachment.text?.trim();
      const body = attachment.extractedWorkspacePath
        ? [
            `[PDF uploaded and processed locally. Use the extracted text file at ${attachment.extractedWorkspacePath} first for reading, summarization, and question answering.`,
            attachment.workspacePath
              ? `The original PDF is available at ${attachment.workspacePath}.`
              : "",
            attachment.truncated
              ? "The extracted text is truncated; use the original PDF only when additional pages, layout, figures, or tables are needed."
              : "Use the original PDF only when layout, figures, or tables are needed.",
            extractionError
              ? `Local extraction reported: ${extractionError}`
              : "",
            "]",
          ]
            .filter(Boolean)
            .join(" ")
        : extractedText
        ? attachment.truncated
          ? `${extractedText}\n\n[PDF text truncated before sending. The original PDF is available at ${
              attachment.workspacePath || "the workspace path above"
            }.]`
          : extractedText
        : `[PDF uploaded. The original file is available at ${
            attachment.workspacePath || "the workspace path above"
          }. ${
            extractionError
              ? `Local text extraction failed: ${extractionError}`
              : "No extractable text was found in the uploaded PDF."
          }]`;
      blocks.push({
        type: "text",
        text: [
          `<attachment name="${formatAttachmentAttribute(
            attachment.name
          )}" mime_type="${formatAttachmentAttribute(
            attachment.mimeType || "application/pdf"
          )}" size="${formatAttachmentSize(
            attachment.size
          )}"${pathHint}${extractedPathHint}${pagesHint}${extractedPagesHint}>`,
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

function cloneMessageContent(content: Message["content"]): Message["content"] {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((block) =>
    block && typeof block === "object" ? { ...block } : block
  ) as Message["content"];
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

function parseScpPrompt(content: string): string | null {
  const match = content.trim().match(/^\/scp(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }

  let prompt = match[1]?.trim() ?? "";
  while (/^(?:skill|tool)=[^\s]+\s*/i.test(prompt)) {
    prompt = prompt.replace(/^(?:skill|tool)=[^\s]+\s*/i, "").trim();
  }

  if (!prompt || prompt.length > MAX_SCP_PROMPT_CHARS) {
    return null;
  }
  return prompt;
}

function createScpInvocationState(
  selection: ScpCatalogItem,
  prompt: string,
  threadId: string
): ScpInvocationState {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: uuidv4(),
    threadId,
    skillName: selection.skillName,
    displayName: selection.displayName,
    toolName: selection.toolName,
    endpoint: selection.endpoint,
    prompt,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

export function useChat({
  activeAssistant,
  streamConfig,
  onHistoryRevalidate,
  onGeneratedThreadId,
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
  onGeneratedThreadId?: (threadId: string) => void;
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
  const [localRunInFlight, setLocalRunInFlight] = useState(false);
  const [visibleError, setVisibleError] = useState<unknown>();
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
  const threadSnapshotCacheScope = useMemo(
    () =>
      [
        remoteAgent.url,
        remoteAgent.graphName,
        runtimeUrl || "",
        resourceId || "",
        workspaceId || "",
      ].join("|"),
    [remoteAgent.graphName, remoteAgent.url, resourceId, runtimeUrl, workspaceId]
  );
  const markRunStarting = useCallback(() => {
    setVisibleError(undefined);
    setLocalRunInFlight(true);
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
    cacheScope: threadSnapshotCacheScope,
  });
  const threadMetadata = useMemo(() => {
    const metadata = threadSnapshot?.data?.[0]?.metadata;
    return metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {};
  }, [threadSnapshot?.data]);
  const threadStatus =
    typeof threadMetadata[THREAD_STATUS_METADATA_KEY] === "string"
      ? threadMetadata[THREAD_STATUS_METADATA_KEY]
      : null;
  const pendingRunStatus =
    typeof threadMetadata[PENDING_RUN_STATUS_METADATA_KEY] === "string"
      ? threadMetadata[PENDING_RUN_STATUS_METADATA_KEY]
      : null;
  const snapshotHasActiveRun =
    (threadStatus ? ACTIVE_RUN_STATUSES.has(threadStatus) : false) ||
    (pendingRunStatus ? ACTIVE_RUN_STATUSES.has(pendingRunStatus) : false);
  const snapshotHasSettledRunState =
    Boolean(threadStatus) && !snapshotHasActiveRun;

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
      streamResumable: true,
      onDisconnect: "continue" as const,
      ...streamSubmitOptions,
      ...options,
    }),
    [streamSubmitOptions]
  );
  const invalidImplicitCheckpointOptions = useMemo(() => {
    const headCheckpoint = threadSnapshot?.data?.[0]?.checkpoint;
    return hasUsableCheckpoint(headCheckpoint) ? {} : { checkpoint: null };
  }, [threadSnapshot?.data]);
  const handleGeneratedThreadId = useCallback(
    (generatedThreadId: string) => {
      onGeneratedThreadId?.(generatedThreadId);
      setThreadId(generatedThreadId);
    },
    [onGeneratedThreadId, setThreadId]
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
      setVisibleError(undefined);
      setLocalRunInFlight(false);
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
    (error: unknown, run?: { run_id?: string; thread_id?: string }) => {
      setVisibleError(error);
      setLocalRunInFlight(false);
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
    setVisibleError(undefined);
    setLocalRunInFlight(false);
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
    onThreadId: handleGeneratedThreadId,
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

  const shouldPollThreadSnapshot =
    Boolean(threadId) && (stream.isLoading || runLifecycle.status === "running");

  const mutateThreadSnapshot = threadSnapshot?.mutate;

  useEffect(() => {
    if (!shouldPollThreadSnapshot || !mutateThreadSnapshot || !threadId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void mutateThreadSnapshot(threadId);
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [shouldPollThreadSnapshot, threadId, mutateThreadSnapshot]);

  const effectiveStreamValues = useMemo<StateType>(() => {
    const currentValues = stream.values;
    const snapshotValues = threadSnapshot?.data?.[0]?.values;
    const currentMessages = messagesFromValues(currentValues);
    const snapshotMessages = messagesFromValues(snapshotValues);

    if (snapshotMessages.length <= currentMessages.length) {
      return currentValues;
    }

    const currentRecord =
      currentValues && typeof currentValues === "object" ? currentValues : {};
    const snapshotRecord =
      snapshotValues && typeof snapshotValues === "object"
        ? snapshotValues
        : {};

    return {
      ...currentRecord,
      ...snapshotRecord,
      messages: snapshotMessages,
    } as StateType;
  }, [stream.values, threadSnapshot?.data]);

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
      setVisibleError(undefined);
      setLocalRunInFlight(false);
      setRunLifecycle({ status: "idle" });
    }
  }, [streamScopeKey, stream.isLoading, clearStreamEvents]);

  const sendMessage = useCallback(
    (
      content: string,
      attachments: ChatAttachment[] = [],
      options: SendMessageOptions = {}
    ) => {
      const goalCommand = parseGoalCommand(content);
      const scpPrompt = options.scpSelection ? parseScpPrompt(content) : null;
      const existingGoal = threadId ? stream.values.goal : null;
      const hasActiveGoal = existingGoal?.status === "active";
      const shouldSeedGoal = Boolean(goalCommand && !hasActiveGoal);
      const shouldSeedScp = Boolean(options.scpSelection && scpPrompt);
      const pendingNewThreadTitle = pendingNewThreadTitleRef.current;
      const newThreadId =
        !threadId && (shouldSeedGoal || shouldSeedScp || pendingNewThreadTitle)
          ? uuidv4()
          : null;
      const seededGoalThreadId = shouldSeedGoal
        ? threadId ?? newThreadId ?? uuidv4()
        : null;
      const seededScpThreadId = shouldSeedScp
        ? threadId ?? newThreadId ?? uuidv4()
        : null;
      const seededGoal =
        shouldSeedGoal && goalCommand && seededGoalThreadId
          ? createGoalState(goalCommand, seededGoalThreadId)
          : null;
      const seededScp =
        shouldSeedScp &&
        options.scpSelection &&
        scpPrompt &&
        seededScpThreadId
          ? createScpInvocationState(
              options.scpSelection,
              scpPrompt,
              seededScpThreadId
            )
          : null;
      const messageContent = seededScp
        ? seededScp.prompt
        : seededGoal
        ? seededGoal.objective
        : content;
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
        ...(seededScp
          ? {
              internagents_scp_command: {
                original_content: content,
                scp_invocation_id: seededScp.id,
                skill_name: seededScp.skillName,
                tool_name: seededScp.toolName,
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
          ...(seededScp ? { scpInvocation: seededScp } : {}),
        },
        withStreamSubmitOptions({
          metadata: workspaceMetadata,
          ...invalidImplicitCheckpointOptions,
          ...(newThreadId ? { threadId: newThreadId } : {}),
          optimisticValues: (prev: StateType) => ({
            messages: [...(prev.messages ?? []), newMessage],
            ...(seededGoal ? { goal: seededGoal } : {}),
            ...(seededScp ? { scpInvocation: seededScp } : {}),
          }),
          config: buildRunConfig({ recursion_limit: 100 }),
          ...(seededGoal || seededScp ? { durability: "async" as const } : {}),
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
      invalidImplicitCheckpointOptions,
      threadId,
    ]
  );

  const retryMessage = useCallback(
    (message: Message, options: RetryMessageOptions = {}) => {
      if (message.type !== "human") {
        return;
      }

      const newMessage: Message = {
        ...message,
        id: uuidv4(),
        type: "human",
        content: cloneMessageContent(message.content),
        additional_kwargs: message.additional_kwargs
          ? { ...message.additional_kwargs }
          : undefined,
      };

      clearStreamEvents();
      markRunStarting();
      const checkpointOptions = hasUsableCheckpoint(options.checkpoint)
        ? { checkpoint: { ...options.checkpoint } }
        : invalidImplicitCheckpointOptions;
      stream.submit(
        { messages: [newMessage] },
        withStreamSubmitOptions({
          metadata: workspaceMetadata,
          ...checkpointOptions,
          optimisticValues: (prev: StateType) => ({
            messages: [
              ...(options.previousMessages ?? prev.messages ?? []),
              newMessage,
            ],
          }),
          config: buildRunConfig({ recursion_limit: 100 }),
        })
      );
      onHistoryRevalidate?.();
    },
    [
      stream,
      clearStreamEvents,
      markRunStarting,
      withStreamSubmitOptions,
      workspaceMetadata,
      invalidImplicitCheckpointOptions,
      buildRunConfig,
      onHistoryRevalidate,
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
      if (hasUsableCheckpoint(checkpoint)) {
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
            ...invalidImplicitCheckpointOptions,
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
      invalidImplicitCheckpointOptions,
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
    threadId &&
      (stream.isThreadLoading ||
        (threadSnapshot?.isLoading && !threadSnapshot.data))
  );
  const scopedValues = useMemo<StateType>(() => {
    if (!isThreadScopedStateLoading) {
      return effectiveStreamValues;
    }

    return {
      messages: [],
      todos: [],
      files: {},
      goal: null,
      scpInvocation: null,
    };
  }, [effectiveStreamValues, isThreadScopedStateLoading]);
  const scopedMessages = useMemo(
    () => (isThreadScopedStateLoading ? [] : messagesFromValues(scopedValues)),
    [isThreadScopedStateLoading, scopedValues]
  );
  const activeGoal = scopedValues.goal ?? null;
  const scpInvocation = scopedValues.scpInvocation ?? null;

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
          ...invalidImplicitCheckpointOptions,
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
      invalidImplicitCheckpointOptions,
    ]
  );

  const markCurrentThreadAsResolved = useCallback(() => {
    stream.submit(
      null,
      withStreamSubmitOptions({
        ...invalidImplicitCheckpointOptions,
        command: { goto: "__end__", update: null },
      })
    );
    // Update thread list when marking thread as resolved
    onHistoryRevalidate?.();
  }, [
    stream,
    withStreamSubmitOptions,
    invalidImplicitCheckpointOptions,
    onHistoryRevalidate,
  ]);

  const resumeInterrupt = useCallback(
    (value: any) => {
      clearStreamEvents();
      markRunStarting();
      stream.submit(
        null,
        withStreamSubmitOptions({
          ...invalidImplicitCheckpointOptions,
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
      invalidImplicitCheckpointOptions,
    ]
  );

  const stopStream = useCallback(() => {
    setLocalRunInFlight(false);
    setRunLifecycle((current) => ({
      ...current,
      status: "stopped",
      updatedAt: Date.now(),
    }));
    stream.stop();
  }, [stream]);

  const isRunLoading =
    stream.isLoading && (localRunInFlight || snapshotHasActiveRun);
  const shouldShowStreamRecovery =
    stream.isLoading && !isRunLoading && !snapshotHasSettledRunState;
  const isStreamRecovering = useDelayedBoolean(
    shouldShowStreamRecovery,
    STREAM_RECOVERY_VISIBLE_DELAY_MS
  );

  const activeInterrupt = isThreadScopedStateLoading
    ? undefined
    : stream.interrupt ?? streamEventLayer.interrupt;
  const runStatus: RunLifecycleStatus = visibleError
    ? "error"
    : activeInterrupt
    ? "interrupted"
    : isRunLoading
    ? "running"
    : runLifecycle.status;

  return {
    stream,
    todos: scopedValues.todos ?? [],
    files: scopedValues.files ?? {},
    goal: activeGoal,
    scpInvocation,
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
    error: visibleError,
    isLoading: isRunLoading,
    isStreamRecovering,
    isThreadLoading: isThreadScopedStateLoading,
    interrupt: activeInterrupt,
    runStatus,
    runUpdatedAt: runLifecycle.updatedAt,
    getMessagesMetadata: stream.getMessagesMetadata,
    streamEvents: streamEventLayer.streamEvents,
    clearStreamEvents: streamEventLayer.clearStreamEvents,
    lastUpdateNamespace: streamEventLayer.lastUpdateNamespace,
    sendMessage,
    retryMessage,
    runSingleStep,
    continueStream,
    stopStream,
    markCurrentThreadAsResolved,
    resumeInterrupt,
  };
}
