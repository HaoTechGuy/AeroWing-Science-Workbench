"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  FormEvent,
  Fragment,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Square,
  ArrowUp,
  CheckCircle,
  Clock,
  Circle,
  FileIcon,
  ImagePlus,
  Paperclip,
  X,
} from "lucide-react";
import { ChatMessage } from "@/app/components/ChatMessage";
import { ToolApprovalInterrupt } from "@/app/components/ToolApprovalInterrupt";
import type {
  TodoItem,
  ToolCall,
  ActionRequest,
  ReviewConfig,
  ChatAttachment,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import { extractStringFromMessageContent } from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";

interface ChatInterfaceProps {
  assistant: Assistant | null;
}

const MAX_IMAGE_ATTACHMENT_SIZE = 8 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_SIZE = 128 * 1024;

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "css",
  "html",
  "js",
  "json",
  "jsx",
  "md",
  "mdx",
  "py",
  "sh",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatChatError(error: unknown): string | null {
  if (!error) {
    return null;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
      ? error
      : JSON.stringify(error);

  if (/ConnectError|connection|connect/i.test(message)) {
    return "模型服务连接失败，请检查网络或代理后重试。";
  }

  if (/RemoteException/i.test(message)) {
    return "远程 Agent runtime 执行失败，请查看 backend 和 runtime 日志。";
  }

  return message || "运行失败，请重试。";
}

function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isTextAttachment(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return (
    file.type.startsWith("text/") ||
    TEXT_ATTACHMENT_EXTENSIONS.has(extension)
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function prepareAttachment(file: File): Promise<ChatAttachment> {
  const baseAttachment = {
    id: createAttachmentId(),
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };

  if (file.type.startsWith("image/")) {
    if (file.size > MAX_IMAGE_ATTACHMENT_SIZE) {
      return {
        ...baseAttachment,
        kind: "image",
        error: "图片超过 8 MB",
      };
    }

    return {
      ...baseAttachment,
      kind: "image",
      dataUrl: await readAsDataUrl(file),
    };
  }

  if (isTextAttachment(file)) {
    const slice = file.slice(0, MAX_TEXT_ATTACHMENT_SIZE);
    return {
      ...baseAttachment,
      kind: "text",
      text: await slice.text(),
      truncated: file.size > MAX_TEXT_ATTACHMENT_SIZE,
    };
  }

  return {
    ...baseAttachment,
    kind: "file",
  };
}

const getStatusIcon = (status: TodoItem["status"], className?: string) => {
  switch (status) {
    case "completed":
      return (
        <CheckCircle
          size={16}
          className={cn("text-success/80", className)}
        />
      );
    case "in_progress":
      return (
        <Clock
          size={16}
          className={cn("text-warning/80", className)}
        />
      );
    default:
      return (
        <Circle
          size={16}
          className={cn("text-tertiary/70", className)}
        />
      );
  }
};

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeToolArgs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toolCallsFromMessage(message: Record<string, any>): ToolCall[] {
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : [];

  return toolCalls
    .filter((toolCall) => isRecord(toolCall) && toolCall.name)
    .map((toolCall, index) => ({
      id: String(toolCall.id || `${message.id}-remote-tool-${index}`),
      name: String(toolCall.name),
      args: normalizeToolArgs(toolCall.args),
      status: "pending" as const,
    }));
}

function buildRemoteRuntimeToolMessages(
  streamEvents: Array<{
    mode: string;
    namespace?: string[];
    data: unknown;
  }>,
  topLevelToolCallIds: Set<string>
): Array<{ message: Message; toolCalls: ToolCall[] }> {
  const remoteMessages = new Map<string, { message: Message; toolCalls: ToolCall[] }>();

  for (const event of streamEvents) {
    if (
      event.mode !== "updates" ||
      !event.namespace?.some((part) => part.startsWith("remote_runtime"))
    ) {
      continue;
    }

    const data = isRecord(event.data) ? event.data : {};
    const modelMessages = isRecord(data.model) && Array.isArray(data.model.messages)
      ? data.model.messages
      : [];
    const toolMessages = isRecord(data.tools) && Array.isArray(data.tools.messages)
      ? data.tools.messages
      : [];

    for (const rawMessage of modelMessages) {
      if (!isRecord(rawMessage) || rawMessage.type !== "ai" || !rawMessage.id) {
        continue;
      }
      const toolCalls = toolCallsFromMessage(rawMessage).filter(
        (toolCall) => !topLevelToolCallIds.has(toolCall.id)
      );
      if (toolCalls.length === 0) continue;
      remoteMessages.set(String(rawMessage.id), {
        message: rawMessage as Message,
        toolCalls,
      });
    }

    for (const rawMessage of toolMessages) {
      if (!isRecord(rawMessage) || rawMessage.type !== "tool") continue;
      const toolCallId = rawMessage.tool_call_id;
      if (!toolCallId || topLevelToolCallIds.has(String(toolCallId))) continue;

      for (const entry of remoteMessages.values()) {
        const toolCallIndex = entry.toolCalls.findIndex(
          (toolCall) => toolCall.id === toolCallId
        );
        if (toolCallIndex === -1) continue;
        entry.toolCalls[toolCallIndex] = {
          ...entry.toolCalls[toolCallIndex],
          status: rawMessage.status === "error" ? "error" : "completed",
          result: extractStringFromMessageContent(rawMessage as Message),
        };
        break;
      }
    }
  }

  return Array.from(remoteMessages.values());
}

export const ChatInterface = React.memo<ChatInterfaceProps>(({ assistant }) => {
  const [metaOpen, setMetaOpen] = useState<"tasks" | "files" | null>(null);
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const { scrollRef, contentRef } = useStickToBottom();

  const {
    stream,
    messages,
    streamEvents,
    todos,
    files,
    ui,
    setFiles,
    error,
    isLoading,
    isThreadLoading,
    interrupt,
    sendMessage,
    stopStream,
    resumeInterrupt,
  } = useChatContext();

  const submitDisabled = isLoading || !assistant;
  const hasSendableAttachments = attachments.some(
    (attachment) => !attachment.error
  );
  const errorMessage = formatChatError(error);

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input.trim();
      const sendableAttachments = attachments.filter(
        (attachment) => !attachment.error
      );
      if (
        (!messageText && sendableAttachments.length === 0) ||
        isLoading ||
        submitDisabled
      ) {
        return;
      }
      sendMessage(messageText, sendableAttachments);
      setInput("");
      setAttachments([]);
    },
    [attachments, input, isLoading, sendMessage, setInput, submitDisabled]
  );

  const handleAttachmentFiles = useCallback(async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const preparedAttachments = await Promise.all(
      files.map((file) => prepareAttachment(file))
    );
    setAttachments((current) => [...current, ...preparedAttachments]);
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    );
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (submitDisabled) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, submitDisabled]
  );

  const interruptValues = useMemo(() => {
    if (!interrupt) return [];
    const interrupts = Array.isArray(interrupt) ? interrupt : [interrupt];
    return interrupts
      .map((item: any) => item?.value)
      .filter((value: unknown) => value && typeof value === "object");
  }, [interrupt]);

  const actionRequests = useMemo(() => {
    return interruptValues.flatMap((value: any) =>
      Array.isArray(value.action_requests) ? value.action_requests : []
    ) as ActionRequest[];
  }, [interruptValues]);

  const reviewConfigs = useMemo(() => {
    return interruptValues.flatMap((value: any) =>
      Array.isArray(value.review_configs) ? value.review_configs : []
    ) as ReviewConfig[];
  }, [interruptValues]);

  const interruptedToolNames = useMemo(() => {
    return new Set(actionRequests.map((request) => request.name));
  }, [actionRequests]);

  // TODO: can we make this part of the hook?
  const processedMessages = useMemo(() => {
    /*
     1. Loop through all messages
     2. For each AI message, add the AI message, and any tool calls to the messageMap
     3. For each tool message, find the corresponding tool call in the messageMap and update the status and output
    */
    const messageMap = new Map<
      string,
      { message: Message; toolCalls: ToolCall[] }
    >();
    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const toolCallsInMessage: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
          name?: string;
          type?: string;
          args?: unknown;
          input?: unknown;
        }> = [];
        if (
          message.additional_kwargs?.tool_calls &&
          Array.isArray(message.additional_kwargs.tool_calls)
        ) {
          toolCallsInMessage.push(...message.additional_kwargs.tool_calls);
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          toolCallsInMessage.push(
            ...message.tool_calls.filter(
              (toolCall: { name?: string }) => toolCall.name !== ""
            )
          );
        } else if (Array.isArray(message.content)) {
          const toolUseBlocks = message.content.filter(
            (block: { type?: string }) => block.type === "tool_use"
          );
          toolCallsInMessage.push(...toolUseBlocks);
        }
        const toolCallsWithStatus = toolCallsInMessage.map(
          (
            toolCall: {
              id?: string;
              function?: { name?: string; arguments?: unknown };
              name?: string;
              type?: string;
              args?: unknown;
              input?: unknown;
            },
            toolCallIndex
          ) => {
            const name =
              toolCall.function?.name ||
              toolCall.name ||
              toolCall.type ||
              "unknown";
            const args =
              toolCall.function?.arguments ||
              toolCall.args ||
              toolCall.input ||
              {};
            return {
              id: toolCall.id || `${message.id}-tool-${toolCallIndex}`,
              name,
              args,
              status: "pending" as const,
            } as ToolCall;
          }
        );
        messageMap.set(message.id!, {
          message,
          toolCalls: toolCallsWithStatus,
        });
      } else if (message.type === "tool") {
        const toolCallId = message.tool_call_id;
        if (!toolCallId) {
          return;
        }
        for (const [, data] of messageMap.entries()) {
          const toolCallIndex = data.toolCalls.findIndex(
            (tc: ToolCall) => tc.id === toolCallId
          );
          if (toolCallIndex === -1) {
            continue;
          }
          data.toolCalls[toolCallIndex] = {
            ...data.toolCalls[toolCallIndex],
            status: "completed" as const,
            result: extractStringFromMessageContent(message),
          };
          break;
        }
      } else if (message.type === "human") {
        messageMap.set(message.id!, {
          message,
          toolCalls: [],
        });
      }
    });
    const processedArray = Array.from(messageMap.values());
    const topLevelToolCallIds = new Set(
      processedArray.flatMap((data) => data.toolCalls.map((toolCall) => toolCall.id))
    );

    // Remote runtimes currently arrive as namespaced subgraph stream events.
    // Surface their tool activity while the parent graph is still waiting for
    // the final RemoteGraph state update.
    for (const remoteToolMessage of buildRemoteRuntimeToolMessages(
      streamEvents,
      topLevelToolCallIds
    )) {
      if (!messageMap.has(remoteToolMessage.message.id!)) {
        processedArray.push(remoteToolMessage);
      }
    }

    if (interrupt) {
      const interruptTarget = [...processedArray]
        .reverse()
        .find((data) =>
          data.toolCalls.some(
            (toolCall) =>
              toolCall.status === "pending" &&
              (interruptedToolNames.size === 0 ||
                interruptedToolNames.has(toolCall.name))
          )
        );

      if (interruptTarget) {
        interruptTarget.toolCalls = interruptTarget.toolCalls.map((toolCall) =>
          toolCall.status === "pending" &&
          (interruptedToolNames.size === 0 ||
            interruptedToolNames.has(toolCall.name))
            ? { ...toolCall, status: "interrupted" as const }
            : toolCall
        );
      }
    }

    return processedArray.map((data, index) => {
      const prevMessage = index > 0 ? processedArray[index - 1].message : null;
      return {
        ...data,
        showAvatar: data.message.type !== prevMessage?.type,
      };
    });
  }, [messages, streamEvents, interrupt, interruptedToolNames]);

  const groupedTodos = {
    in_progress: todos.filter((t) => t.status === "in_progress"),
    pending: todos.filter((t) => t.status === "pending"),
    completed: todos.filter((t) => t.status === "completed"),
  };

  const hasTasks = todos.length > 0;
  const hasFiles = Object.keys(files).length > 0;

  // Parse out any action requests or review configs from the interrupt
  const actionRequestsMap: Map<string, ActionRequest> | null = useMemo(() => {
    return new Map(actionRequests.map((ar: ActionRequest) => [ar.name, ar]));
  }, [actionRequests]);

  const reviewConfigsMap: Map<string, ReviewConfig> | null = useMemo(() => {
    return new Map(
      reviewConfigs.map((rc: ReviewConfig) => [rc.actionName, rc])
    );
  }, [reviewConfigs]);

  const hasVisibleInterruptToolCall = useMemo(() => {
    return processedMessages.some((data) =>
      data.toolCalls.some(
        (toolCall) =>
          toolCall.status === "interrupted" &&
          (interruptedToolNames.size === 0 ||
            interruptedToolNames.has(toolCall.name))
      )
    );
  }, [processedMessages, interruptedToolNames]);

  const orphanActionRequests = useMemo(() => {
    return hasVisibleInterruptToolCall ? [] : actionRequests;
  }, [actionRequests, hasVisibleInterruptToolCall]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        ref={scrollRef}
      >
        <div
          className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4"
          ref={contentRef}
        >
          {isThreadLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-muted-foreground">Loading...</p>
            </div>
          ) : (
            <>
              {processedMessages.map((data, index) => {
                const messageUi = ui?.filter(
                  (u: any) => u.metadata?.message_id === data.message.id
                );
                const isLastMessage = index === processedMessages.length - 1;
                return (
                  <ChatMessage
                    key={data.message.id}
                    message={data.message}
                    toolCalls={data.toolCalls}
                    isLoading={isLoading}
                    actionRequestsMap={
                      isLastMessage ? actionRequestsMap : undefined
                    }
                    reviewConfigsMap={
                      isLastMessage ? reviewConfigsMap : undefined
                    }
                    ui={messageUi}
                    stream={stream}
                    onResumeInterrupt={resumeInterrupt}
                    graphId={assistant?.graph_id}
                  />
                );
              })}
              {errorMessage && (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  {errorMessage}
                </div>
              )}
              {orphanActionRequests.length > 0 && (
                <div className="mt-4 flex w-full flex-col gap-3">
                  {orphanActionRequests.map((actionRequest, index) => (
                    <ToolApprovalInterrupt
                      key={`${actionRequest.name}-${index}`}
                      actionRequest={actionRequest}
                      reviewConfig={reviewConfigsMap?.get(actionRequest.name)}
                      onResume={resumeInterrupt}
                      isLoading={isLoading}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 bg-background">
        <div
          className={cn(
            "mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background",
            "mx-auto w-[calc(100%-32px)] max-w-[1024px] transition-colors duration-200 ease-in-out"
          )}
        >
          {(hasTasks || hasFiles) && (
            <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-sidebar empty:hidden">
              {!metaOpen && (
                <>
                  {(() => {
                    const activeTask = todos.find(
                      (t) => t.status === "in_progress"
                    );

                    const totalTasks = todos.length;
                    const remainingTasks =
                      totalTasks - groupedTodos.pending.length;
                    const isCompleted = totalTasks === remainingTasks;

                    const tasksTrigger = (() => {
                      if (!hasTasks) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "tasks" ? null : "tasks"
                            )
                          }
                          className="grid w-full cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left"
                          aria-expanded={metaOpen === "tasks"}
                        >
                          {(() => {
                            if (isCompleted) {
                              return [
                                <CheckCircle
                                  key="icon"
                                  size={16}
                                  className="text-success/80"
                                />,
                                <span
                                  key="label"
                                  className="ml-[1px] min-w-0 truncate text-sm"
                                >
                                  All tasks completed
                                </span>,
                              ];
                            }

                            if (activeTask != null) {
                              return [
                                <div key="icon">
                                  {getStatusIcon(activeTask.status)}
                                </div>,
                                <span
                                  key="label"
                                  className="ml-[1px] min-w-0 truncate text-sm"
                                >
                                  Task{" "}
                                  {totalTasks - groupedTodos.pending.length} of{" "}
                                  {totalTasks}
                                </span>,
                                <span
                                  key="content"
                                  className="min-w-0 gap-2 truncate text-sm text-muted-foreground"
                                >
                                  {activeTask.content}
                                </span>,
                              ];
                            }

                            return [
                              <Circle
                                key="icon"
                                size={16}
                                className="text-tertiary/70"
                              />,
                              <span
                                key="label"
                                className="ml-[1px] min-w-0 truncate text-sm"
                              >
                                Task {totalTasks - groupedTodos.pending.length}{" "}
                                of {totalTasks}
                              </span>,
                            ];
                          })()}
                        </button>
                      );
                    })();

                    const filesTrigger = (() => {
                      if (!hasFiles) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "files" ? null : "files"
                            )
                          }
                          className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm"
                          aria-expanded={metaOpen === "files"}
                        >
                          <FileIcon size={16} />
                          Files (State)
                          <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                            {Object.keys(files).length}
                          </span>
                        </button>
                      );
                    })();

                    return (
                      <div className="grid grid-cols-[1fr_auto_auto] items-center">
                        {tasksTrigger}
                        {filesTrigger}
                      </div>
                    );
                  })()}
                </>
              )}

              {metaOpen && (
                <>
                  <div className="sticky top-0 flex items-stretch bg-sidebar text-sm">
                    {hasTasks && (
                      <button
                        type="button"
                        className="py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "tasks" ? null : "tasks"
                          )
                        }
                        aria-expanded={metaOpen === "tasks"}
                      >
                        Tasks
                      </button>
                    )}
                    {hasFiles && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "files" ? null : "files"
                          )
                        }
                        aria-expanded={metaOpen === "files"}
                      >
                        Files (State)
                        <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                          {Object.keys(files).length}
                        </span>
                      </button>
                    )}
                    <button
                      aria-label="Close"
                      className="flex-1"
                      onClick={() => setMetaOpen(null)}
                    />
                  </div>
                  <div
                    ref={tasksContainerRef}
                    className="px-[18px]"
                  >
                    {metaOpen === "tasks" &&
                      Object.entries(groupedTodos)
                        .filter(([_, todos]) => todos.length > 0)
                        .map(([status, todos]) => (
                          <div
                            key={status}
                            className="mb-4"
                          >
                            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-tertiary">
                              {
                                {
                                  pending: "Pending",
                                  in_progress: "In Progress",
                                  completed: "Completed",
                                }[status]
                              }
                            </h3>
                            <div className="grid grid-cols-[auto_1fr] gap-3 rounded-sm p-1 pl-0 text-sm">
                              {todos.map((todo, index) => (
                                <Fragment key={`${status}_${todo.id}_${index}`}>
                                  {getStatusIcon(todo.status, "mt-0.5")}
                                  <span className="break-words text-inherit">
                                    {todo.content}
                                  </span>
                                </Fragment>
                              ))}
                            </div>
                          </div>
                        ))}

                    {metaOpen === "files" && (
                      <div className="mb-6">
                        <FilesPopover
                          files={files}
                          setFiles={setFiles}
                          editDisabled={
                            isLoading === true || interrupt !== undefined
                          }
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col"
          >
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                handleAttachmentFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                handleAttachmentFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-border px-[18px] py-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className={cn(
                      "flex min-w-0 max-w-full items-center gap-2 rounded-md border px-2 py-1.5 text-xs",
                      attachment.error
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-border bg-muted text-foreground"
                    )}
                  >
                    {attachment.kind === "image" && attachment.dataUrl ? (
                      <img
                        src={attachment.dataUrl}
                        alt=""
                        className="h-7 w-7 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 max-w-[180px] truncate">
                      {attachment.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {attachment.error || formatAttachmentSize(attachment.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                      aria-label={`移除 ${attachment.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? "正在运行..." : "你希望我做些什么？"}
              className="font-inherit field-sizing-content min-h-[68px] flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[16px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary/60"
              rows={2}
            />
            <div className="flex items-center justify-between gap-2 p-3">
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={submitDisabled}
                  aria-label="添加图片"
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={submitDisabled}
                  aria-label="添加附件"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type={isLoading ? "button" : "submit"}
                  variant={isLoading ? "destructive" : "default"}
                  onClick={isLoading ? stopStream : handleSubmit}
                  disabled={
                    !isLoading &&
                    (submitDisabled || (!input.trim() && !hasSendableAttachments))
                  }
                >
                  {isLoading ? (
                    <>
                      <Square size={14} />
                      <span>停止</span>
                    </>
                  ) : (
                    <>
                      <ArrowUp size={18} />
                      <span>发送</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";
