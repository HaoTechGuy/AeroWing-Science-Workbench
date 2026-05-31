"use client";

import {
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { format } from "date-fns";
import { Archive, Loader2, MessageSquare, SquarePen, X } from "lucide-react";
import { useQueryState } from "nuqs";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useRemoteAgent } from "@/providers/ClientProvider";
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
  resourceId?: string;
  runtimeUrl?: string;
  assistantId?: string;
  workspaceId?: string;
}

export function ThreadList({
  onThreadSelect,
  onNewThread,
  onMutateReady,
  onClose,
  onInterruptCountChange,
  resourceId,
  runtimeUrl,
  assistantId,
  workspaceId,
}: ThreadListProps) {
  const remoteAgent = useRemoteAgent();
  const [currentThreadId, setCurrentThreadId] = useQueryState("threadId");
  const [archivingThreadId, setArchivingThreadId] = useState<string | null>(
    null
  );

  const threads = useThreads({
    limit: 20,
    resourceId,
    runtimeUrl,
    assistantId,
    workspaceId,
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

  const archiveThread = useCallback(
    async (thread: ThreadItem, event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      setArchivingThreadId(thread.id);
      try {
        await remoteAgent.client.threads.update(thread.id, {
          metadata: {
            ...thread.metadata,
            internagents_archived: true,
            internagents_archived_at: new Date().toISOString(),
          },
        });
        if (currentThreadId === thread.id) {
          await setCurrentThreadId(null);
        }
        await threads.mutate();
        toast.success("会话已归档");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "会话归档失败";
        toast.error(message);
      } finally {
        setArchivingThreadId(null);
      }
    },
    [currentThreadId, remoteAgent.client.threads, setCurrentThreadId, threads]
  );

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header with title and actions */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight">
            会话
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            项目对话记录
          </p>
        </div>
        <div className="ml-auto flex items-center justify-end gap-2">
          {onNewThread && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onNewThread}
                  className="h-8 w-8 shrink-0 hover:text-[#2F6868]"
                  aria-label="新建会话"
                >
                  <SquarePen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                align="center"
                sideOffset={6}
                className="whitespace-nowrap px-2 py-1"
              >
                新建会话
              </TooltipContent>
            </Tooltip>
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
          <div className="box-border w-full max-w-full overflow-hidden px-4 py-1.5">
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
                      <div
                        key={thread.id}
                        className={cn(
                          "group/thread flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-md pr-1 transition-colors duration-200",
                          "hover:bg-accent",
                          currentThreadId === thread.id
                            ? "border border-primary bg-accent hover:bg-accent"
                            : "border border-transparent bg-transparent"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onThreadSelect(thread.id)}
                          className="w-0 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md px-2.5 py-2 text-left"
                          aria-current={currentThreadId === thread.id}
                        >
                          <div className="w-full min-w-0 overflow-hidden">
                            {/* Title + Timestamp Row */}
                            <div className="mb-0.5 flex min-w-0 items-center justify-between gap-2">
                              <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5">
                                {thread.title}
                              </h3>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {formatTime(thread.updatedAt)}
                              </span>
                            </div>
                            {/* Description + Status Row */}
                            <div className="flex min-w-0 items-center justify-between gap-2">
                              <p className="min-w-0 flex-1 truncate text-xs leading-4 text-muted-foreground">
                                {thread.description}
                              </p>
                              <div className="shrink-0">
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={(event) => archiveThread(thread, event)}
                              disabled={archivingThreadId === thread.id}
                              className={cn(
                                "h-7 w-7 shrink-0 text-muted-foreground opacity-70 transition-opacity hover:text-[#2F6868] hover:opacity-100",
                                currentThreadId === thread.id && "opacity-100"
                              )}
                              aria-label={`归档会话 ${thread.title}`}
                            >
                              {archivingThreadId === thread.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Archive className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            align="center"
                            sideOffset={8}
                            className="whitespace-nowrap"
                          >
                            归档会话
                          </TooltipContent>
                        </Tooltip>
                      </div>
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
