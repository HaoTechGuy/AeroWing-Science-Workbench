"use client";

import React, { useMemo, useState, useCallback } from "react";
import { SubAgentIndicator } from "@/app/components/SubAgentIndicator";
import { ToolCallBox } from "@/app/components/ToolCallBox";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import { ExternalLink, FileIcon, ImageIcon } from "lucide-react";
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
  extractVisibleStringFromMessageContent,
} from "@/app/utils/utils";
import {
  extractGeneratedImageArtifacts,
  extractMarkdownWorkspaceImagePaths,
  workspaceImageRawUrl,
} from "@/app/utils/generatedImages";
import { cn } from "@/lib/utils";

interface ChatMessageProps {
  message: Message;
  toolCalls: ToolCall[];
  artifactToolCalls?: ToolCall[];
  hiddenGeneratedImagePaths?: readonly string[];
  showAvatar?: boolean;
  isLoading?: boolean;
  actionRequestsMap?: Map<string, ActionRequest>;
  reviewConfigsMap?: Map<string, ReviewConfig>;
  ui?: any[];
  stream?: any;
  onResumeInterrupt?: (value: any) => void;
  graphId?: string;
  runtimeMuted?: boolean;
  showTerminalToolIssueNotice?: boolean;
  onOpenAttachment?: (path: string) => void;
  resourceId?: string;
  workspaceId?: string;
}

export const ChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    toolCalls,
    artifactToolCalls,
    hiddenGeneratedImagePaths,
    showAvatar,
    isLoading,
    actionRequestsMap,
    reviewConfigsMap,
    ui,
    stream,
    onResumeInterrupt,
    graphId,
    runtimeMuted,
    showTerminalToolIssueNotice,
    onOpenAttachment,
    resourceId,
    workspaceId,
  }) => {
    const isUser = message.type === "human";
    const messageContent = extractVisibleStringFromMessageContent(message);
    const messageImageUrls = useMemo(
      () => extractImageUrlsFromMessageContent(message),
      [message]
    );
    const userImageUrls = isUser ? messageImageUrls : [];
    const assistantImageUrls = isUser ? [] : messageImageUrls;
    const attachments = useMemo(() => {
      const rawAttachments = message.additional_kwargs?.attachments;
      return Array.isArray(rawAttachments)
        ? (rawAttachments as ChatAttachment[])
        : [];
    }, [message.additional_kwargs]);
    const hasContent = messageContent && messageContent.trim() !== "";
    const showMutedRuntime = Boolean(isLoading || runtimeMuted);
    const visibleFileAttachments = attachments.filter(
      (attachment) => attachment.kind !== "image"
    );
    const hasUserAttachments =
      isUser &&
      (userImageUrls.length > 0 || visibleFileAttachments.length > 0);
    const hasToolCalls = toolCalls.length > 0;
    const generatedImages = useMemo(() => {
      if (isUser) {
        return [];
      }
      const markdownImagePaths = new Set(
        extractMarkdownWorkspaceImagePaths(messageContent)
      );
      for (const path of hiddenGeneratedImagePaths ?? []) {
        markdownImagePaths.add(path);
      }
      return extractGeneratedImageArtifacts(artifactToolCalls ?? toolCalls)
        .map((artifact) => ({
          ...artifact,
          rawUrl: workspaceImageRawUrl(artifact.path, resourceId, workspaceId),
        }))
        .filter((artifact) => !markdownImagePaths.has(artifact.path));
    }, [
      artifactToolCalls,
      hiddenGeneratedImagePaths,
      isUser,
      messageContent,
      resourceId,
      toolCalls,
      workspaceId,
    ]);
    const hasTerminalToolIssue = toolCalls.some(
      (toolCall) =>
        Boolean(toolCall.result) &&
        (toolCall.status === "error" || toolCall.status === "interrupted")
    );
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
      (id: string) => expandedSubAgents[id] ?? false,
      [expandedSubAgents]
    );
    const toggleSubAgent = useCallback((id: string) => {
      setExpandedSubAgents((prev) => ({
        ...prev,
        [id]: !(prev[id] ?? false),
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
                className="flex h-7 w-7 items-center justify-center rounded-md border border-primary/20 bg-primary text-xs font-semibold tracking-wide text-primary-foreground shadow-sm shadow-black/[0.035]"
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
                  <MarkdownContent
                    content={messageContent}
                    onOpenWorkspacePath={onOpenAttachment}
                    resourceId={resourceId}
                    workspaceId={workspaceId}
                  />
                ) : null}
              </div>
            </div>
          )}
          {hasUserAttachments && (
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {userImageUrls.map((imageUrl, index) => (
                <img
                  key={`${message.id}-image-${index}`}
                  src={imageUrl}
                  alt=""
                  className="max-h-44 max-w-56 rounded-md border border-border bg-card object-contain shadow-sm shadow-black/[0.025]"
                />
              ))}
              {visibleFileAttachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  className={cn(
                    "flex max-w-56 items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-xs text-muted-foreground shadow-sm shadow-black/[0.025]",
                    attachment.workspacePath &&
                      "transition-colors hover:border-primary/30 hover:text-foreground"
                  )}
                  onClick={() => {
                    if (attachment.workspacePath) {
                      onOpenAttachment?.(attachment.workspacePath);
                    }
                  }}
                  disabled={!attachment.workspacePath}
                  title={
                    attachment.workspacePath
                      ? `打开 ${attachment.workspacePath}`
                      : attachment.name
                  }
                >
                  <FileIcon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{attachment.name}</span>
                </button>
              ))}
            </div>
          )}
          {assistantImageUrls.length > 0 && (
            <div className="mt-3 flex max-w-full flex-wrap gap-3">
              {assistantImageUrls.map((imageUrl, index) => (
                <img
                  key={`${message.id}-assistant-image-${index}`}
                  src={imageUrl}
                  alt="Assistant image"
                  className={cn(
                    "max-h-[28rem] max-w-[min(28rem,100%)] rounded-md border border-border bg-card object-contain shadow-sm shadow-black/[0.025]",
                    showMutedRuntime && "border-border/30 bg-muted/5 opacity-90"
                  )}
                  loading="lazy"
                />
              ))}
            </div>
          )}
          {generatedImages.length > 0 && (
            <div className="mt-3 flex max-w-full flex-wrap gap-3">
              {generatedImages.map((image, index) => (
                <figure
                  key={`${image.path}-${index}`}
                  className={cn(
                    "m-0 w-full max-w-[min(28rem,100%)] overflow-hidden rounded-md border border-border bg-card shadow-sm shadow-black/[0.025]",
                    showMutedRuntime && "border-border/30 bg-muted/5 opacity-90"
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "block max-h-[28rem] w-full overflow-hidden bg-muted/20 text-left",
                      onOpenAttachment &&
                        "cursor-zoom-in transition-opacity hover:opacity-95"
                    )}
                    onClick={() => onOpenAttachment?.(image.path)}
                    disabled={!onOpenAttachment}
                    title={image.path}
                  >
                    <img
                      src={image.rawUrl}
                      alt={image.prompt || "Generated image"}
                      className="h-auto max-h-[28rem] w-full object-contain"
                      loading="lazy"
                    />
                  </button>
                  <figcaption className="flex min-w-0 items-center gap-2 border-t border-border/70 px-2 py-1.5 text-xs text-muted-foreground">
                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate font-mono">
                      {image.path}
                    </span>
                    {onOpenAttachment && (
                      <button
                        type="button"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => onOpenAttachment(image.path)}
                        title={image.path}
                        aria-label={`Open ${image.path}`}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {!isUser &&
            !hasContent &&
            hasTerminalToolIssue &&
            showTerminalToolIssueNotice && (
              <div className="mt-4 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm leading-6 text-foreground">
                本次运行已结束，但没有生成最终回答。下面是停止位置：
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
                    muted={showMutedRuntime}
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
                        muted={showMutedRuntime}
                      />
                    </div>
                  </div>
                  {isSubAgentExpanded(subAgent.id) && (
                    <div className="w-full max-w-full">
                      <div
                        className={cn(
                          "rounded-md border border-border bg-card p-4 shadow-sm shadow-black/[0.025]",
                          showMutedRuntime &&
                            "border-border/30 bg-muted/5 text-muted-foreground/70 shadow-none"
                        )}
                      >
                        <h4
                          className={cn(
                            "mb-2 text-xs font-semibold uppercase tracking-wider text-primary/70",
                            showMutedRuntime && "text-muted-foreground/70"
                          )}
                        >
                          Input
                        </h4>
                        <div className="mb-4">
                          <MarkdownContent
                            content={extractSubAgentContent(subAgent.input)}
                            onOpenWorkspacePath={onOpenAttachment}
                            resourceId={resourceId}
                            workspaceId={workspaceId}
                            className={cn(
                              showMutedRuntime &&
                                "text-muted-foreground/70 [&_a]:!text-muted-foreground/70 [&_code]:!text-muted-foreground/70"
                            )}
                          />
                        </div>
                        {subAgent.output && (
                          <>
                            <h4
                              className={cn(
                                "mb-2 text-xs font-semibold uppercase tracking-wider text-primary/70",
                                showMutedRuntime && "text-muted-foreground/70"
                              )}
                            >
                              Output
                            </h4>
                            <MarkdownContent
                              content={extractSubAgentContent(subAgent.output)}
                              onOpenWorkspacePath={onOpenAttachment}
                              resourceId={resourceId}
                              workspaceId={workspaceId}
                              className={cn(
                                showMutedRuntime &&
                                  "text-muted-foreground/70 [&_a]:!text-muted-foreground/70 [&_code]:!text-muted-foreground/70"
                              )}
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
