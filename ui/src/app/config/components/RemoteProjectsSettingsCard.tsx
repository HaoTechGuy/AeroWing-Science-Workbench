"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCcw,
  RotateCcw,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RemoteConnectionDialog } from "@/app/components/RemoteConnectionDialog";
import { useLanguage } from "@/app/hooks/useLanguage";
import type { ResourceConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

interface ResourcesPayload {
  defaultResourceId?: string;
  resources?: ResourceConfig[];
  error?: string;
}

interface RemoteEnsureResult {
  resource: ResourceConfig;
  resources: ResourceConfig[];
  remoteUrl: string;
  state: "up-to-date" | "updated";
  targetReleaseTag: string;
  log: string[];
}

type RemoteEnsureStreamEvent =
  | { type: "log"; message?: string }
  | { type: "done"; result?: RemoteEnsureResult }
  | { type: "error"; error?: string };

type ResourceStatus =
  | { state: "idle"; message?: string }
  | { state: "checking"; message?: string }
  | { state: "ready"; message: string }
  | { state: "error"; message: string };

function isRemoteResource(resource: ResourceConfig) {
  return resource.id !== "local" || resource.backend === "ssh_shell";
}

function workbenchHref(resource: ResourceConfig) {
  const params = new URLSearchParams({
    assistantId: resource.assistantId || `agent_${resource.id}`,
    resourceId: resource.id,
  });
  return `/?${params.toString()}`;
}

async function readResources(): Promise<ResourcesPayload> {
  const response = await fetch("/api/resources", { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as ResourcesPayload;
  if (!response.ok) {
    throw new Error(payload.error || "Unable to read resources.");
  }
  return payload;
}

async function readRemoteEnsureStream(
  resourceId: string,
  onLog: (message: string) => void
): Promise<RemoteEnsureResult> {
  const response = await fetch("/api/remote-connections/ensure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resourceId }),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/x-ndjson")) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error || "Remote runtime sync failed.");
  }
  if (!response.body) {
    throw new Error("Remote runtime sync failed: no log stream returned.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: RemoteEnsureResult | null = null;
  let streamError: string | null = null;

  const parseLine = (line: string): RemoteEnsureStreamEvent | null => {
    const trimmed = line.trim();
    return trimmed ? (JSON.parse(trimmed) as RemoteEnsureStreamEvent) : null;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const event = parseLine(line);
      if (!event) {
        continue;
      }
      if (event.type === "log" && event.message) {
        onLog(event.message);
      } else if (event.type === "done" && event.result) {
        result = event.result;
      } else if (event.type === "error") {
        streamError = event.error || "Remote runtime sync failed.";
      }
    }
    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const event = parseLine(buffer);
    if (event?.type === "log" && event.message) {
      onLog(event.message);
    } else if (event?.type === "done" && event.result) {
      result = event.result;
    } else if (event?.type === "error") {
      streamError = event.error || "Remote runtime sync failed.";
    }
  }

  if (streamError) {
    throw new Error(streamError);
  }
  if (!result) {
    throw new Error("Remote runtime sync failed: no result returned.");
  }
  return result;
}

export function RemoteProjectsSettingsCard() {
  const { t } = useLanguage();
  const [resources, setResources] = useState<ResourceConfig[]>([]);
  const [defaultResourceId, setDefaultResourceId] = useState("local");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, ResourceStatus>>({});

  const remoteResources = useMemo(
    () => resources.filter(isRemoteResource),
    [resources]
  );

  const loadResources = useCallback(async () => {
    setRefreshing(true);
    try {
      const payload = await readResources();
      setResources(payload.resources || []);
      setDefaultResourceId(payload.defaultResourceId || "local");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("remoteProjectsLoadFailed");
      toast.error(message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const handleConfigured = useCallback(
    async (resource: ResourceConfig, nextResources: ResourceConfig[]) => {
      setResources(nextResources);
      setStatuses((current) => ({
        ...current,
        [resource.id]: {
          state: "ready",
          message: t("remoteProjectConnected"),
        },
      }));
    },
    [t]
  );

  const syncResource = useCallback(
    async (resource: ResourceConfig) => {
      setStatuses((current) => ({
        ...current,
        [resource.id]: {
          state: "checking",
          message: t("remoteProjectSyncing"),
        },
      }));
      try {
        const result = await readRemoteEnsureStream(resource.id, (message) => {
          setStatuses((current) => ({
            ...current,
            [resource.id]: { state: "checking", message },
          }));
        });
        setResources(result.resources);
        setStatuses((current) => ({
          ...current,
          [resource.id]: {
            state: "ready",
            message:
              result.state === "updated"
                ? t("remoteProjectUpdated", {
                    version: result.targetReleaseTag,
                  })
                : t("remoteProjectUpToDate", {
                    version: result.targetReleaseTag,
                  }),
          },
        }));
        toast.success(t("remoteProjectSyncComplete"));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("remoteProjectSyncFailed");
        setStatuses((current) => ({
          ...current,
          [resource.id]: { state: "error", message },
        }));
        toast.error(message);
      }
    },
    [t]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm leading-6 text-muted-foreground">
          {t("remoteProjectsHelp")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadResources()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            {t("refresh")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => setDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t("addRemoteProject")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-28 items-center justify-center rounded-lg border border-border bg-background text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t("loadingRemoteProjects")}
        </div>
      ) : remoteResources.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background px-4 py-8 text-sm text-muted-foreground">
          {t("noRemoteProjects")}
        </div>
      ) : (
        <div className="grid gap-3">
          {remoteResources.map((resource) => {
            const status = statuses[resource.id] || { state: "idle" };
            const checking = status.state === "checking";
            return (
              <article
                key={resource.id}
                className="rounded-lg border border-border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Server className="h-4 w-4 text-primary" />
                      <h3 className="truncate text-sm font-semibold">
                        {resource.label}
                      </h3>
                      {resource.id === defaultResourceId && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {t("current")}
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          status.state === "error"
                            ? "bg-red-50 text-red-700 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {checking ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : status.state === "error" ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {status.state === "error"
                          ? t("remoteProjectError")
                          : checking
                          ? t("checking")
                          : t("configured")}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                      <div className="min-w-0 truncate">
                        {t("resource")}: {resource.id}
                      </div>
                      <div className="min-w-0 truncate">
                        Runtime: {resource.runtimeUrl || "-"}
                      </div>
                      <div className="min-w-0 truncate md:col-span-2">
                        {t("remoteProjectPath")}:{" "}
                        {resource.workspacePath || "-"}
                      </div>
                    </div>
                    {status.message && (
                      <div
                        className={cn(
                          "mt-3 rounded-md px-3 py-2 text-xs leading-5",
                          status.state === "error"
                            ? "border border-red-200 bg-red-50 text-red-700 dark:border-[#ff6d8d]/35 dark:bg-[#ff6d8d]/10 dark:text-[#ffc7d4]"
                            : "border border-border bg-muted/40 text-muted-foreground"
                        )}
                      >
                        {status.message}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void syncResource(resource)}
                      disabled={checking}
                    >
                      {checking ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCcw className="h-4 w-4" />
                      )}
                      {t("syncRemote")}
                    </Button>
                    <Button
                      asChild
                      type="button"
                      variant="outline"
                      size="sm"
                    >
                      <Link href={workbenchHref(resource)}>
                        <ArrowUpRight className="h-4 w-4" />
                        {t("openProject")}
                      </Link>
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <RemoteConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfigured={handleConfigured}
      />
    </div>
  );
}
