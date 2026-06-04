"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  Download,
  GitBranch,
  Info,
  Loader2,
  Map,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { workbenchHrefFromSearchParams } from "@/app/utils/navigationContext";

type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "applying"
  | "applied"
  | "rolling-back"
  | "rolled-back"
  | "failed";

interface UpdateStatusResult {
  state: UpdateState;
  sourceRepo: string;
  sourceUrl: string;
  current: {
    version: string;
    exactTag?: string;
    branch?: string;
    commit?: string;
    dirty: boolean;
    dirtyReason?: string;
    appPath?: string;
    installMode: "desktop-app" | "source";
  };
  latest?: {
    tagName: string;
    name: string;
    htmlUrl: string;
    publishedAt?: string;
    notes?: string;
    asset?: {
      name: string;
      size?: number;
      downloadUrl: string;
    };
  };
  updateAvailable: boolean;
  canApply: boolean;
  blockReason?: string;
  message: string;
  previous?: {
    checkoutTarget: string;
    commit: string;
    label: string;
  };
  download?: {
    assetName: string;
    downloadedBytes: number;
    totalBytes?: number;
    percent?: number;
    startedAt: string;
    updatedAt: string;
  };
  backendRestart?: {
    message: string;
  };
  installLogPath?: string;
  log: Array<{
    at: string;
    message: string;
  }>;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

function formatPercent(value: number | undefined) {
  if (value === undefined) {
    return "下载中";
  }

  const clamped = Math.min(100, Math.max(0, value));
  const digits = clamped > 0 && clamped < 10 ? 1 : 0;
  return `${clamped.toFixed(digits)}%`;
}

function AboutPageContent() {
  const searchParams = useSearchParams();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatusResult | null>(
    null
  );
  const [statusLoading, setStatusLoading] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [rollingBackUpdate, setRollingBackUpdate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionBusy =
    statusLoading || checkingUpdate || applyingUpdate || rollingBackUpdate;
  const downloadProgress = updateStatus?.download;
  const downloadPercent =
    typeof downloadProgress?.percent === "number"
      ? Math.min(100, Math.max(0, downloadProgress.percent))
      : undefined;
  const showDownloadProgress =
    updateStatus?.state === "downloading" && Boolean(downloadProgress);
  const shouldPollUpdateStatus =
    applyingUpdate ||
    rollingBackUpdate ||
    updateStatus?.state === "downloading" ||
    updateStatus?.state === "applying" ||
    updateStatus?.state === "rolling-back";
  const workbenchHref = useMemo(
    () => workbenchHrefFromSearchParams(searchParams),
    [searchParams]
  );

  const downloadProgressLabel = useMemo(() => {
    if (!downloadProgress) {
      return "";
    }
    const downloaded = formatBytes(downloadProgress.downloadedBytes);
    const total =
      downloadProgress.totalBytes !== undefined
        ? formatBytes(downloadProgress.totalBytes)
        : "未知大小";
    return `${downloaded} / ${total}`;
  }, [downloadProgress]);

  function startQuickstartTour() {
    window.dispatchEvent(
      new CustomEvent("internagents.quickstart.start", {
        detail: { restart: true },
      })
    );
  }

  const loadUpdateStatus = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!options?.quiet) {
        setStatusLoading(true);
        setError(null);
      }
      try {
        const response = await fetch("/api/update/status", {
          cache: "no-store",
        });
        const payload = (await response.json()) as UpdateStatusResult & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.error || payload.message || "更新状态读取失败"
          );
        }
        setUpdateStatus(payload);
      } catch (statusError) {
        const message =
          statusError instanceof Error
            ? statusError.message
            : "更新状态读取失败";
        if (!options?.quiet) {
          setError(message);
          toast.error(message);
        }
      } finally {
        if (!options?.quiet) {
          setStatusLoading(false);
        }
      }
    },
    []
  );

  async function checkForSoftwareUpdate() {
    setCheckingUpdate(true);
    setError(null);
    try {
      const response = await fetch("/api/update/check", {
        method: "POST",
      });
      const payload = (await response.json()) as UpdateStatusResult & {
        error?: string;
      };
      setUpdateStatus(payload);
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "检查更新失败");
      }
      toast.success(payload.message);
    } catch (checkError) {
      const message =
        checkError instanceof Error ? checkError.message : "检查更新失败";
      setError(message);
      toast.error(message);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function applySoftwareUpdate() {
    const latestTag = updateStatus?.latest?.tagName;
    const confirmed = window.confirm(
      [
        latestTag
          ? `即将从 InternScience/InternAgents 更新到 ${latestTag}。`
          : "即将从 InternScience/InternAgents 更新到最新 release。",
        "",
        "更新会下载最新 DMG，退出当前 App，替换本机 .app 后重新打开。",
        "",
        "确认继续？",
      ].join("\n")
    );
    if (!confirmed) {
      return;
    }

    setApplyingUpdate(true);
    setError(null);
    try {
      const response = await fetch("/api/update/apply", {
        method: "POST",
      });
      const payload = (await response.json()) as UpdateStatusResult & {
        error?: string;
      };
      setUpdateStatus(payload);
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "更新失败");
      }
      toast.success(payload.message);
      if (payload.state === "applied") {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } catch (applyError) {
      const message =
        applyError instanceof Error ? applyError.message : "更新失败";
      setError(message);
      toast.error(message);
    } finally {
      setApplyingUpdate(false);
    }
  }

  async function rollbackSoftwareUpdate() {
    const previousLabel = updateStatus?.previous?.label;
    const confirmed = window.confirm(
      [
        previousLabel
          ? `即将回滚到 ${previousLabel}。`
          : "即将回滚到上一版本。",
        "",
        "当前 App 安装器模式不支持自动回滚；如需回滚，请下载上一版 DMG 手动安装。",
        "",
        "确认继续？",
      ].join("\n")
    );
    if (!confirmed) {
      return;
    }

    setRollingBackUpdate(true);
    setError(null);
    try {
      const response = await fetch("/api/update/rollback", {
        method: "POST",
      });
      const payload = (await response.json()) as UpdateStatusResult & {
        error?: string;
      };
      setUpdateStatus(payload);
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "回滚失败");
      }
      toast.success(payload.message);
      if (payload.state === "rolled-back") {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } catch (rollbackError) {
      const message =
        rollbackError instanceof Error ? rollbackError.message : "回滚失败";
      setError(message);
      toast.error(message);
    } finally {
      setRollingBackUpdate(false);
    }
  }

  useEffect(() => {
    void loadUpdateStatus();
  }, [loadUpdateStatus]);

  useEffect(() => {
    if (!shouldPollUpdateStatus) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadUpdateStatus({ quiet: true });
    }, 500);

    return () => window.clearInterval(intervalId);
  }, [loadUpdateStatus, shouldPollUpdateStatus]);

  return (
    <div className="min-h-[calc(100vh-var(--app-footer-height))] bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2"
          >
            <Link href={workbenchHref}>
              <ArrowLeft className="h-4 w-4" />
              工作台
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">关于与更新</h1>
            <div className="truncate text-xs text-muted-foreground">
              自我介绍、导览和本机更新
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="space-y-5">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                  <Info className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">我是 InternAgents</h2>
                  <div className="mt-1 max-w-3xl space-y-2 text-sm leading-6 text-muted-foreground">
                    <p>
                      InternAgents
                      由上海人工智能实验室研发。它不是一个单纯“会聊天”的大模型，而是一个面向科研与技术探索的大模型智能体。它将对话、文件、代码和计算资源组织在同一个工作台中，让
                      AI
                      不只是回答问题，而是能够进入真实的研究与开发过程，协助理解材料、拆解任务、调用工具、推进实验，并在关键步骤中保留人的监督、审批和纠偏能力。
                    </p>
                  </div>
                </div>
              </div>
              <Button
                asChild
                size="sm"
                className="h-9 shrink-0 bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
              >
                <a
                  href="https://github.com/InternScience/InternAgents"
                  target="_blank"
                  rel="noreferrer"
                >
                  <BookOpen className="h-4 w-4" />
                  帮助文档
                </a>
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <Map className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">导览</h2>
                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                    重新打开本机导览，依次查看工作台、工作区、对话和配置。
                  </div>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={startQuickstartTour}
                className="h-9 bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
              >
                <Map className="h-4 w-4" />
                开始导览
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <GitBranch className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">更新</h2>
                  <div className="mt-1 text-sm text-muted-foreground">
                    查看当前版本并从 GitHub Release 获取更新。
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void applySoftwareUpdate()}
                  disabled={
                    actionBusy ||
                    !updateStatus?.updateAvailable ||
                    !updateStatus.canApply
                  }
                  className="h-9 bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
                >
                  {applyingUpdate ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  一键更新
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void checkForSoftwareUpdate()}
                  disabled={actionBusy}
                  className="h-9"
                >
                  {checkingUpdate ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  检查更新
                </Button>
                {updateStatus?.previous && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void rollbackSoftwareUpdate()}
                    disabled={actionBusy}
                    className="h-9"
                  >
                    {rollingBackUpdate ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-4 w-4" />
                    )}
                    回滚上一版本
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {updateStatus?.current.dirty && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                  {updateStatus.current.dirtyReason ||
                    "当前安装目录有未提交改动，暂不能一键更新。"}
                </div>
              )}
              {updateStatus?.blockReason && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                  {updateStatus.blockReason}
                </div>
              )}

              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">当前版本</div>
                  <div className="mt-1 truncate font-mono text-sm">
                    {updateStatus?.current.exactTag ||
                      `v${updateStatus?.current.version || "0.0.0"}`}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">最新版本</div>
                  <div className="mt-1 truncate font-mono text-sm">
                    {updateStatus?.latest?.tagName || "尚未检查"}
                  </div>
                  {updateStatus?.latest?.publishedAt && (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {new Date(
                        updateStatus.latest.publishedAt
                      ).toLocaleString()}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">更新状态</div>
                  <div className="mt-1 truncate text-sm">
                    {updateStatus?.message || "正在读取更新状态..."}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {updateStatus?.backendRestart?.message ||
                      updateStatus?.latest?.asset?.name ||
                      (updateStatus ? "GitHub Release DMG" : "等待状态读取")}
                  </div>
                </div>
              </div>

              {showDownloadProgress && downloadProgress && (
                <div className="rounded-md border border-border bg-background px-3 py-3">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0 truncate font-medium">
                      {downloadProgress.assetName}
                    </div>
                    <div className="shrink-0 font-mono text-muted-foreground">
                      {formatPercent(downloadPercent)}
                    </div>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[#2F6868] transition-[width] duration-300 dark:bg-teal-300"
                      style={{
                        width:
                          downloadPercent !== undefined
                            ? `${downloadPercent}%`
                            : "45%",
                      }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <div className="truncate">{downloadProgressLabel}</div>
                    <div className="shrink-0">
                      {new Date(
                        downloadProgress.updatedAt
                      ).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              )}

              {updateStatus?.latest?.notes && (
                <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Release Notes
                  </div>
                  <div className="line-clamp-3 whitespace-pre-line text-muted-foreground">
                    {updateStatus.latest.notes}
                  </div>
                </div>
              )}

              {updateStatus?.log && updateStatus.log.length > 0 && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {updateStatus.log.slice(-3).map((entry) => (
                    <div
                      key={`${entry.at}-${entry.message}`}
                      className="truncate"
                    >
                      {new Date(entry.at).toLocaleTimeString()} ·{" "}
                      {entry.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default function AboutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <AboutPageContent />
    </Suspense>
  );
}
