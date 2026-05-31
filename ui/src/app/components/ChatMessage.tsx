"use client";

import React, { useMemo, useState, useCallback } from "react";
import { SubAgentIndicator } from "@/app/components/SubAgentIndicator";
import { ToolCallBox } from "@/app/components/ToolCallBox";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { FileIcon } from "lucide-react";
import type {
  ChatAttachment,
  SubAgent,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Message } from "@langchain/langgraph-sdk";
import {
  extractImageUrlsFromMessageContent,
  extractSubAgentContent,
  extractStringFromMessageContent,
  extractVisibleStringFromMessageContent,
} from "@/app/utils/utils";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: Message;
  toolCalls: ToolCall[];
  showAvatar?: boolean;
  isLoading?: boolean;
  actionRequestsMap?: Map<string, ActionRequest>;
  reviewConfigsMap?: Map<string, ReviewConfig>;
  ui?: any[];
  stream?: any;
  onResumeInterrupt?: (value: any) => void;
  graphId?: string;
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    toolCalls,
    showAvatar,
    isLoading,
    actionRequestsMap,
    reviewConfigsMap,
    ui,
    stream,
    onResumeInterrupt,
    graphId,
  }) => {
    const isUser = message.type === "human";
    const messageContent = isUser
      ? extractVisibleStringFromMessageContent(message)
      : extractStringFromMessageContent(message);
    const imageUrls = useMemo(
      () => (isUser ? extractImageUrlsFromMessageContent(message) : []),
      [isUser, message]
    );
    const attachments = useMemo(() => {
      const rawAttachments = message.additional_kwargs?.attachments;
      return Array.isArray(rawAttachments)
        ? (rawAttachments as ChatAttachment[])
        : [];
    }, [message.additional_kwargs]);
    const hasContent = messageContent && messageContent.trim() !== "";
    const visibleFileAttachments = attachments.filter(
      (attachment) => attachment.kind !== "image"
    );
    const hasUserAttachments =
      isUser && (imageUrls.length > 0 || visibleFileAttachments.length > 0);
    const hasToolCalls = toolCalls.length > 0;
    const subAgents = useMemo(() => {
      return toolCalls
        .filter((toolCall: ToolCall) => {
          return (
            toolCall.name === "task" &&
            toolCall.args["subagent_type"] &&
            toolCall.args["subagent_type"] !== "" &&
            toolCall.args["subagent_type"] !== null
          );
        })
        .map((toolCall: ToolCall) => {
          const subagentType = (toolCall.args as Record<string, unknown>)[
            "subagent_type"
          ] as string;
          return {
            id: toolCall.id,
            name: toolCall.name,
            subAgentName: subagentType,
            input: toolCall.args,
            output: toolCall.result ? { result: toolCall.result } : undefined,
            status: toolCall.status,
          } as SubAgent;
        });
    }, [toolCalls]);

    const [expandedSubAgents, setExpandedSubAgents] = useState<
      Record<string, boolean>
    >({});
    const isSubAgentExpanded = useCallback(
      (id: string) => expandedSubAgents[id] ?? true,
      [expandedSubAgents]
    );
    const toggleSubAgent = useCallback((id: string) => {
      setExpandedSubAgents((prev) => ({
        ...prev,
        [id]: prev[id] === undefined ? false : !prev[id],
      }));
    }, []);

    return (
      <div
        className={cn(
          "flex w-full max-w-full overflow-x-hidden",
          isUser ? "flex-row-reverse" : "gap-3"
        )}
      >
        {!isUser && (
          <div className="mt-4 flex h-7 w-7 shrink-0 items-start justify-center">
            {showAvatar && (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/20 bg-primary text-[10px] font-semibold tracking-wide text-primary-foreground shadow-sm shadow-black/[0.035]"
                title="InternAgents"
                aria-label="InternAgents"
              >
                IA
              </div>
            )}
          </div>
        )}
        <div
          className={cn(
            "min-w-0 max-w-full",
            isUser ? "max-w-[70%]" : "w-full"
          )}
        >
          {hasContent && (
            <div className={cn("relative flex items-end gap-0")}>
              <div
                className={cn(
                  "mt-4 overflow-hidden break-words text-sm font-normal leading-[150%]",
                  isUser
                    ? "rounded-lg rounded-br-sm border border-primary/15 px-3 py-2 text-foreground shadow-sm shadow-black/[0.025]"
                    : "text-foreground"
                )}
                style={
                  isUser
                    ? { backgroundColor: "var(--color-user-message-bg)" }
                    : undefined
                }
              >
                {isUser ? (
                  <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {messageContent}
                  </p>
                ) : hasContent ? (
                  <MarkdownContent content={messageContent} />
                ) : null}
              </div>
            </div>
          )}
          {hasUserAttachments && (
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {imageUrls.map((imageUrl, index) => (
                <img
                  key={`${message.id}-image-${index}`}
                  src={imageUrl}
                  alt=""
                  className="max-h-44 max-w-56 rounded-md border border-border bg-card object-contain shadow-sm shadow-black/[0.025]"
                />
              ))}
              {visibleFileAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex max-w-56 items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-muted-foreground shadow-sm shadow-black/[0.025]"
                >
                  <FileIcon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{attachment.name}</span>
                </div>
              ))}
            </div>
          )}
          {hasToolCalls && (
            <div className="mt-4 flex w-full flex-col">
              {toolCalls.map((toolCall: ToolCall) => {
                if (toolCall.name === "task") return null;
                const toolCallGenUiComponent = ui?.find(
                  (u) => u.metadata?.tool_call_id === toolCall.id
                );
                const actionRequest = actionRequestsMap?.get(toolCall.name);
                const reviewConfig = reviewConfigsMap?.get(toolCall.name);
                return (
                  <ToolCallBox
                    key={toolCall.id}
                    toolCall={toolCall}
                    uiComponent={toolCallGenUiComponent}
                    stream={stream}
                    graphId={graphId}
                    actionRequest={actionRequest}
                    reviewConfig={reviewConfig}
                    onResume={onResumeInterrupt}
                    isLoading={isLoading}
                  />
                );
              })}
            </div>
          )}
          {!isUser && subAgents.length > 0 && (
            <div className="flex w-fit max-w-full flex-col gap-4">
              {subAgents.map((subAgent) => (
                <div
                  key={subAgent.id}
                  className="flex w-full flex-col gap-2"
                >
                  <div className="flex items-end gap-2">
                    <div className="w-[calc(100%-100px)]">
                      <SubAgentIndicator
                        subAgent={subAgent}
                        onClick={() => toggleSubAgent(subAgent.id)}
                        isExpanded={isSubAgentExpanded(subAgent.id)}
                      />
                    </div>
                  </div>
                  {isSubAgentExpanded(subAgent.id) && (
                    <div className="w-full max-w-full">
                      <div className="rounded-md border border-border bg-card p-4 shadow-sm shadow-black/[0.025]">
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary/70">
                          Input
                        </h4>
                        <div className="mb-4">
                          <MarkdownContent
                            content={extractSubAgentContent(subAgent.input)}
                          />
                        </div>
                        {subAgent.output && (
                          <>
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary/70">
                              Output
                            </h4>
                            <MarkdownContent
                              content={extractSubAgentContent(subAgent.output)}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

ChatMessage.displayName = "ChatMessage";
