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
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Square,
  ArrowUp,
  AtSign,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  CheckCircle2,
  Clock,
  Circle,
  Copy,
  FileIcon,
  ImagePlus,
  Loader2,
  Paperclip,
  Pencil,
  Sparkles,
  Plug,
  RotateCcw,
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
  ScpCatalogItem,
  ScpInvocationState,
  ThreadSkillItem,
  ThreadSkillsState,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import {
  extractStringFromMessageContent,
  extractVisibleStringFromMessageContent,
} from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { useQueryState } from "nuqs";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import {
  WORKSPACE_FILE_DRAG_MIME,
  parseWorkspaceFileDragPayload,
  type WorkspaceFileDragPayload,
} from "@/app/utils/workspaceDrag";
import type { SkillEntry, SkillsConfigResponse } from "@/app/skills/types";

interface ChatInterfaceProps {
  assistant: Assistant | null;
  headerActions?: React.ReactNode;
}

const MAX_IMAGE_ATTACHMENT_SIZE = 8 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_SIZE = 128 * 1024;
const MAX_PDF_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const MAX_OFFICE_ATTACHMENT_SIZE = 16 * 1024 * 1024;
const SUPPORTED_ATTACHMENT_HINT =
  "支持图片、PDF、Word、Excel、PPT 和文本文件。";
const MAX_MENTION_OPTIONS = 10;
const COMPOSER_DRAFT_QUERY_KEY = "composerDraft";
const CHAT_COMPOSER_HASH = "#chat-composer";
const DEFAULT_SEND_SHORTCUT_MODIFIER = "Ctrl";

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
const OFFICE_ATTACHMENT_MIME_TYPES: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const OFFICE_ATTACHMENT_EXTENSIONS = new Set(
  Object.keys(OFFICE_ATTACHMENT_MIME_TYPES)
);
const AUTO_ATTACHMENT_THREAD_SKILLS: Record<
  "pdf" | "docx" | "xlsx" | "pptx",
  Omit<ThreadSkillItem, "addedAt">
> = {
  pdf: {
    key: "skills/pdf",
    name: "pdf",
    description: "自动为 PDF 附件加载。",
    relativePath: "skills/pdf",
    folderName: "pdf",
  },
  docx: {
    key: "skills/docx",
    name: "docx",
    description: "自动为 DOCX 附件加载。",
    relativePath: "skills/docx",
    folderName: "docx",
  },
  xlsx: {
    key: "skills/xlsx",
    name: "xlsx",
    description: "自动为 XLSX 附件加载。",
    relativePath: "skills/xlsx",
    folderName: "xlsx",
  },
  pptx: {
    key: "skills/pptx",
    name: "pptx",
    description: "自动为 PPTX 附件加载。",
    relativePath: "skills/pptx",
    folderName: "pptx",
  },
};
const AUTO_ATTACHMENT_SKILL_BY_MIME: Record<string, keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS> = {
  "application/pdf": "pdf",
  "application/msword": "docx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
};
const AUTO_ATTACHMENT_SKILL_BY_EXTENSION: Record<
  string,
  keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS
> = {
  pdf: "pdf",
  doc: "docx",
  docx: "docx",
  xls: "xlsx",
  xlsx: "xlsx",
  ppt: "pptx",
  pptx: "pptx",
};

interface AttachmentUploadContext {
  resourceId?: string;
  workspaceId?: string;
  threadId?: string | null;
}

interface MentionContext {
  start: number;
  query: string;
}

interface MentionMenuPosition {
  bottom: number;
  left: number;
  width: number;
}

function getMentionContext(value: string, cursor: number): MentionContext | null {
  const beforeCursor = value.slice(0, cursor);
  const atIndex = beforeCursor.lastIndexOf("@");

  if (atIndex === -1) {
    return null;
  }

  const query = beforeCursor.slice(atIndex + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return { start: atIndex, query };
}

function skillMatchesQuery(skill: SkillEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [skill.name, skill.description, skill.key, skill.relativePath].some(
    (value) => value.toLowerCase().includes(normalizedQuery)
  );
}

function threadSkillFromEntry(skill: SkillEntry): ThreadSkillItem {
  return {
    key: skill.key,
    name: skill.name,
    description: skill.description,
    relativePath: skill.relativePath,
    folderName: skill.folderName,
    addedAt: Math.floor(Date.now() / 1000),
  };
}

function addThreadSkillItem(
  current: ThreadSkillsState | null | undefined,
  skill: ThreadSkillItem
): ThreadSkillsState {
  const active = current?.active ?? [];
  if (active.some((item) => item.key === skill.key)) {
    return {
      revision: current?.revision ?? 0,
      active,
    };
  }

  return {
    revision: (current?.revision ?? 0) + 1,
    active: [...active, skill],
  };
}

function addThreadSkill(
  current: ThreadSkillsState | null | undefined,
  skill: SkillEntry
): ThreadSkillsState {
  return addThreadSkillItem(current, threadSkillFromEntry(skill));
}

function autoSkillNamesForAttachment(
  attachment: ChatAttachment
): Set<keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS> {
  const names = new Set<keyof typeof AUTO_ATTACHMENT_THREAD_SKILLS>();
  const mimeSkill =
    AUTO_ATTACHMENT_SKILL_BY_MIME[
      (attachment.mimeType || "").trim().toLowerCase()
    ];
  if (mimeSkill) {
    names.add(mimeSkill);
  }

  if (attachment.kind === "pdf") {
    names.add("pdf");
  }

  const candidates = [
    attachment.name,
    attachment.workspacePath,
    attachment.extractedWorkspacePath,
  ].filter((value): value is string => Boolean(value));
  for (const value of candidates) {
    const extension = getAttachmentFileKey(value);
    const extensionSkill = AUTO_ATTACHMENT_SKILL_BY_EXTENSION[extension];
    if (extensionSkill) {
      names.add(extensionSkill);
    }
  }

  return names;
}

function addAttachmentThreadSkills(
  current: ThreadSkillsState | null | undefined,
  attachments: ChatAttachment[]
): ThreadSkillsState | null {
  let next = current ?? { revision: 0, active: [] };
  let changed = false;
  const addedAt = Math.floor(Date.now() / 1000);

  for (const attachment of attachments) {
    if (attachment.error) {
      continue;
    }
    for (const skillName of autoSkillNamesForAttachment(attachment)) {
      const template = AUTO_ATTACHMENT_THREAD_SKILLS[skillName];
      if (next.active.some((item) => item.key === template.key)) {
        continue;
      }
      next = addThreadSkillItem(next, {
        ...template,
        addedAt,
      });
      changed = true;
    }
  }

  return changed ? next : null;
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

  if (isMalformedRemoteRuntimeError(message)) {
    return (
      "远程 Agent runtime 已返回错误，但当前 LangGraph SDK 无法解析该错误响应，" +
      "请查看 backend 和 runtime 日志获取真实失败原因。"
    );
  }

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

function isMalformedRemoteRuntimeError(message: string): boolean {
  return (
    /Response validation failed/i.test(message) &&
    /body\.error\.code/i.test(message)
  );
}

function extractRemoteRuntimeErrorMessage(message: string): string | null {
  if (!/RemoteException/i.test(message)) {
    return null;
  }

  const normalized = message.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const extracted =
    normalized.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ??
    null;

  const normalizedExtracted = extracted?.replace(
    /^远程 Agent runtime 执行失败[:：]\s*/,
    ""
  );

  if (isMalformedRemoteRuntimeError(normalizedExtracted ?? normalized)) {
    return (
      "远端 runtime 已返回错误，但当前 LangGraph SDK 无法解析该错误响应，" +
      "请查看 backend 和 runtime 日志获取真实失败原因。"
    );
  }

  if (/Insufficient credits/i.test(normalizedExtracted ?? normalized)) {
    return "集思额度不足，请提额后重试。";
  }

  if (/User not found|Unauthorized|401/i.test(normalizedExtracted ?? normalized)) {
    return "集思 key 无效或未授权，请在配置页重新绑定邮箱。";
  }

  return normalizedExtracted ?? null;
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

function scpStatusLabel(status: ScpInvocationState["status"]): string {
  switch (status) {
    case "complete":
      return "已完成";
    case "blocked":
      return "受阻";
    case "error":
      return "失败";
    default:
      return "进行中";
  }
}

function scpStatusClassName(status: ScpInvocationState["status"]): string {
  switch (status) {
    case "complete":
      return "border-success/30 bg-success/10 text-success";
    case "blocked":
      return "border-warning/30 bg-warning/10 text-warning";
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300";
    default:
      return "border-primary/30 bg-primary/10 text-primary";
  }
}

function isScpCommandInput(value: string): boolean {
  return /^\/scp(?:\s|$)/i.test(value.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inputContainsScpSelection(
  value: string,
  selection: ScpCatalogItem
): boolean {
  const trimmed = value.trim();
  return (
    new RegExp(`\\bskill=${escapeRegExp(selection.skillName)}\\b`, "i").test(
      trimmed
    ) &&
    new RegExp(`\\btool=${escapeRegExp(selection.toolName)}\\b`, "i").test(
      trimmed
    )
  );
}

function extractScpPromptDraft(value: string): string {
  const match = value.trim().match(/^\/scp(?:\s+([\s\S]+))?$/i);
  if (!match) return value.trim();

  let prompt = match[1]?.trim() ?? "";
  while (/^(?:skill|tool)=[^\s]+\s*/i.test(prompt)) {
    prompt = prompt.replace(/^(?:skill|tool)=[^\s]+\s*/i, "").trim();
  }
  return prompt;
}

function buildScpCommand(selection: ScpCatalogItem, prompt: string): string {
  const trimmedPrompt = prompt.trim();
  const prefix = `/scp skill=${selection.skillName} tool=${selection.toolName}`;
  return trimmedPrompt ? `${prefix} ${trimmedPrompt}` : `${prefix} `;
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

function isOfficeAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  const fileKey = getAttachmentFileKey(fileName);
  return (
    OFFICE_ATTACHMENT_EXTENSIONS.has(fileKey) ||
    Object.values(OFFICE_ATTACHMENT_MIME_TYPES).includes(
      (mimeType || "").toLowerCase()
    )
  );
}

function isSupportedAttachmentDescriptor(
  fileName: string,
  mimeType?: string
): boolean {
  return (
    Boolean(mimeType?.startsWith("image/")) ||
    isPdfAttachmentDescriptor(fileName, mimeType) ||
    isOfficeAttachmentDescriptor(fileName, mimeType) ||
    isTextAttachmentDescriptor(fileName, mimeType)
  );
}

function isTextAttachment(file: File): boolean {
  return isTextAttachmentDescriptor(file.name, file.type);
}

function isPdfAttachment(file: File): boolean {
  return isPdfAttachmentDescriptor(file.name, file.type);
}

function isOfficeAttachment(file: File): boolean {
  return isOfficeAttachmentDescriptor(file.name, file.type);
}

function getAttachmentMimeType(file: File): string {
  const fileKey = getAttachmentFileKey(file.name);
  return (
    file.type ||
    OFFICE_ATTACHMENT_MIME_TYPES[fileKey] ||
    (PDF_ATTACHMENT_EXTENSIONS.has(fileKey) ? "application/pdf" : "") ||
    "application/octet-stream"
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

async function uploadBinaryAttachment(
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
    throw new Error(payload.error || `附件上传失败（${response.status}）`);
  }
  return payload.attachment;
}

async function uploadWorkspaceOfficeAttachment(
  payload: WorkspaceFileDragPayload,
  context: AttachmentUploadContext
): Promise<Partial<ChatAttachment>> {
  const form = new FormData();
  form.set("workspacePath", payload.path);
  const effectiveResourceId = payload.resourceId || context.resourceId;
  const effectiveWorkspaceId = payload.workspaceId || context.workspaceId;
  if (effectiveResourceId) {
    form.set("resourceId", effectiveResourceId);
  }
  if (effectiveWorkspaceId) {
    form.set("workspaceId", effectiveWorkspaceId);
  }
  if (context.threadId) {
    form.set("threadId", context.threadId);
  }

  const response = await fetch("/api/workspace/attachments", {
    method: "POST",
    body: form,
  });
  const responsePayload = (await parsePdfUploadResponse(response)) as {
    attachment?: Partial<ChatAttachment>;
    error?: string;
  };
  if (!response.ok || !responsePayload.attachment) {
    throw new Error(
      responsePayload.error || `工作区附件处理失败（${response.status}）`
    );
  }
  return responsePayload.attachment;
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
    error: text && text !== "Internal Server Error" ? text : "附件上传失败",
  };
}

function writeTextToClipboardFallback(text: string): void {
  const textArea = document.createElement("textarea");
  const selection = document.getSelection();
  const selectedRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    document.body.removeChild(textArea);
    if (selection && selectedRange) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
    }
  }
}

async function writeTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose Clipboard API but still reject it for focus or
      // permission reasons. Fall through to the legacy copy path.
    }
  }

  writeTextToClipboardFallback(text);
}

async function prepareAttachment(
  file: File,
  context: AttachmentUploadContext
): Promise<ChatAttachment> {
  const baseAttachment = {
    id: createAttachmentId(),
    name: file.name,
    mimeType: getAttachmentMimeType(file),
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
      const uploaded = await uploadBinaryAttachment(file, context);
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

  if (isOfficeAttachment(file)) {
    if (file.size > MAX_OFFICE_ATTACHMENT_SIZE) {
      return {
        ...baseAttachment,
        kind: "file",
        error: "Office 文件超过 16 MB",
      };
    }

    try {
      const uploaded = await uploadBinaryAttachment(file, context);
      return {
        ...baseAttachment,
        ...uploaded,
        kind: "file",
      };
    } catch (error) {
      return {
        ...baseAttachment,
        kind: "file",
        error: error instanceof Error ? error.message : "附件上传失败",
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
    payload.previewKind === "docx" ||
    payload.previewKind === "image" ||
    payload.previewKind === "pdf" ||
    payload.previewKind === "pptx" ||
    payload.previewKind === "markdown" ||
    payload.previewKind === "text" ||
    payload.previewKind === "xlsx"
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

function isWorkspaceOfficeAttachment(payload: WorkspaceFileDragPayload): boolean {
  if (
    payload.previewKind === "docx" ||
    payload.previewKind === "pptx" ||
    payload.previewKind === "xlsx"
  ) {
    return true;
  }

  const descriptorName = payload.extension
    ? `${payload.name}${payload.extension.startsWith(".") ? "" : "."}${
        payload.extension
      }`
    : payload.name;
  return isOfficeAttachmentDescriptor(descriptorName);
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

function isToolCancellationResult(result: string): boolean {
  const normalized = result.toLowerCase();
  return (
    normalized.includes("was cancelled") ||
    normalized.includes("was canceled") ||
    (normalized.includes("tool call") &&
      (normalized.includes("cancelled") || normalized.includes("canceled"))) ||
    result.includes("已取消") ||
    result.includes("已中断")
  );
}

function settledPendingToolCallStatus(
  runStatus: string
): Pick<ToolCall, "status" | "result"> {
  if (runStatus === "stopped" || runStatus === "interrupted") {
    return {
      status: "interrupted",
      result: "工具调用已被中断，没有返回结果。",
    };
  }

  return {
    status: "error",
    result: "工具调用结束时没有返回结果。可能是工具服务超时、被取消，或 runtime 没有收到结果。",
  };
}

function messageHasVisibleContent(message: Message): boolean {
  return extractVisibleStringFromMessageContent(message).trim() !== "";
}

function hasTerminalToolIssue(toolCalls: ToolCall[]): boolean {
  return toolCalls.some(
    (toolCall) =>
      Boolean(toolCall.result) &&
      (toolCall.status === "error" || toolCall.status === "interrupted")
  );
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
          status:
            rawMessage.status === "error"
              ? "error"
              : isToolCancellationResult(
                  extractStringFromMessageContent(rawMessage as Message)
                )
              ? "interrupted"
              : "completed",
          result: extractStringFromMessageContent(rawMessage as Message),
        };
        break;
      }
    }
  }

  return Array.from(remoteMessages.values());
}

export const ChatInterface = React.memo<ChatInterfaceProps>(
  ({ assistant, headerActions }) => {
  const [metaOpen, setMetaOpen] = useState<
    "goal" | "scp" | "skills" | "tasks" | "files" | null
  >(null);
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scpCatalogRequestInFlightRef = useRef(false);
  const chatDragDepthRef = useRef(0);
  const suppressSkillsMetaToggleUntilRef = useRef(0);
  const [, setSelectedFilePath] = useQueryState("file");

  const [input, setInput] = useState("");
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionContext, setMentionContext] = useState<MentionContext | null>(
    null
  );
  const [mentionSkills, setMentionSkills] = useState<SkillEntry[]>([]);
  const [mentionSkillsLoaded, setMentionSkillsLoaded] = useState(false);
  const [mentionSkillsLoading, setMentionSkillsLoading] = useState(false);
  const [mentionSkillsError, setMentionSkillsError] = useState<string | null>(
    null
  );
  const [mentionMenuPosition, setMentionMenuPosition] =
    useState<MentionMenuPosition | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [isChatDropActive, setIsChatDropActive] = useState(false);
  const [isPreparingDroppedAttachment, setIsPreparingDroppedAttachment] =
    useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const openAttachmentPreview = useCallback(
    (workspacePath: string) => {
      const normalizedPath = workspacePath.replace(/^\/+/, "");
      if (normalizedPath) {
        void setSelectedFilePath(normalizedPath);
      }
    },
    [setSelectedFilePath]
  );

  const updateMentionMenuPosition = useCallback(() => {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }

    const rect = composer.getBoundingClientRect();
    const width = Math.min(288, Math.max(220, rect.width - 32));
    const left = Math.min(
      Math.max(rect.left + 16, 8),
      window.innerWidth - width - 8
    );

    setMentionMenuPosition({
      bottom: Math.max(8, window.innerHeight - rect.top + 8),
      left,
      width,
    });
  }, []);

  const openMentionMenu = useCallback((context: MentionContext) => {
    setMentionContext(context);
    setMentionMenuOpen(true);
    setActiveMentionIndex(0);
    window.requestAnimationFrame(updateMentionMenuPosition);
  }, [updateMentionMenuPosition]);

  const closeMentionMenu = useCallback(() => {
    setMentionMenuOpen(false);
    setMentionContext(null);
    setMentionMenuPosition(null);
    setActiveMentionIndex(0);
  }, []);

  const insertMentionTrigger = useCallback(() => {
    const textarea = textareaRef.current;
    const cursorStart = textarea?.selectionStart ?? input.length;
    const cursorEnd = textarea?.selectionEnd ?? cursorStart;
    const prefix = input.slice(0, cursorStart);
    const suffix = input.slice(cursorEnd);
    const needsLeadingSpace =
      prefix.length > 0 && !/\s$/.test(prefix) && !prefix.endsWith("@");
    const inserted = `${needsLeadingSpace ? " " : ""}@`;
    const nextInput = `${prefix}${inserted}${suffix}`;
    const nextMentionStart = prefix.length + (needsLeadingSpace ? 1 : 0);
    const nextCursor = prefix.length + inserted.length;

    setInput(nextInput);
    openMentionMenu({ start: nextMentionStart, query: "" });

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [input, openMentionMenu]);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [sendShortcutModifier, setSendShortcutModifier] = useState(
    DEFAULT_SEND_SHORTCUT_MODIFIER
  );
  const [showIntermediateResults, setShowIntermediateResults] =
    useState(false);
  const [scpCatalog, setScpCatalog] = useState<ScpCatalogItem[]>([]);
  const [isScpCatalogLoading, setIsScpCatalogLoading] = useState(false);
  const [scpCatalogError, setScpCatalogError] = useState<string | null>(null);
  const [pendingScpSelection, setPendingScpSelection] =
    useState<ScpCatalogItem | null>(null);
  const { scrollRef, contentRef } = useStickToBottom();

  const {
    stream,
    messages,
    streamEvents,
    todos,
    files,
    goal,
    scpInvocation,
    threadSkills,
    ui,
    setFiles,
    updateThreadSkills,
    error,
    recoveryNotice,
    isLoading,
    isStreamRecovering,
    isThreadLoading,
    interrupt,
    runStatus,
    threadTitle,
    updateThreadTitle,
    sendMessage,
    retryMessage,
    stopStream,
    resumeInterrupt,
    threadId,
    resourceId,
    workspaceId,
  } = useChatContext();

  const composerBusy = isLoading || isStreamRecovering;
  const submitDisabled = composerBusy || !assistant;
  const activeThreadSkillKeys = useMemo(
    () => new Set((threadSkills?.active ?? []).map((skill) => skill.key)),
    [threadSkills]
  );
  const hasThreadSkills = Boolean(threadSkills?.active?.length);
  const hasSendableAttachments = attachments.some(
    (attachment) => !attachment.error
  );
  const applyAutoAttachmentSkills = useCallback(
    async (nextAttachments: ChatAttachment[]) => {
      const nextThreadSkills = addAttachmentThreadSkills(
        threadSkills,
        nextAttachments
      );
      if (!nextThreadSkills) {
        return;
      }

      suppressSkillsMetaToggleUntilRef.current = Date.now() + 500;
      setMetaOpen(null);
      await updateThreadSkills(nextThreadSkills);
    },
    [threadSkills, updateThreadSkills]
  );
  const errorMessage = formatChatError(error);
  const mentionQuery = mentionContext?.query ?? "";
  const sortedMentionSkills = useMemo(
    () =>
      [...mentionSkills].sort((left, right) => {
        if (left.enabled !== right.enabled) {
          return left.enabled ? -1 : 1;
        }
        return left.name.localeCompare(right.name, "zh-CN");
      }),
    [mentionSkills]
  );
  const filteredMentionSkills = useMemo(
    () =>
      sortedMentionSkills
        .filter((skill) => skillMatchesQuery(skill, mentionQuery))
        .slice(0, MAX_MENTION_OPTIONS),
    [mentionQuery, sortedMentionSkills]
  );

  const loadMentionSkills = useCallback(async () => {
    if (mentionSkillsLoaded || mentionSkillsLoading) {
      return;
    }

    setMentionSkillsLoading(true);
    setMentionSkillsError(null);
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      const payload = (await response.json()) as Partial<SkillsConfigResponse> & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "能力插件列表加载失败");
      }

      setMentionSkills(Array.isArray(payload.skills) ? payload.skills : []);
      setMentionSkillsLoaded(true);
    } catch (loadError) {
      setMentionSkillsError(
        loadError instanceof Error ? loadError.message : "能力插件列表加载失败"
      );
    } finally {
      setMentionSkillsLoading(false);
    }
  }, [mentionSkillsLoaded, mentionSkillsLoading]);

  useEffect(() => {
    if (mentionMenuOpen) {
      void loadMentionSkills();
    }
  }, [loadMentionSkills, mentionMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const draft = currentUrl.searchParams.get(COMPOSER_DRAFT_QUERY_KEY);
    const shouldFocusComposer =
      currentUrl.hash === CHAT_COMPOSER_HASH || draft !== null;

    if (!shouldFocusComposer) {
      return;
    }

    if (draft !== null) {
      setInput(draft);
      closeMentionMenu();
      currentUrl.searchParams.delete(COMPOSER_DRAFT_QUERY_KEY);
      window.history.replaceState(
        null,
        "",
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
      );
    }

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (draft !== null) {
        textareaRef.current?.setSelectionRange(draft.length, draft.length);
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [closeMentionMenu]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery]);

  useEffect(() => {
    if (activeMentionIndex >= filteredMentionSkills.length) {
      setActiveMentionIndex(Math.max(0, filteredMentionSkills.length - 1));
    }
  }, [activeMentionIndex, filteredMentionSkills.length]);

  useEffect(() => {
    if (!mentionMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const clickedComposer = composerRef.current?.contains(target);
      const clickedMentionMenu = mentionMenuRef.current?.contains(target);
      if (
        composerRef.current &&
        !clickedComposer &&
        !clickedMentionMenu
      ) {
        closeMentionMenu();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [closeMentionMenu, mentionMenuOpen]);

  useEffect(() => {
    if (!mentionMenuOpen) {
      return;
    }

    updateMentionMenuPosition();
    window.addEventListener("resize", updateMentionMenuPosition);
    window.addEventListener("scroll", updateMentionMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMentionMenuPosition);
      window.removeEventListener("scroll", updateMentionMenuPosition, true);
    };
  }, [mentionMenuOpen, updateMentionMenuPosition]);

  const isScpComposerCommand = isScpCommandInput(input);
  const scpPromptDraft = useMemo(() => extractScpPromptDraft(input), [input]);

  useEffect(() => {
    if (
      !isScpComposerCommand ||
      scpCatalog.length > 0 ||
      scpCatalogRequestInFlightRef.current
    ) {
      return;
    }

    let cancelled = false;
    scpCatalogRequestInFlightRef.current = true;
    setIsScpCatalogLoading(true);
    setScpCatalogError(null);

    void fetch("/api/scp/catalog", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          skills?: ScpCatalogItem[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || "无法读取 SCP catalog");
        }
        if (!cancelled) {
          setScpCatalog(Array.isArray(payload.skills) ? payload.skills : []);
        }
      })
      .catch((catalogError) => {
        if (!cancelled) {
          setScpCatalogError(
            catalogError instanceof Error
              ? catalogError.message
              : "无法读取 SCP catalog"
          );
        }
      })
      .finally(() => {
        scpCatalogRequestInFlightRef.current = false;
        if (!cancelled) {
          setIsScpCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
      scpCatalogRequestInFlightRef.current = false;
    };
  }, [isScpComposerCommand, scpCatalog.length]);

  const retryScpCatalogLoad = useCallback(() => {
    setScpCatalog([]);
    setScpCatalogError(null);
  }, []);

  const filteredScpCatalog = scpCatalog;

  const selectScpCatalogItem = useCallback(
    (item: ScpCatalogItem) => {
      setPendingScpSelection(item);
      setInput(buildScpCommand(item, scpPromptDraft));
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [scpPromptDraft]
  );

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(threadTitle);
    }
  }, [isEditingTitle, threadTitle]);

  useEffect(() => {
    setShowIntermediateResults(false);
  }, [threadId]);

  useEffect(() => {
    const platform = window.navigator.platform || window.navigator.userAgent;
    setSendShortcutModifier(
      /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl"
    );
  }, []);

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

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextInput = event.currentTarget.value;
      const cursor = event.currentTarget.selectionStart ?? nextInput.length;
      const nextMentionContext = getMentionContext(nextInput, cursor);

      setInput(nextInput);
      if (!isScpCommandInput(nextInput)) {
        setPendingScpSelection(null);
      } else if (
        pendingScpSelection &&
        !inputContainsScpSelection(nextInput, pendingScpSelection)
      ) {
        setPendingScpSelection(null);
      }

      if (nextMentionContext) {
        openMentionMenu(nextMentionContext);
      } else {
        closeMentionMenu();
      }
    },
    [closeMentionMenu, openMentionMenu, pendingScpSelection]
  );

  const selectMentionSkill = useCallback(
    (skill: SkillEntry) => {
      if (composerBusy) {
        toast.error("当前会话正在运行，结束后再添加技能。", {
          position: "top-center",
        });
        closeMentionMenu();
        return;
      }

      const textarea = textareaRef.current;
      const cursorEnd = textarea?.selectionEnd ?? input.length;
      const start = mentionContext?.start ?? cursorEnd;
      const nextInput = `${input.slice(0, start)}${input.slice(cursorEnd)}`;
      const nextCursor = start;
      const alreadyEnabled = activeThreadSkillKeys.has(skill.key);

      setInput(nextInput);
      closeMentionMenu();
      if (!alreadyEnabled) {
        const nextThreadSkills = addThreadSkill(threadSkills, skill);
        suppressSkillsMetaToggleUntilRef.current = Date.now() + 500;
        setMetaOpen(null);
        void updateThreadSkills(nextThreadSkills).catch((error) => {
          toast.error(
            error instanceof Error ? error.message : "技能添加失败",
            { position: "top-center" }
          );
        });
      }

      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    },
    [
      activeThreadSkillKeys,
      closeMentionMenu,
      composerBusy,
      input,
      mentionContext,
      threadSkills,
      updateThreadSkills,
    ]
  );

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
        composerBusy ||
        submitDisabled
      ) {
        return;
      }

      if (isScpCommandInput(messageText)) {
        if (!pendingScpSelection) {
          toast.error("请先选择一个 SCP skill/tool。");
          return;
        }
        if (!extractScpPromptDraft(messageText)) {
          toast.error("请输入要交给 SCP tool 的任务。");
          return;
        }
      }

      sendMessage(
        messageText,
        sendableAttachments,
        pendingScpSelection ? { scpSelection: pendingScpSelection } : undefined
      );
      setInput("");
      setAttachments([]);
      closeMentionMenu();
      setPendingScpSelection(null);
    },
    [
      attachments,
      closeMentionMenu,
      composerBusy,
      input,
      pendingScpSelection,
      sendMessage,
      setInput,
      submitDisabled,
    ]
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
      try {
        await applyAutoAttachmentSkills(preparedAttachments);
      } catch (skillError) {
        toast.error(
          skillError instanceof Error ? skillError.message : "自动加载技能失败",
          { position: "top-center" }
        );
      }
      setAttachments((current) => [...current, ...preparedAttachments]);
    },
    [applyAutoAttachmentSkills, resourceId, threadId, workspaceId]
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
        const attachmentContext = {
          resourceId,
          workspaceId,
          threadId,
        };
        const attachment = isWorkspaceOfficeAttachment(payload)
          ? ({
              id: createAttachmentId(),
              name: payload.name,
              mimeType:
                OFFICE_ATTACHMENT_MIME_TYPES[
                  getAttachmentFileKey(payload.name)
                ] || "application/octet-stream",
              size: payload.size || 0,
              kind: "file",
              ...(await uploadWorkspaceOfficeAttachment(
                payload,
                attachmentContext
              )),
            } satisfies ChatAttachment)
          : await prepareAttachment(
              await workspaceDragPayloadToFile(payload, attachmentContext),
              attachmentContext
            );

        if (attachment.error) {
          toast.error(`${attachment.name}: ${attachment.error}`);
          return;
        }

        try {
          await applyAutoAttachmentSkills([attachment]);
        } catch (skillError) {
          toast.error(
            skillError instanceof Error
              ? skillError.message
              : "自动加载技能失败",
            { position: "top-center" }
          );
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
      applyAutoAttachmentSkills,
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
      if (mentionMenuOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveMentionIndex((current) =>
            filteredMentionSkills.length === 0
              ? 0
              : (current + 1) % filteredMentionSkills.length
          );
          return;
        }

        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveMentionIndex((current) =>
            filteredMentionSkills.length === 0
              ? 0
              : (current - 1 + filteredMentionSkills.length) %
                filteredMentionSkills.length
          );
          return;
        }

        if (e.key === "Escape") {
          e.preventDefault();
          closeMentionMenu();
          return;
        }

        if (
          (e.key === "Enter" || e.key === "Tab") &&
          filteredMentionSkills.length > 0
        ) {
          e.preventDefault();
          selectMentionSkill(
            filteredMentionSkills[
              Math.min(activeMentionIndex, filteredMentionSkills.length - 1)
            ]
          );
          return;
        }
      }

      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [
      activeMentionIndex,
      closeMentionMenu,
      filteredMentionSkills,
      handleSubmit,
      mentionMenuOpen,
      selectMentionSkill,
      submitDisabled,
    ]
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
            status: isToolCancellationResult(
              extractStringFromMessageContent(message)
            )
              ? "interrupted"
              : (message as any).status === "error"
              ? "error"
              : "completed",
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

    const shouldFinalizePendingToolCalls =
      !isLoading &&
      !interrupt &&
      ["completed", "error", "idle", "interrupted", "stopped"].includes(
        runStatus
      );

    if (shouldFinalizePendingToolCalls) {
      const settledStatus = settledPendingToolCallStatus(runStatus);
      processedArray.forEach((data, index) => {
        const hasLaterAssistantAnswer = processedArray
          .slice(index + 1)
          .some(
            (laterData) =>
              laterData.message.type === "ai" &&
              messageHasVisibleContent(laterData.message)
          );
        if (hasLaterAssistantAnswer) {
          return;
        }

        data.toolCalls = data.toolCalls.map((toolCall) =>
          toolCall.status === "pending"
            ? { ...toolCall, ...settledStatus }
            : toolCall
        );
      });
    }

    return processedArray.map((data, index) => {
      const prevMessage = index > 0 ? processedArray[index - 1].message : null;
      return {
        ...data,
        showAvatar: data.message.type !== prevMessage?.type,
      };
    });
  }, [
    messages,
    streamEvents,
    interrupt,
    interruptedToolNames,
    isLoading,
    runStatus,
  ]);

  const showRuntimeDetails = isLoading || Boolean(interrupt);
  const terminalToolIssueMessageIds = useMemo(() => {
    const ids = new Set<string>();
    const runHasSettled =
      !isLoading &&
      !isStreamRecovering &&
      !interrupt &&
      ["completed", "error", "idle", "interrupted", "stopped"].includes(
        runStatus
      );
    if (!runHasSettled) {
      return ids;
    }

    for (let index = processedMessages.length - 1; index >= 0; index -= 1) {
      const data = processedMessages[index];
      if (
        data.message.type !== "ai" ||
        messageHasVisibleContent(data.message) ||
        !hasTerminalToolIssue(data.toolCalls)
      ) {
        continue;
      }

      const hasLaterAssistantAnswer = processedMessages
        .slice(index + 1)
        .some(
          (laterData) =>
            laterData.message.type === "ai" &&
            messageHasVisibleContent(laterData.message)
        );
      if (!hasLaterAssistantAnswer && data.message.id) {
        ids.add(data.message.id);
        break;
      }
    }

    return ids;
  }, [
    interrupt,
    isLoading,
    isStreamRecovering,
    processedMessages,
    runStatus,
  ]);
  const visibleMessages = useMemo(() => {
    if (showRuntimeDetails) {
      return processedMessages;
    }

    return processedMessages.filter((data) => {
      if (data.message.type !== "ai") {
        return true;
      }
      return (
        messageHasVisibleContent(data.message) ||
        Boolean(
          data.message.id && terminalToolIssueMessageIds.has(data.message.id)
        )
      );
    });
  }, [processedMessages, showRuntimeDetails, terminalToolIssueMessageIds]);

  const shouldShowThinkingPlaceholder = useMemo(() => {
    return runStatus === "running" || isLoading || isStreamRecovering;
  }, [isLoading, isStreamRecovering, runStatus]);

  const displayMessages = useMemo(() => {
    return visibleMessages.filter((data) => {
      if (data.message.type !== "ai") {
        return true;
      }
      return (
        messageHasVisibleContent(data.message) || data.toolCalls.length > 0
      );
    });
  }, [visibleMessages]);
  const shouldShowThreadLoading =
    isThreadLoading && messages.length === 0 && !recoveryNotice;
  const recoveredInputMessage = useMemo(() => {
    if (!recoveryNotice) {
      return null;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.type === "human") {
        return message;
      }
    }

    return null;
  }, [messages, recoveryNotice]);
  const recoveredInputText = useMemo(() => {
    return recoveredInputMessage
      ? extractVisibleStringFromMessageContent(recoveredInputMessage).trim()
      : "";
  }, [recoveredInputMessage]);
  const recoveredInputTextRef = useRef<HTMLPreElement>(null);
  const isStaleActiveRunNotice =
    recoveryNotice?.kind === "stale_active_run";

  const selectRecoveredInputText = useCallback(() => {
    const element = recoveredInputTextRef.current;
    const selection = document.getSelection();
    if (!element || !selection) {
      return false;
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }, []);

  const handleCopyRecoveredInput = useCallback(async () => {
    if (!recoveredInputText) {
      toast.error("没有可复制的原始输入。");
      return;
    }

    try {
      await writeTextToClipboard(recoveredInputText);
      toast.success("已复制原始输入。");
    } catch {
      const selected = selectRecoveredInputText();
      toast.error(
        selected
          ? "复制失败，已选中原始请求，请按 Cmd/Ctrl+C 复制。"
          : "复制失败，请手动选择原始请求复制。"
      );
    }
  }, [recoveredInputText, selectRecoveredInputText]);

  const handleRetryRecoveredInput = useCallback(() => {
    if (!recoveredInputMessage) {
      toast.error("没有可重新运行的原始输入。");
      return;
    }

    retryMessage(recoveredInputMessage, { previousMessages: [] });
  }, [recoveredInputMessage, retryMessage]);

  const completedAiMessage = useMemo<Message | null>(() => {
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
        return message;
      }
    }

    return null;
  }, [error, runStatus, showRuntimeDetails, visibleMessages]);

  const completedMessageCopyText = useMemo(() => {
    return completedAiMessage
      ? extractVisibleStringFromMessageContent(completedAiMessage).trim()
      : "";
  }, [completedAiMessage]);

  const handleCopyCompletedMessage = useCallback(async () => {
    if (!completedMessageCopyText) {
      toast.error("没有可复制的 AI 输出。");
      return;
    }

    try {
      await writeTextToClipboard(completedMessageCopyText);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动选择内容复制。");
    }
  }, [completedMessageCopyText]);

  const intermediateMessages = useMemo(() => {
    if (showRuntimeDetails) {
      return [];
    }

    return processedMessages.filter(
      (data) =>
        data.toolCalls.length > 0 &&
        !(
          data.message.id && terminalToolIssueMessageIds.has(data.message.id)
        )
    );
  }, [processedMessages, showRuntimeDetails, terminalToolIssueMessageIds]);

  const shouldShowTodosComplete =
    runStatus === "completed" ||
    (runStatus === "idle" &&
      !isThreadLoading &&
      !isLoading &&
      !isStreamRecovering &&
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

  const hasGoal = Boolean(goal?.objective);
  const hasScpInvocation = Boolean(scpInvocation?.prompt);
  const terminalToolIssueCalls = useMemo(
    () =>
      processedMessages
        .filter(
          (data) =>
            data.message.id && terminalToolIssueMessageIds.has(data.message.id)
        )
        .flatMap((data) =>
          data.toolCalls.filter(
            (toolCall) =>
              Boolean(toolCall.result) &&
              (toolCall.status === "error" ||
                toolCall.status === "interrupted")
          )
        ),
    [processedMessages, terminalToolIssueMessageIds]
  );
  const scpDisplay = useMemo(() => {
    const status = scpInvocation?.status ?? "active";
    const shouldOverrideActiveScp =
      Boolean(scpInvocation) &&
      status === "active" &&
      terminalToolIssueCalls.length > 0 &&
      !isLoading &&
      !isStreamRecovering &&
      !interrupt &&
      runStatus !== "running";

    if (!shouldOverrideActiveScp) {
      return {
        className: scpStatusClassName(status),
        label: scpStatusLabel(status),
        summary: scpInvocation?.summary,
      };
    }

    const hasMissingResult = terminalToolIssueCalls.some(
      (toolCall) => toolCall.status === "error"
    );
    const settledStatus: ScpInvocationState["status"] = hasMissingResult
      ? "error"
      : "blocked";

    return {
      className: scpStatusClassName(settledStatus),
      label: hasMissingResult ? "未返回结果" : "已中断",
      summary:
        scpInvocation?.summary ||
        (hasMissingResult
          ? "运行已结束，但工具没有返回最终结果。"
          : "运行已结束，工具调用被中断。"),
    };
  }, [
    interrupt,
    isLoading,
    isStreamRecovering,
    runStatus,
    scpInvocation,
    terminalToolIssueCalls,
  ]);
  const hasTasks = hasGoal && displayTodos.length > 0;
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
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
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
          </div>
        )}
      </div>

      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-card/70"
        ref={scrollRef}
      >
        <div
          className="mx-auto w-full max-w-[1180px] px-6 pb-6 pt-4"
          ref={contentRef}
        >
          {shouldShowThreadLoading ? (
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
                const messageKey =
                  data.message.id ?? `${data.message.type}-${index}`;
                const showTerminalToolIssueNotice = Boolean(
                  data.message.id &&
                    terminalToolIssueMessageIds.has(data.message.id)
                );
                const showInlineToolCalls =
                  showRuntimeDetails || showTerminalToolIssueNotice;
                return (
                  <ChatMessage
                    key={messageKey}
                    message={data.message}
                    toolCalls={showInlineToolCalls ? data.toolCalls : []}
                    showAvatar={data.message.type !== prevVisibleMessage?.type}
                    isLoading={isLoading}
                    actionRequestsMap={
                      isLastMessage ? actionRequestsMap : undefined
                    }
                    reviewConfigsMap={
                      isLastMessage ? reviewConfigsMap : undefined
                    }
                    ui={showInlineToolCalls ? messageUi : undefined}
                    stream={stream}
                    onResumeInterrupt={resumeInterrupt}
                    graphId={assistant?.graph_id}
                    showTerminalToolIssueNotice={showTerminalToolIssueNotice}
                    onOpenAttachment={openAttachmentPreview}
                  />
                );
              })}
              {shouldShowThinkingPlaceholder && (
                <div
                  className="mt-4 flex w-full max-w-full gap-3"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex h-7 w-7 shrink-0 items-start justify-center">
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/20 bg-primary text-xs font-semibold tracking-wide text-primary-foreground shadow-sm shadow-black/[0.035]"
                      title="InternAgents"
                      aria-label="InternAgents"
                    >
                      IA
                    </div>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>正在思考中...</span>
                  </div>
                </div>
              )}
              {recoveryNotice && (
                <div
                  className="ml-10 mt-4 rounded-md border border-amber-400/35 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950 shadow-sm shadow-black/[0.025] dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-100"
                  role="status"
                >
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {isStaleActiveRunNotice
                          ? "后台任务可能已经卡住"
                          : "本次运行失败，未保存最终结果"}
                      </div>
                      <p className="mt-1 text-sm text-amber-900/85 dark:text-amber-100/85">
                        {isStaleActiveRunNotice
                          ? "这个会话长时间没有新进展。建议复制原始请求，归档这个会话，然后开一个新对话。"
                          : "已恢复原始输入。子任务记录不会作为主回复显示，避免把中间 checkpoint 当成会话结果。"}
                      </p>
                      {isStaleActiveRunNotice && recoveredInputText && (
                        <pre
                          ref={recoveredInputTextRef}
                          className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-amber-300/60 bg-white/70 px-3 py-2 text-xs leading-5 text-amber-950 dark:border-amber-500/35 dark:bg-amber-950/25 dark:text-amber-50"
                        >
                          {recoveredInputText}
                        </pre>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {isStaleActiveRunNotice && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 gap-1.5 px-2.5 text-xs"
                            onClick={() => void handleCopyRecoveredInput()}
                            disabled={!recoveredInputText}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            复制原始请求
                          </Button>
                        )}
                        {!isStaleActiveRunNotice && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 gap-1.5 px-2.5 text-xs"
                            onClick={handleRetryRecoveredInput}
                            disabled={
                              composerBusy ||
                              !assistant ||
                              !recoveredInputMessage
                            }
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            重新运行
                          </Button>
                        )}
                        {intermediateMessages.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 gap-1.5 px-2.5 text-xs text-amber-950 hover:text-amber-950 dark:text-amber-100 dark:hover:text-amber-100"
                            onClick={() => setShowIntermediateResults(true)}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                            查看中间过程
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
                            onOpenAttachment={openAttachmentPreview}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {completedAiMessage && (
                <div className="ml-10 mt-2 inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span>已完成</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1.5 px-1.5 text-xs text-muted-foreground hover:text-primary"
                        onClick={() => void handleCopyCompletedMessage()}
                        disabled={!completedMessageCopyText}
                        aria-label="复制最后一条 AI 输出"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        复制
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="start"
                      sideOffset={6}
                      className="whitespace-nowrap"
                    >
                      复制最后一条 AI 输出
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}
              {errorMessage && (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                  <div>{errorMessage}</div>
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
            "mx-auto w-[calc(100%-32px)] max-w-[1180px] transition-colors duration-200 ease-in-out"
          )}
          data-tour="chat-input"
        >
          {(hasGoal ||
            hasScpInvocation ||
            hasTasks ||
            hasFiles ||
            hasThreadSkills) && (
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
                          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
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
                          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
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

                    const scpTrigger = (() => {
                      if (!hasScpInvocation || !scpInvocation) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "scp" ? null : "scp"
                            )
                          }
                          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
                          aria-expanded={metaOpen === "scp"}
                        >
                          <Plug
                            size={16}
                            className="text-primary"
                          />
                          <span className="ml-[1px] min-w-0 truncate text-sm">
                            SCP · {scpDisplay.label}
                          </span>
                          <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {scpInvocation.displayName} /{" "}
                            {scpInvocation.toolName}
                          </span>
                        </button>
                      );
                    })();

                    const skillsTrigger = (() => {
                      if (!hasThreadSkills || !threadSkills) return null;
                      return (
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              Date.now() <
                              suppressSkillsMetaToggleUntilRef.current
                            ) {
                              return;
                            }
                            setMetaOpen((prev) =>
                              prev === "skills" ? null : "skills"
                            );
                          }}
                          className="grid min-w-[220px] flex-1 cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left transition-colors hover:bg-accent/70"
                          aria-expanded={metaOpen === "skills"}
                        >
                          <Sparkles
                            size={16}
                            className="text-primary"
                          />
                          <span className="ml-[1px] min-w-0 truncate text-sm">
                            技能 · {threadSkills.active.length}
                          </span>
                          <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {threadSkills.active
                              .map((skill) => skill.name)
                              .join("、")}
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
                      <div className="flex flex-wrap items-center">
                        {goalTrigger}
                        {scpTrigger}
                        {skillsTrigger}
                        {tasksTrigger}
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
                    {hasScpInvocation && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "scp" ? null : "scp"
                          )
                        }
                        aria-expanded={metaOpen === "scp"}
                      >
                        <Plug className="h-4 w-4 text-primary" />
                        SCP
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
                    {hasThreadSkills && threadSkills && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 py-3 pr-4 text-muted-foreground first:pl-[18px] hover:text-foreground aria-expanded:font-semibold aria-expanded:text-foreground"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "skills" ? null : "skills"
                          )
                        }
                        aria-expanded={metaOpen === "skills"}
                      >
                        <Sparkles className="h-4 w-4 text-primary" />
                        技能
                        <span className="text-primary-foreground h-4 min-w-4 rounded-full bg-primary px-0.5 text-center text-xs leading-[16px]">
                          {threadSkills.active.length}
                        </span>
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

                    {metaOpen === "scp" && scpInvocation && (
                      <div className="mb-5 rounded-md border border-border bg-card px-3 py-3">
                        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs font-semibold",
                              scpDisplay.className
                            )}
                          >
                            {scpDisplay.label}
                          </span>
                          <span>{scpInvocation.displayName}</span>
                          <span>{scpInvocation.toolName}</span>
                        </div>
                        <div className="text-sm leading-6 text-foreground">
                          {scpInvocation.prompt}
                        </div>
                        {scpDisplay.summary && (
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">
                            {scpDisplay.summary}
                          </div>
                        )}
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

                    {metaOpen === "skills" && threadSkills && (
                      <div className="mb-5 grid gap-2">
                        {threadSkills.active.map((skill) => (
                          <div
                            key={skill.key}
                            className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-border bg-card px-3 py-3"
                          >
                            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-sm font-semibold text-primary">
                              {skill.name.slice(0, 1)}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {skill.name}
                              </span>
                              {skill.description && (
                                <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                                  {skill.description}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

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
            id="chat-composer"
            ref={composerRef}
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
            {mentionMenuOpen &&
              mentionMenuPosition &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  ref={mentionMenuRef}
                  style={{
                    bottom: mentionMenuPosition.bottom,
                    left: mentionMenuPosition.left,
                    width: mentionMenuPosition.width,
                  }}
                  className="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg shadow-black/10"
                  role="listbox"
                  aria-label="选择技能"
                >
                  <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        选择技能
                      </div>
                    </div>
                    {mentionSkillsLoading && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  {mentionSkillsError ? (
                    <div className="px-3 py-4 text-sm text-red-600">
                      {mentionSkillsError}
                    </div>
                  ) : mentionSkillsLoading && mentionSkills.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在加载技能...
                    </div>
                  ) : filteredMentionSkills.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      没有匹配的技能
                    </div>
                  ) : (
                    <div className="scrollbar-subtle max-h-56 overflow-y-auto p-1">
                      {filteredMentionSkills.map((skill, index) => {
                        const active = index === activeMentionIndex;
                        const selectedForThread = activeThreadSkillKeys.has(
                          skill.key
                        );
                        return (
                          <button
                            key={skill.key}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setActiveMentionIndex(index)}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              selectMentionSkill(skill);
                            }}
                            className={cn(
                              "flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                              active
                                ? "bg-accent text-accent-foreground"
                                : "text-popover-foreground hover:bg-accent/70"
                            )}
                          >
                            <span
                              className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                                selectedForThread
                                  ? "border-primary/25 bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground"
                              )}
                            >
                              {selectedForThread ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <Sparkles className="h-3.5 w-3.5" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {skill.name}
                            </span>
                            {selectedForThread && (
                              <span className="text-xs text-muted-foreground">
                                已启用
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>,
                document.body
              )}
            {isScpComposerCommand && (
              <div className="border-b border-border bg-muted/40 px-[18px] py-2">
                {pendingScpSelection ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                      <Plug className="h-3.5 w-3.5" />
                      {pendingScpSelection.displayName}
                    </span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {pendingScpSelection.toolName}
                    </span>
                    <button
                      type="button"
                      className="ml-auto rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                      onClick={() => setPendingScpSelection(null)}
                    >
                      更换
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      <Plug className="h-3.5 w-3.5 text-primary" />
                      SCP
                    </div>
                    {isScpCatalogLoading ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        加载中
                      </div>
                    ) : scpCatalogError ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-red-600 dark:text-red-300">
                        <span className="min-w-0 flex-1">{scpCatalogError}</span>
                        <button
                          type="button"
                          className="rounded-sm border border-red-500/30 px-2 py-1 text-xs hover:bg-red-500/10"
                          onClick={retryScpCatalogLoad}
                        >
                          重试
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-1">
                        {filteredScpCatalog.slice(0, 8).map((item) => (
                          <button
                            key={`${item.skillName}:${item.toolName}`}
                            type="button"
                            className="grid min-w-0 grid-cols-[1fr_auto] gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-background"
                            onClick={() => selectScpCatalogItem(item)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {item.displayName}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {item.description}
                              </span>
                            </span>
                            <span className="max-w-48 truncate rounded-sm border border-border bg-card px-1.5 py-0.5 text-xs text-muted-foreground">
                              {item.toolName}
                            </span>
                          </button>
                        ))}
                        {filteredScpCatalog.length === 0 && (
                          <div className="py-2 text-xs text-muted-foreground">
                            暂无 SCP tools
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
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
                    {attachment.workspacePath ? (
                      <button
                        type="button"
                        className="min-w-0 max-w-[180px] truncate text-left hover:text-primary"
                        onClick={() =>
                          openAttachmentPreview(attachment.workspacePath!)
                        }
                        title={`打开 ${attachment.workspacePath}`}
                      >
                        {attachment.name}
                      </button>
                    ) : (
                      <span className="min-w-0 max-w-[180px] truncate">
                        {attachment.name}
                      </span>
                    )}
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
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isStreamRecovering
                  ? "正在恢复会话..."
                  : isLoading
                  ? "正在运行..."
                  : "你希望我做些什么？"
              }
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
                      aria-label="添加附件"
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
                    添加附件
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={insertMentionTrigger}
                      disabled={isLoading}
                      aria-label="提及能力或专家"
                    >
                      <AtSign className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    align="center"
                    sideOffset={6}
                    className="whitespace-nowrap"
                  >
                    提及能力或专家
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center justify-end gap-2">
                {isStreamRecovering ? (
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>恢复中</span>
                  </div>
                ) : !isLoading ? (
                  <div
                    className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
                    aria-label={`${sendShortcutModifier} 加 Enter 发送`}
                  >
                    <kbd className="min-w-5 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-center font-mono text-[11px] leading-4 text-muted-foreground shadow-sm shadow-black/[0.025]">
                      {sendShortcutModifier}
                    </kbd>
                    <kbd className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-muted-foreground shadow-sm shadow-black/[0.025]">
                      Enter
                    </kbd>
                  </div>
                ) : null}
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
