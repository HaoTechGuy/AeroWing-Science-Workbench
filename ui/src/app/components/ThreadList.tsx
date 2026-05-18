"use client";

import { useEffect, useMemo, useRef, useCallback } from "react";
import { format } from "date-fns";
import { Loader2, MessageSquare, SquarePen, X } from "lucide-react";
import { useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ThreadItem } from "@/app/hooks/useThreads";
import { useThreads } from "@/app/hooks/useThreads";

const GROUP_LABELS = {
  interrupted: "Requiring Attention",
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  older: "Older",
} as const;

const STATUS_COLORS: Record<ThreadItem["status"], string> = {
  idle: "bg-green-500",
  busy: "bg-blue-500",
  interrupted: "bg-orange-500",
  error: "bg-red-600",
};

function getThreadColor(status: ThreadItem["status"]): string {
  return STATUS_COLORS[status] ?? "bg-gray-400";
}

function formatTime(date: Date, now = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return format(date, "HH:mm");
  if (days === 1) return "Yesterday";
  if (days < 7) return format(date, "EEEE");
  return format(date, "MM/dd");
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <p className="text-sm text-red-600">会话加载失败</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-1.5 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-11 w-full"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-5 text-center">
      <MessageSquare className="mb-2 h-8 w-8 text-gray-300" />
      <p className="text-xs text-muted-foreground">暂无会话</p>
    </div>
  );
}

interface ThreadListProps {
  onThreadSelect: (id: string) => void;
  onNewThread?: () => void;
  onMutateReady?: (mutate: () => void) => void;
  onClose?: () => void;
  onInterruptCountChange?: (count: number) => void;
}

export function ThreadList({
  onThreadSelect,
  onNewThread,
  onMutateReady,
  onClose,
  onInterruptCountChange,
}: ThreadListProps) {
  const [currentThreadId] = useQueryState("threadId");

  const threads = useThreads({
    limit: 20,
  });

  const flattened = useMemo(() => {
    return threads.data?.flat() ?? [];
  }, [threads.data]);

  const isLoadingMore =
    threads.size > 0 && threads.data?.[threads.size - 1] == null;
  const isEmpty = threads.data?.at(0)?.length === 0;
  const isReachingEnd = isEmpty || (threads.data?.at(-1)?.length ?? 0) < 20;

  // Group threads by time and status
  const grouped = useMemo(() => {
    const now = new Date();
    const groups: Record<keyof typeof GROUP_LABELS, ThreadItem[]> = {
      interrupted: [],
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };

    flattened.forEach((thread) => {
      if (thread.status === "interrupted") {
        groups.interrupted.push(thread);
        return;
      }

      const diff = now.getTime() - thread.updatedAt.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));

      if (days === 0) {
        groups.today.push(thread);
      } else if (days === 1) {
        groups.yesterday.push(thread);
      } else if (days < 7) {
        groups.week.push(thread);
      } else {
        groups.older.push(thread);
      }
    });

    return groups;
  }, [flattened]);

  const interruptedCount = useMemo(() => {
    return flattened.filter((t) => t.status === "interrupted").length;
  }, [flattened]);

  // Expose thread list revalidation to parent component
  // Use refs to create a stable callback that always calls the latest mutate function
  const onMutateReadyRef = useRef(onMutateReady);
  const mutateRef = useRef(threads.mutate);

  useEffect(() => {
    onMutateReadyRef.current = onMutateReady;
  }, [onMutateReady]);

  useEffect(() => {
    mutateRef.current = threads.mutate;
  }, [threads.mutate]);

  const mutateFn = useCallback(() => {
    mutateRef.current();
  }, []);

  useEffect(() => {
    onMutateReadyRef.current?.(mutateFn);
    // Only run once on mount to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notify parent of interrupt count changes
  useEffect(() => {
    onInterruptCountChange?.(interruptedCount);
  }, [interruptedCount, onInterruptCountChange]);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header with title and actions */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight">
            会话
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            历史对话记录
          </p>
        </div>
        <div className="ml-auto flex items-center justify-end gap-2">
          {onNewThread && (
            <Button
              variant="outline"
              size="sm"
              onClick={onNewThread}
              className="h-7 gap-1 border-[#2F6868] bg-[#2F6868] px-2 text-xs text-white hover:bg-[#2F6868]/80"
            >
              <SquarePen className="h-3.5 w-3.5" />
              新建
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
              aria-label="关闭会话侧栏"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="h-0 flex-1">
        {threads.error && <ErrorState message={threads.error.message} />}

        {!threads.error && !threads.data && threads.isLoading && (
          <LoadingState />
        )}

        {!threads.error && !threads.isLoading && isEmpty && <EmptyState />}

        {!threads.error && !isEmpty && (
          <div className="box-border w-full max-w-full overflow-hidden px-2 py-1.5">
            {(
              Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>
            ).map((group) => {
              const groupThreads = grouped[group];
              if (groupThreads.length === 0) return null;

              return (
                <div
                  key={group}
                  className="mb-2"
                >
                  <h4 className="m-0 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {GROUP_LABELS[group]}
                  </h4>
                  <div className="flex flex-col gap-0.5">
                    {groupThreads.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => onThreadSelect(thread.id)}
                        className={cn(
                          "grid w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors duration-200",
                          "hover:bg-accent",
                          currentThreadId === thread.id
                            ? "border border-primary bg-accent hover:bg-accent"
                            : "border border-transparent bg-transparent"
                        )}
                        aria-current={currentThreadId === thread.id}
                      >
                        <div className="min-w-0 flex-1">
                          {/* Title + Timestamp Row */}
                          <div className="mb-0.5 flex items-center justify-between">
                            <h3 className="truncate text-[13px] font-semibold leading-5">
                              {thread.title}
                            </h3>
                            <span className="ml-2 flex-shrink-0 text-[11px] text-muted-foreground">
                              {formatTime(thread.updatedAt)}
                            </span>
                          </div>
                          {/* Description + Status Row */}
                          <div className="flex items-center justify-between">
                            <p className="flex-1 truncate text-xs leading-4 text-muted-foreground">
                              {thread.description}
                            </p>
                            <div className="ml-2 flex-shrink-0">
                              <div
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  getThreadColor(thread.status)
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {!isReachingEnd && (
              <div className="flex justify-center py-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => threads.setSize(threads.size + 1)}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "Load More"
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
