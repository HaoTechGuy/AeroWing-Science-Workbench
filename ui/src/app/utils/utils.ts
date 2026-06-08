import type { Message } from "@langchain/langgraph-sdk";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function extractStringFromMessageContent(message: Message): string {
  return typeof message.content === "string"
    ? message.content
    : Array.isArray(message.content)
    ? message.content
        .filter(
          (c: unknown) =>
            (typeof c === "object" &&
              c !== null &&
              "type" in c &&
              (c as { type: string }).type === "text") ||
            typeof c === "string"
        )
        .map((c: unknown) =>
          typeof c === "string"
            ? c
            : typeof c === "object" && c !== null && "text" in c
            ? (c as { text?: string }).text || ""
            : ""
        )
        .join("")
    : "";
}

function isThinkTagStart(text: string, index: number): boolean {
  if (!text.startsWith("<think", index)) {
    return false;
  }

  const nextChar = text[index + "<think".length];
  return (
    nextChar === undefined ||
    nextChar === ">" ||
    nextChar === "/" ||
    /\s/.test(nextChar)
  );
}

export function stripThinkTagsForDisplay(text: string): string {
  const lowerText = text.toLowerCase();
  let cursor = 0;
  let output = "";
  let firstThinkStart = -1;
  let removedAnyThinkBlock = false;

  while (cursor < text.length) {
    const candidateStart = lowerText.indexOf("<think", cursor);
    if (candidateStart === -1) {
      output += text.slice(cursor);
      break;
    }

    if (!isThinkTagStart(lowerText, candidateStart)) {
      output += text.slice(cursor, candidateStart + 1);
      cursor = candidateStart + 1;
      continue;
    }

    const openingEnd = lowerText.indexOf(">", candidateStart);
    output += text.slice(cursor, candidateStart);

    if (firstThinkStart === -1) {
      firstThinkStart = candidateStart;
    }
    removedAnyThinkBlock = true;

    if (openingEnd === -1) {
      cursor = text.length;
      break;
    }

    const closingStart = lowerText.indexOf("</think>", openingEnd + 1);
    if (closingStart === -1) {
      cursor = text.length;
      break;
    }

    cursor = closingStart + "</think>".length;
  }

  if (firstThinkStart !== -1 && text.slice(0, firstThinkStart).trim() === "") {
    output = output.trimStart();
  }

  return removedAnyThinkBlock ? output : text;
}

export function extractVisibleStringFromMessageContent(message: Message): string {
  const content =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
      ? message.content
          .filter(
            (c: unknown) =>
              (typeof c === "object" &&
                c !== null &&
                "type" in c &&
                (c as { type: string }).type === "text") ||
              typeof c === "string"
          )
          .map((c: unknown) =>
            typeof c === "string"
              ? c
              : typeof c === "object" && c !== null && "text" in c
              ? (c as { text?: string }).text || ""
              : ""
          )
          .filter(
            (text) =>
              message.type !== "human" ||
              !text.trimStart().startsWith("<attachment ")
          )
          .join("")
      : "";

  return message.type === "ai" ? stripThinkTagsForDisplay(content) : content;
}

export function extractImageUrlsFromMessageContent(message: Message): string[] {
  if (!Array.isArray(message.content)) {
    return [];
  }

  return message.content
    .filter(
      (block: unknown) =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block as { type: string }).type === "image_url" &&
        "image_url" in block
    )
    .map((block: unknown) => {
      const imageUrl = (block as { image_url?: string | { url?: string } })
        .image_url;
      return typeof imageUrl === "string" ? imageUrl : imageUrl?.url || "";
    })
    .filter(Boolean);
}

export function extractSubAgentContent(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }

  if (data && typeof data === "object") {
    const dataObj = data as Record<string, unknown>;

    // Try to extract description first
    if (dataObj.description && typeof dataObj.description === "string") {
      return dataObj.description;
    }

    // Then try prompt
    if (dataObj.prompt && typeof dataObj.prompt === "string") {
      return dataObj.prompt;
    }

    // For output objects, try result
    if (dataObj.result && typeof dataObj.result === "string") {
      return dataObj.result;
    }

    // Fallback to JSON stringification
    return JSON.stringify(data, null, 2);
  }

  // Fallback for any other type
  return JSON.stringify(data, null, 2);
}

export function isPreparingToCallTaskTool(messages: Message[]): boolean {
  const lastMessage = messages[messages.length - 1];
  return (
    (lastMessage.type === "ai" &&
      lastMessage.tool_calls?.some(
        (call: { name?: string }) => call.name === "task"
      )) ||
    false
  );
}

export function formatMessageForLLM(message: Message): string {
  let role: string;
  if (message.type === "human") {
    role = "Human";
  } else if (message.type === "ai") {
    role = "Assistant";
  } else if (message.type === "tool") {
    role = `Tool Result`;
  } else {
    role = message.type || "Unknown";
  }

  const timestamp = message.id ? ` (${message.id.slice(0, 8)})` : "";

  let contentText = "";

  // Extract content text
  if (typeof message.content === "string") {
    contentText = message.content;
  } else if (Array.isArray(message.content)) {
    const textParts: string[] = [];

    message.content.forEach((part: any) => {
      if (typeof part === "string") {
        textParts.push(part);
      } else if (part && typeof part === "object" && part.type === "text") {
        textParts.push(part.text || "");
      }
      // Ignore other types like tool_use in content - we handle tool calls separately
    });

    contentText = textParts.join("\n\n").trim();
  }

  // For tool messages, include additional tool metadata
  if (message.type === "tool") {
    const toolName = (message as any).name || "unknown_tool";
    const toolCallId = (message as any).tool_call_id || "";
    role = `Tool Result [${toolName}]`;
    if (toolCallId) {
      role += ` (call_id: ${toolCallId.slice(0, 8)})`;
    }
  }

  // Handle tool calls from .tool_calls property (for AI messages)
  const toolCallsText: string[] = [];
  if (
    message.type === "ai" &&
    message.tool_calls &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  ) {
    message.tool_calls.forEach((call: any) => {
      const toolName = call.name || "unknown_tool";
      const toolArgs = call.args ? JSON.stringify(call.args, null, 2) : "{}";
      toolCallsText.push(`[Tool Call: ${toolName}]\nArguments: ${toolArgs}`);
    });
  }

  // Combine content and tool calls
  const parts: string[] = [];
  if (contentText) {
    parts.push(contentText);
  }
  if (toolCallsText.length > 0) {
    parts.push(...toolCallsText);
  }

  if (parts.length === 0) {
    return `${role}${timestamp}: [Empty message]`;
  }

  if (parts.length === 1) {
    return `${role}${timestamp}: ${parts[0]}`;
  }

  return `${role}${timestamp}:\n${parts.join("\n\n")}`;
}

export function formatConversationForLLM(messages: Message[]): string {
  const formattedMessages = messages.map(formatMessageForLLM);
  return formattedMessages.join("\n\n---\n\n");
}
