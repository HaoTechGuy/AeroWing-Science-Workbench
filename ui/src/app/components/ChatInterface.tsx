"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
  FormEvent,
  Fragment,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Square,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  CheckCircle2,
  Clock,
  Circle,
  FileIcon,
  ImagePlus,
  Loader2,
  Paperclip,
  Pencil,
  Target,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ChatMessage } from "@/app/components/ChatMessage";
import { ToolApprovalInterrupt } from "@/app/components/ToolApprovalInterrupt";
import type {
  TodoItem,
  ToolCall,
  ActionRequest,
  ReviewConfig,
  ChatAttachment,
  GoalState,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import { extractStringFromMessageContent } from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import {
  WORKSPACE_FILE_DRAG_MIME,
  parseWorkspaceFileDragPayload,
  type WorkspaceFileDragPayload,
} from "@/app/utils/workspaceDrag";

interface ChatInterfaceProps {
  assistant: Assistant | null;
}

const MAX_IMAGE_ATTACHMENT_SIZE = 8 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_SIZE = 128 * 1024;
const MAX_PDF_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_HINT = "支持图片、PDF 和文本文件。";

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "csv",
  "css",
  "env.example",
  "gitignore",
  "html",
  "ini",
  "js",
  "json",
  "jsx",
  "lock",
  "log",
  "md",
  "markdown",
  "mdx",
  "mjs",
  "py",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const PDF_ATTACHMENT_EXTENSIONS = new Set(["pdf"]);

interface AttachmentUploadContext {
  resourceId?: string;
  workspaceId?: string;
  threadId?: string | null;
}

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

  const remoteRuntimeMessage = extractRemoteRuntimeErrorMessage(message);
  if (remoteRuntimeMessage) {
    return `远程 Agent runtime 执行失败：${remoteRuntimeMessage}`;
  }

  if (/ConnectError|connection|connect/i.test(message)) {
    return "模型服务连接失败，请检查网络或代理后重试。";
  }

  if (/RemoteException/i.test(message)) {
    return "远程 Agent runtime 执行失败，请查看 backend 和 runtime 日志。";
  }

  return message || "运行失败，请重试。";
}

function extractRemoteRuntimeErrorMessage(message: string): string | null {
  if (!/RemoteException/i.test(message)) {
    return null;
  }

  const normalized = message.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const extracted =
    normalized.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ??
    null;

  if (/Insufficient credits/i.test(extracted ?? normalized)) {
    return "集思额度不足，请提额后重试。";
  }

  if (/User not found|Unauthorized|401/i.test(extracted ?? normalized)) {
    return "集思 key 无效或未授权，请在配置页重新绑定邮箱。";
  }

  return extracted;
}

function formatGoalElapsed(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes === 0
      ? `${hours}h`
      : `${hours}h ${remainingMinutes}m`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function goalStatusLabel(status: GoalState["status"]): string {
  switch (status) {
    case "complete":
      return "已完成";
    case "blocked":
      return "受阻";
    default:
      return "进行中";
  }
}

function goalStatusClassName(status: GoalState["status"]): string {
  switch (status) {
    case "complete":
      return "border-success/30 bg-success/10 text-success";
    case "blocked":
      return "border-warning/30 bg-warning/10 text-warning";
    default:
      return "border-primary/30 bg-primary/10 text-primary";
  }
}

function todoStatusLabel(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "in_progress":
      return "进行中";
    default:
      return "待处理";
  }
}

function createAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function getAttachmentFileKey(fileName: string): string {
  const lowerName = fileName.trim().toLowerCase();
  if (lowerName === ".env.example") return "env.example";
  if (lowerName === ".gitignore") return "gitignore";
  const parts = lowerName.split(".");
  return parts.length > 1 ? parts[parts.length - 1] || "" : "";
}

function isTextAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  return (
    Boolean(mimeType?.startsWith("text/")) ||
    TEXT_ATTACHMENT_EXTENSIONS.has(getAttachmentFileKey(fileName))
  );
}

function isPdfAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  return (
    mimeType === "application/pdf" ||
    PDF_ATTACHMENT_EXTENSIONS.has(getAttachmentFileKey(fileName))
  );
}

function isSupportedAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  return (
    Boolean(mimeType?.startsWith("image/")) ||
    isPdfAttachmentDescriptor(fileName, mimeType) ||
    isTextAttachmentDescriptor(fileName, mimeType)
  );
}

function isTextAttachment(file: File): boolean {
  return isTextAttachmentDescriptor(file.name, file.type);
}

function isPdfAttachment(file: File): boolean {
  return isPdfAttachmentDescriptor(file.name, file.type);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function uploadPdfAttachment(
  file: File,
  context: AttachmentUploadContext
): Promise<Partial<ChatAttachment>> {
  const form = new FormData();
  form.set("file", file);
  if (context.resourceId) {
    form.set("resourceId", context.resourceId);
  }
  if (context.workspaceId) {
    form.set("workspaceId", context.workspaceId);
  }
  if (context.threadId) {
    form.set("threadId", context.threadId);
  }

  const response = await fetch("/api/workspace/attachments", {
    method: "POST",
    body: form,
  });
  const payload = (await parsePdfUploadResponse(response)) as {
    attachment?: Partial<ChatAttachment>;
    error?: string;
  };
  if (!response.ok || !payload.attachment) {
    throw new Error(payload.error || `PDF 上传失败（${response.status}）`);
  }
  return payload.attachment;
}

async function parsePdfUploadResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  const text = (await response.text().catch(() => "")).trim();
  return {
    error: text && text !== "Internal Server Error" ? text : "PDF 上传失败",
  };
}

async function prepareAttachment(
  file: File,
  context: AttachmentUploadContext
): Promise<ChatAttachment> {
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

  if (isPdfAttachment(file)) {
    if (file.size > MAX_PDF_ATTACHMENT_SIZE) {
      return {
        ...baseAttachment,
        kind: "pdf",
        error: "PDF 超过 16 MB",
      };
    }

    try {
      const uploaded = await uploadPdfAttachment(file, context);
      return {
        ...baseAttachment,
        ...uploaded,
        kind: "pdf",
      };
    } catch (error) {
      return {
        ...baseAttachment,
        kind: "pdf",
        error: error instanceof Error ? error.message : "PDF 上传失败",
      };
    }
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
    error: `不支持的附件类型。${SUPPORTED_ATTACHMENT_HINT}`,
  };
}

function hasAttachmentDropData(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes(WORKSPACE_FILE_DRAG_MIME) || types.includes("Files");
}

function isWorkspaceFileAttachmentAllowed(
  payload: WorkspaceFileDragPayload
): boolean {
  if (
    payload.previewKind === "image" ||
    payload.previewKind === "pdf" ||
    payload.previewKind === "markdown" ||
    payload.previewKind === "text"
  ) {
    return true;
  }

  const descriptorName = payload.extension
    ? `${payload.name}${payload.extension.startsWith(".") ? "" : "."}${
        payload.extension
      }`
    : payload.name;
  return isSupportedAttachmentDescriptor(descriptorName);
}

async function workspaceDragPayloadToFile(
  payload: WorkspaceFileDragPayload,
  context: AttachmentUploadContext
): Promise<File> {
  const params = new URLSearchParams({ path: payload.path });
  const effectiveResourceId = payload.resourceId || context.resourceId;
  const effectiveWorkspaceId = payload.workspaceId || context.workspaceId;
  if (effectiveResourceId) {
    params.set("resourceId", effectiveResourceId);
  }
  if (effectiveWorkspaceId) {
    params.set("workspaceId", effectiveWorkspaceId);
  }

  const response = await fetch(`/api/workspace/file/raw?${params.toString()}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(errorPayload.error || "无法读取工作区文件。");
  }

  const blob = await response.blob();
  const fileName = payload.name || payload.path.split("/").pop() || "file";
  return new File([blob], fileName, {
    type: blob.type || "application/octet-stream",
  });
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
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

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
  const remoteMessages = new Map<
    string,
    { message: Message; toolCalls: ToolCall[] }
  >();

  for (const event of streamEvents) {
    if (
      event.mode !== "updates" ||
      !event.namespace?.some((part) => part.startsWith("remote_runtime"))
    ) {
      continue;
    }

    const data = isRecord(event.data) ? event.data : {};
    const modelMessages =
      isRecord(data.model) && Array.isArray(data.model.messages)
        ? data.model.messages
        : [];
    const toolMessages =
      isRecord(data.tools) && Array.isArray(data.tools.messages)
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
  const [metaOpen, setMetaOpen] = useState<"goal" | "tasks" | "files" | null>(
    null
  );
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatDragDepthRef = useRef(0);

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isChatDropActive, setIsChatDropActive] = useState(false);
  const [isPreparingDroppedAttachment, setIsPreparingDroppedAttachment] =
    useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [showIntermediateResults, setShowIntermediateResults] =
    useState(false);
  const { scrollRef, contentRef } = useStickToBottom();

  const {
    stream,
    messages,
    streamEvents,
    todos,
    files,
    goal,
    ui,
    setFiles,
    error,
    isLoading,
    isThreadLoading,
    interrupt,
    runStatus,
    threadTitle,
    updateThreadTitle,
    sendMessage,
    stopStream,
    resumeInterrupt,
    threadId,
    resourceId,
    workspaceId,
  } = useChatContext();

  const submitDisabled = isLoading || !assistant;
  const hasSendableAttachments = attachments.some(
    (attachment) => !attachment.error
  );
  const errorMessage = formatChatError(error);

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(threadTitle);
    }
  }, [isEditingTitle, threadTitle]);

  useEffect(() => {
    setShowIntermediateResults(false);
  }, [threadId]);

  useEffect(() => {
    if (isLoading) {
      setShowIntermediateResults(false);
    }
  }, [isLoading]);

  const startTitleEdit = useCallback(() => {
    setTitleDraft(threadTitle);
    setIsEditingTitle(true);
  }, [threadTitle]);

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(threadTitle);
    setIsEditingTitle(false);
  }, [threadTitle]);

  const saveTitleEdit = useCallback(async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      toast.error("标题不能为空");
      return;
    }

    setIsSavingTitle(true);
    try {
      await updateThreadTitle(nextTitle);
      setIsEditingTitle(false);
      toast.success("标题已更新");
    } catch (titleError) {
      toast.error(
        titleError instanceof Error ? titleError.message : "标题更新失败"
      );
    } finally {
      setIsSavingTitle(false);
    }
  }, [titleDraft, updateThreadTitle]);

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

  const handleAttachmentFiles = useCallback(
    async (fileList: FileList | null) => {
      const files = Array.from(fileList ?? []);
      if (files.length === 0) return;

      const preparedAttachments = await Promise.all(
        files.map((file) =>
          prepareAttachment(file, { resourceId, workspaceId, threadId })
        )
      );
      setAttachments((current) => [...current, ...preparedAttachments]);
    },
    [resourceId, threadId, workspaceId]
  );

  const resetChatDropState = useCallback(() => {
    chatDragDepthRef.current = 0;
    setIsChatDropActive(false);
  }, []);

  const handleChatDragEnter = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAttachmentDropData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      chatDragDepthRef.current += 1;
      setIsChatDropActive(true);
    },
    []
  );

  const handleChatDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAttachmentDropData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = submitDisabled ? "none" : "copy";
      setIsChatDropActive(true);
    },
    [submitDisabled]
  );

  const handleChatDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAttachmentDropData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      chatDragDepthRef.current = Math.max(0, chatDragDepthRef.current - 1);
      if (chatDragDepthRef.current === 0) {
        setIsChatDropActive(false);
      }
    },
    []
  );

  const handleChatDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasAttachmentDropData(event.dataTransfer)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      resetChatDropState();

      if (submitDisabled) {
        toast.error("当前会话正在运行，完成后再添加附件。");
        return;
      }

      const workspacePayload = event.dataTransfer.getData(
        WORKSPACE_FILE_DRAG_MIME
      );
      if (!workspacePayload) {
        await handleAttachmentFiles(event.dataTransfer.files);
        return;
      }

      const payload = parseWorkspaceFileDragPayload(workspacePayload);
      if (!payload) {
        toast.error("无法识别这个工作区文件。");
        return;
      }

      if (!isWorkspaceFileAttachmentAllowed(payload)) {
        toast.warning(
          `不支持添加 ${payload.name}。${SUPPORTED_ATTACHMENT_HINT}`
        );
        return;
      }

      setIsPreparingDroppedAttachment(true);
      try {
        const file = await workspaceDragPayloadToFile(payload, {
          resourceId,
          workspaceId,
          threadId,
        });
        const attachment = await prepareAttachment(file, {
          resourceId,
          workspaceId,
          threadId,
        });

        if (attachment.error) {
          toast.error(`${attachment.name}: ${attachment.error}`);
          return;
        }

        setAttachments((current) => [...current, attachment]);
        toast.success(`已添加 ${attachment.name}`);
      } catch (dropError) {
        toast.error(
          dropError instanceof Error
            ? dropError.message
            : "无法添加工作区文件。"
        );
      } finally {
        setIsPreparingDroppedAttachment(false);
      }
    },
    [
      handleAttachmentFiles,
      resetChatDropState,
      resourceId,
      submitDisabled,
      threadId,
      workspaceId,
    ]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id)
    );
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (submitDisabled) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
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
      processedArray.flatMap((data) =>
        data.toolCalls.map((toolCall) => toolCall.id)
      )
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

  const showRuntimeDetails = isLoading || Boolean(interrupt);
  const visibleMessages = useMemo(() => {
    if (showRuntimeDetails) {
      return processedMessages;
    }

    return processedMessages.filter((data) => {
      if (data.message.type !== "ai") {
        return true;
      }
      return extractStringFromMessageContent(data.message).trim() !== "";
    });
  }, [processedMessages, showRuntimeDetails]);

  const shouldShowThinkingPlaceholder = useMemo(() => {
    if (runStatus !== "running" || interrupt || error) {
      return false;
    }

    const lastHumanIndex = visibleMessages.findLastIndex(
      (data) => data.message.type === "human"
    );
    if (lastHumanIndex === -1) {
      return false;
    }

    return true;
  }, [error, interrupt, runStatus, visibleMessages]);

  const thinkingPlaceholderMessage = useMemo(
    () =>
      ({
        id: "__internagents-thinking-placeholder__",
        type: "ai",
        content: "正在思考中...",
      } as Message),
    []
  );

  const displayMessages = useMemo(() => {
    const displayableMessages = visibleMessages.filter((data) => {
      if (data.message.type !== "ai") {
        return true;
      }
      return (
        extractStringFromMessageContent(data.message).trim() !== "" ||
        data.toolCalls.length > 0
      );
    });

    if (!shouldShowThinkingPlaceholder) {
      return displayableMessages;
    }

    return [
      ...displayableMessages,
      {
        message: thinkingPlaceholderMessage,
        toolCalls: [] as ToolCall[],
      },
    ];
  }, [
    shouldShowThinkingPlaceholder,
    thinkingPlaceholderMessage,
    visibleMessages,
  ]);

  const completedMessageId = useMemo(() => {
    if (
      showRuntimeDetails ||
      error ||
      (runStatus !== "completed" && runStatus !== "idle")
    ) {
      return null;
    }

    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index].message;
      if (message.type === "ai") {
        return message.id ?? null;
      }
    }

    return null;
  }, [error, runStatus, showRuntimeDetails, visibleMessages]);

  const intermediateMessages = useMemo(() => {
    if (showRuntimeDetails) {
      return [];
    }

    return processedMessages.filter((data) => data.toolCalls.length > 0);
  }, [processedMessages, showRuntimeDetails]);

  const shouldShowTodosComplete =
    runStatus === "completed" ||
    (runStatus === "idle" &&
      !isThreadLoading &&
      !isLoading &&
      !interrupt &&
      !error);
  const displayTodos = useMemo(
    () =>
      shouldShowTodosComplete
        ? todos.map((todo) => ({ ...todo, status: "completed" as const }))
        : todos,
    [shouldShowTodosComplete, todos]
  );

  const groupedTodos = {
    in_progress: displayTodos.filter((t) => t.status === "in_progress"),
    pending: displayTodos.filter((t) => t.status === "pending"),
    completed: displayTodos.filter((t) => t.status === "completed"),
  };

  const hasTasks = displayTodos.length > 0;
  const hasFiles = Object.keys(files).length > 0;
  const hasGoal = Boolean(goal?.objective);

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

  const dropOverlayVisible = isChatDropActive || isPreparingDroppedAttachment;
  const dropOverlayTitle = isPreparingDroppedAttachment
    ? "正在添加附件..."
    : submitDisabled
    ? "当前运行中，暂不能添加附件"
    : "松开添加到会话";
  const dropOverlayDescription = submitDisabled
    ? "请等待本轮运行完成。"
    : SUPPORTED_ATTACHMENT_HINT;

  return (
    <div
      className={cn(
        "relative flex flex-1 flex-col overflow-hidden bg-card/70 transition-[box-shadow,background-color]",
        dropOverlayVisible && "bg-primary/5 ring-1 ring-inset ring-primary/35"
      )}
      onDragEnter={handleChatDragEnter}
      onDragOver={handleChatDragOver}
      onDragLeave={handleChatDragLeave}
      onDrop={handleChatDrop}
      data-chat-drop-root="true"
    >
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/90 px-4 py-2">
        <div className="min-w-0 flex-1">
          {isEditingTitle ? (
            <Input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveTitleEdit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelTitleEdit();
                }
              }}
              disabled={isSavingTitle}
              autoFocus
              className="h-7 max-w-xl"
              aria-label="会话标题"
            />
          ) : (
            <h2 className="truncate text-sm font-semibold text-foreground">
              {threadTitle}
            </h2>
          )}
        </div>

        {isEditingTitle ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => void saveTitleEdit()}
              disabled={isSavingTitle}
              aria-label="保存会话标题"
            >
              {isSavingTitle ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={cancelTitleEdit}
              disabled={isSavingTitle}
              aria-label="取消更改标题"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-primary"
                onClick={startTitleEdit}
                disabled={isThreadLoading}
                aria-label="更改会话标题"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="center"
              sideOffset={6}
              className="whitespace-nowrap"
            >
              更改会话标题
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-card/70"
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
              {hasGoal && goal && (
                <div className="mb-4 rounded-lg border border-border bg-card px-4 py-3 shadow-sm shadow-black/[0.03]">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    <Target className="h-4 w-4 text-primary" />
                    Goal
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-semibold normal-case tracking-normal",
                        goalStatusClassName(goal.status)
                      )}
                    >
                      {goalStatusLabel(goal.status)}
                    </span>
                    <span className="normal-case tracking-normal">
                      {formatGoalElapsed(goal.timeUsedSeconds || 0)}
                    </span>
                    {typeof goal.tokenBudget === "number" && (
                      <span className="normal-case tracking-normal">
                        Tokens {goal.tokensUsed || 0}/{goal.tokenBudget}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    {goal.objective}
                  </div>
                </div>
              )}
              {displayMessages.map((data, index) => {
                const messageUi = ui?.filter(
                  (u: any) => u.metadata?.message_id === data.message.id
                );
                const isLastMessage = index === displayMessages.length - 1;
                const prevVisibleMessage =
                  index > 0 ? displayMessages[index - 1].message : null;
                return (
                  <ChatMessage
                    key={data.message.id}
                    message={data.message}
                    toolCalls={showRuntimeDetails ? data.toolCalls : []}
                    showAvatar={data.message.type !== prevVisibleMessage?.type}
                    isLoading={isLoading}
                    actionRequestsMap={
                      isLastMessage ? actionRequestsMap : undefined
                    }
                    reviewConfigsMap={
                      isLastMessage ? reviewConfigsMap : undefined
                    }
                    ui={showRuntimeDetails ? messageUi : undefined}
                    stream={stream}
                    onResumeInterrupt={resumeInterrupt}
                    graphId={assistant?.graph_id}
                  />
                );
              })}
              {intermediateMessages.length > 0 && (
                <div className="ml-10 mt-4 overflow-hidden rounded-md border border-border/30 bg-muted/5 text-muted-foreground/70">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted/10"
                    onClick={() =>
                      setShowIntermediateResults((current) => !current)
                    }
                    aria-expanded={showIntermediateResults}
                  >
                    <span>
                      中间过程 · {intermediateMessages.length} 步
                    </span>
                    {showIntermediateResults ? (
                      <ChevronUp className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  {showIntermediateResults && (
                    <div className="border-t border-border/30 px-3 pb-3">
                      {intermediateMessages.map((data, index) => {
                        const messageUi = ui?.filter(
                          (u: any) => u.metadata?.message_id === data.message.id
                        );
                        return (
                          <ChatMessage
                            key={`intermediate-${data.message.id ?? index}`}
                            message={data.message}
                            toolCalls={data.toolCalls}
                            showAvatar={false}
                            isLoading={false}
                            runtimeMuted
                            ui={messageUi}
                            stream={stream}
                            onResumeInterrupt={resumeInterrupt}
                            graphId={assistant?.graph_id}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {completedMessageId && (
                <div className="ml-10 mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span>已完成</span>
                </div>
              )}
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

      <div className="flex-shrink-0 border-t border-border/70 bg-background/80">
        <div
          className={cn(
            "mx-4 mb-5 mt-3 flex flex-shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg shadow-black/[0.04]",
            "mx-auto w-[calc(100%-32px)] max-w-[1024px] transition-colors duration-200 ease-in-out"
          )}
          data-tour="chat-input"
        >
          {(hasGoal || hasTasks || hasFiles) && (
            <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-muted/50 empty:hidden">
              {!metaOpen && (
                <>
                  {(() => {
                    const activeTask = displayTodos.find(
                      (t) => t.status === "in_progress"
                    );

                    const totalTasks = displayTodos.length;
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
                          className="grid w-full cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
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
                                  所有子任务已完成
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
                                  子任务{" "}
                                  {totalTasks - groupedTodos.pending.length} /{" "}
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
                                子任务 {totalTasks - groupedTodos.pending.length}{" "}
                                / {totalTasks}
                              </span>,
                            ];
                          })()}
                        </button>
                      );
                    })();

                    const goalTrigger = (() => {
                      if (!hasGoal || !goal) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "goal" ? null : "goal"
                            )
                          }
                          className="grid w-full cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
                          aria-expanded={metaOpen === "goal"}
                        >
                          <Target
                            size={16}
                            className="text-primary"
                          />
                          <span className="ml-[1px] min-w-0 truncate text-sm">
                            Goal · {goalStatusLabel(goal.status)}
                          </span>
                          <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {goal.objective}
                          </span>
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
                          className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm transition-colors hover:bg-accent/70"
                          aria-expanded={metaOpen === "files"}
                        >
                          <FileIcon size={16} />
                          Files (State)
                          <span className="text-primary-foreground h-4 min-w-4 rounded-full bg-primary px-0.5 text-center text-xs leading-[16px]">
                            {Object.keys(files).length}
                          </span>
                        </button>
                      );
                    })();

                    return (
                      <div className="grid grid-cols-[1fr_auto_auto] items-center">
                        {goalTrigger || tasksTrigger}
                        {goalTrigger ? tasksTrigger : null}
                        {filesTrigger}
                      </div>
                    );
                  })()}
                </>
              )}

              {metaOpen && (
                <>
                  <div className="sticky top-0 flex items-stretch border-b border-border bg-card text-sm">
                    {hasGoal && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "goal" ? null : "goal"
                          )
                        }
                        aria-expanded={metaOpen === "goal"}
                      >
                        <Target className="h-4 w-4 text-primary" />
                        Goal
                      </button>
                    )}
                    {hasTasks && (
                      <button
                        type="button"
                        className="py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "tasks" ? null : "tasks"
                          )
                        }
                        aria-expanded={metaOpen === "tasks"}
                      >
                        子任务
                      </button>
                    )}
                    {hasFiles && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "files" ? null : "files"
                          )
                        }
                        aria-expanded={metaOpen === "files"}
                      >
                        Files (State)
                        <span className="text-primary-foreground h-4 min-w-4 rounded-full bg-primary px-0.5 text-center text-xs leading-[16px]">
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
                    {metaOpen === "goal" && goal && (
                      <div className="mb-5 rounded-md border border-border bg-card px-3 py-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs font-semibold",
                              goalStatusClassName(goal.status)
                            )}
                          >
                            {goalStatusLabel(goal.status)}
                          </span>
                          <span>
                            {formatGoalElapsed(goal.timeUsedSeconds || 0)}
                          </span>
                          {typeof goal.tokenBudget === "number" && (
                            <span>
                              Tokens {goal.tokensUsed || 0}/{goal.tokenBudget}
                            </span>
                          )}
                        </div>
                        <div className="text-sm leading-6 text-foreground">
                          {goal.objective}
                        </div>
                      </div>
                    )}

                    {metaOpen === "tasks" &&
                      Object.entries(groupedTodos)
                        .filter(([_, todos]) => todos.length > 0)
                        .map(([status, todos]) => (
                          <div
                            key={status}
                            className="mb-4"
                          >
                            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-tertiary">
                              {todoStatusLabel(status as TodoItem["status"])}
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
            className="relative flex flex-col"
          >
            {dropOverlayVisible && (
              <div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-4 backdrop-blur-[1px]"
                data-chat-drop-overlay="true"
              >
                <div className="flex min-w-56 flex-col items-center gap-2 rounded-md border border-dashed border-primary/45 bg-card/90 px-5 py-4 text-center shadow-lg shadow-black/[0.04]">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {isPreparingDroppedAttachment ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    {dropOverlayTitle}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {dropOverlayDescription}
                  </div>
                </div>
              </div>
            )}
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
                      {attachment.error ||
                        formatAttachmentSize(attachment.size)}
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
              className="font-inherit field-sizing-content min-h-[68px] flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[16px] text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
              rows={2}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/60 p-3">
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={submitDisabled}
                      aria-label="添加图片"
                    >
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="center"
                    sideOffset={6}
                    className="whitespace-nowrap"
                  >
                    添加图片
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={submitDisabled}
                      aria-label="添加附件(文本或PDF)"
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="center"
                    sideOffset={6}
                    className="whitespace-nowrap"
                  >
                    添加附件(文本或PDF)
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type={isLoading ? "button" : "submit"}
                  variant={isLoading ? "destructive" : "default"}
                  onClick={isLoading ? stopStream : handleSubmit}
                  disabled={
                    !isLoading &&
                    (submitDisabled ||
                      (!input.trim() && !hasSendableAttachments))
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
