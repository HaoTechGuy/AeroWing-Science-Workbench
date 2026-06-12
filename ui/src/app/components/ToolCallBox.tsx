"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  ChevronDown,
  ChevronUp,
  Terminal,
  AlertCircle,
  Loader2,
  CircleCheckBigIcon,
  StopCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolCall, ActionRequest, ReviewConfig } from "@/app/types/types";
import { cn } from "@/lib/utils";
import { LoadExternalComponent } from "@langchain/langgraph-sdk/react-ui";
import { ToolApprovalInterrupt } from "@/app/components/ToolApprovalInterrupt";
import { getToolDisplayName } from "@/app/utils/toolDisplayNames";

interface ToolCallBoxProps {
  toolCall: ToolCall;
  uiComponent?: any;
  stream?: any;
  graphId?: string;
  actionRequest?: ActionRequest;
  reviewConfig?: ReviewConfig;
  onResume?: (value: any) => void;
  isLoading?: boolean;
  muted?: boolean;
}

export const ToolCallBox = React.memo<ToolCallBoxProps>(
  ({
    toolCall,
    uiComponent,
    stream,
    graphId,
    actionRequest,
    reviewConfig,
    onResume,
    isLoading,
    muted,
  }) => {
    const useMutedStyle = Boolean(isLoading || muted) && !actionRequest;
    const [isExpanded, setIsExpanded] = useState(
      () =>
        !!uiComponent ||
        !!actionRequest ||
        toolCall.status === "error" ||
        toolCall.status === "interrupted"
    );
    const [expandedArgs, setExpandedArgs] = useState<Record<string, boolean>>(
      {}
    );

    const { displayName, args, result, status } = useMemo(() => {
      const rawName = toolCall.name || "";
      return {
        displayName: getToolDisplayName(rawName),
        args: toolCall.args || {},
        result: toolCall.result,
        status: toolCall.status || "completed",
      };
    }, [toolCall]);

    useEffect(() => {
      if (status === "error" || status === "interrupted") {
        setIsExpanded(true);
      }
    }, [status]);

    const statusLabel = useMemo(() => {
      switch (status) {
        case "completed":
          return "已完成";
        case "error":
          return "未返回结果";
        case "pending":
          return "运行中";
        case "interrupted":
          return "已中断";
        default:
          return "工具调用";
      }
    }, [status]);

    const statusIcon = useMemo(() => {
      const mutedClassName = useMutedStyle ? "text-muted-foreground/70" : "";
      switch (status) {
        case "completed":
          return (
            <CircleCheckBigIcon
              size={14}
              className={mutedClassName}
            />
          );
        case "error":
          return (
            <AlertCircle
              size={14}
              className="text-destructive"
            />
          );
        case "pending":
          return (
            <Loader2
              size={14}
              className={cn("animate-spin", mutedClassName)}
            />
          );
        case "interrupted":
          return (
            <StopCircle
              size={14}
              className="text-orange-500"
            />
          );
        default:
          return (
            <Terminal
              size={14}
              className="text-muted-foreground"
            />
          );
      }
    }, [status, useMutedStyle]);

    const toggleExpanded = useCallback(() => {
      setIsExpanded((prev) => !prev);
    }, []);

    const toggleArgExpanded = useCallback((argKey: string) => {
      setExpandedArgs((prev) => ({
        ...prev,
        [argKey]: !prev[argKey],
      }));
    }, []);

    const hasContent = result || Object.keys(args).length > 0;

    return (
      <div
        className={cn(
          "w-full overflow-hidden rounded-md border border-transparent outline-none transition-[background-color,border-color] duration-200 hover:border-border hover:bg-accent/60",
          isExpanded && hasContent && "border-border bg-accent/60",
          useMutedStyle &&
            "border-border/30 bg-muted/5 text-muted-foreground/70 shadow-none hover:border-border/40 hover:bg-muted/10",
          useMutedStyle && isExpanded && hasContent && "bg-muted/10"
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleExpanded}
          className={cn(
            "flex w-full items-center justify-between gap-2 border-none px-2 py-2 text-left shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-default"
          )}
          disabled={!hasContent}
        >
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {statusIcon}
              <span
                className={cn(
                  "text-sm font-medium text-foreground",
                  useMutedStyle && "text-muted-foreground/70"
                )}
              >
                {displayName}
              </span>
              {status !== "completed" && (
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none",
                    status === "error"
                      ? "border-destructive/30 text-destructive"
                      : status === "interrupted"
                      ? "border-orange-500/30 text-orange-600 dark:text-orange-300"
                      : "border-border text-muted-foreground",
                    useMutedStyle && "border-border/30 text-muted-foreground/70"
                  )}
                >
                  {statusLabel}
                </span>
              )}
            </div>
            {hasContent &&
              (isExpanded ? (
                <ChevronUp
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
              ) : (
                <ChevronDown
                  size={14}
                  className="shrink-0 text-muted-foreground"
                />
              ))}
          </div>
        </Button>

        {isExpanded && hasContent && (
          <div className="px-4 pb-4">
            {uiComponent && stream && graphId ? (
              <div
                className={cn(
                  "mt-4",
                  useMutedStyle && "opacity-90"
                )}
              >
                <LoadExternalComponent
                  key={uiComponent.id}
                  stream={stream}
                  message={uiComponent}
                  namespace={graphId}
                  meta={{ status, args, result: result ?? "No Result Yet" }}
                />
              </div>
            ) : actionRequest && onResume ? (
              // Show tool approval UI when there's an action request but no GenUI
              <div className="mt-4">
                <ToolApprovalInterrupt
                  actionRequest={actionRequest}
                  reviewConfig={reviewConfig}
                  onResume={onResume}
                  isLoading={isLoading}
                />
              </div>
            ) : (
              <>
                {Object.keys(args).length > 0 && (
                  <div className="mt-4">
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Arguments
                    </h4>
                    <div className="space-y-2">
                      {Object.entries(args).map(([key, value]) => (
                        <div
                          key={key}
                          className={cn(
                            "rounded-sm border border-border",
                            useMutedStyle && "border-border/30"
                          )}
                        >
                          <button
                            onClick={() => toggleArgExpanded(key)}
                            className={cn(
                              "flex w-full items-center justify-between bg-muted/30 p-2 text-left text-xs font-medium transition-colors hover:bg-muted/50",
                              useMutedStyle &&
                                "bg-muted/10 text-muted-foreground/70 hover:bg-muted/15"
                            )}
                          >
                            <span className="font-mono">{key}</span>
                            {expandedArgs[key] ? (
                              <ChevronUp
                                size={12}
                                className="text-muted-foreground"
                              />
                            ) : (
                              <ChevronDown
                                size={12}
                                className="text-muted-foreground"
                              />
                            )}
                          </button>
                          {expandedArgs[key] && (
                            <div
                              className={cn(
                                "border-t border-border bg-muted/20 p-2",
                                useMutedStyle && "border-border/30 bg-muted/5"
                              )}
                            >
                              <pre
                                className={cn(
                                  "m-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-6 text-foreground",
                                  useMutedStyle && "text-muted-foreground/70"
                                )}
                              >
                                {typeof value === "string"
                                  ? value
                                  : JSON.stringify(value, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {result && (
                  <div className="mt-4">
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Result
                    </h4>
                    <pre
                      className={cn(
                        "m-0 overflow-x-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-muted/40 p-2 font-mono text-xs leading-7 text-foreground",
                        useMutedStyle &&
                          "border-border/30 bg-muted/10 text-muted-foreground/70"
                      )}
                    >
                      {typeof result === "string"
                        ? result
                        : JSON.stringify(result, null, 2)}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }
);

ToolCallBox.displayName = "ToolCallBox";
