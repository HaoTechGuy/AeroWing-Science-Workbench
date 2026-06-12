"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { workbenchHrefFromSearchParams } from "@/app/utils/navigationContext";
import type {
  BackendRestartResult,
  BackendStatusResult,
  SkillEntry,
  SkillsConfigResponse,
} from "@/app/skills/types";

const INSTALLED_PREVIEW_COUNT = 4;
const CHAT_COMPOSER_HASH = "chat-composer";
const COMPOSER_DRAFT_QUERY_KEY = "composerDraft";
const SKILL_CREATOR_DRAFT =
  "@skill-creator 请帮我创建一个能够实现「......」的skill";

function emptyResponse(): SkillsConfigResponse {
  return {
    enabled: false,
    catalogPaths: ["skills"],
    activePath: ".internagents/active-skills",
    selected: [],
    skills: [],
  };
}

function skillPath(skill: SkillEntry): string {
  return skill.relativePath || skill.folderName || skill.key;
}

function skillMatchesQuery(skill: SkillEntry, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [skill.name, skill.description, skillPath(skill)].some((value) =>
    value.toLowerCase().includes(normalizedQuery)
  );
}

function withChatComposerHash(href: string): string {
  const [base] = href.split("#");
  return `${base}#${CHAT_COMPOSER_HASH}`;
}

function withComposerDraft(href: string, draft: string): string {
  const parsed = new URL(href, "http://internagents.local");
  parsed.searchParams.set(COMPOSER_DRAFT_QUERY_KEY, draft);
  parsed.hash = CHAT_COMPOSER_HASH;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function SkillGlyph({ skill }: { skill: SkillEntry }) {
  const label = skill.name.trim().charAt(0).toUpperCase() || "S";

  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/10"
    >
      {label}
    </span>
  );
}

function SkillSkeleton() {
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex items-start gap-4"
        >
          <div className="h-11 w-11 animate-pulse rounded-md bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkillCard({
  actionBusy,
  installing,
  installed,
  onInstall,
  onOpenDetails,
  onUninstall,
  skill,
  uninstalling,
}: {
  actionBusy: boolean;
  installing: boolean;
  installed: boolean;
  onInstall: (skill: SkillEntry) => void;
  onOpenDetails: (skill: SkillEntry) => void;
  onUninstall: (skill: SkillEntry) => void;
  skill: SkillEntry;
  uninstalling: boolean;
}) {
  const [actionVisible, setActionVisible] = useState(false);
  const showInstalledAction = installed && (actionVisible || uninstalling);

  return (
    <article
      onMouseEnter={() => setActionVisible(true)}
      onMouseLeave={() => setActionVisible(false)}
      onFocusCapture={() => setActionVisible(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setActionVisible(false);
        }
      }}
      className={cn(
        "flex min-h-[76px] min-w-0 max-w-full items-start overflow-hidden rounded-lg border px-2 py-1 transition-[background-color,border-color,box-shadow]",
        installed
          ? "border-primary/20 bg-primary/[0.045] shadow-sm shadow-primary/5 hover:bg-primary/[0.075]"
          : "border-transparent hover:border-border hover:bg-card/75"
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetails(skill)}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-4 rounded-md px-2 py-3 text-left outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`查看 ${skill.name} 详情`}
      >
        <SkillGlyph skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold leading-6">
            {skill.name}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {skill.description}
          </div>
        </div>
      </button>
      <div className="flex min-h-[66px] w-[104px] shrink-0 items-start justify-end px-1 py-3">
        {installed ? (
          <div className="flex min-h-7 items-start justify-end">
            {showInstalledAction ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onUninstall(skill)}
                disabled={actionBusy}
                className="h-7 min-w-[76px] border-destructive/25 bg-card px-2 text-xs text-destructive transition-[background-color,border-color,color,opacity] hover:bg-destructive/10 hover:text-destructive"
                aria-label={`取消安装 ${skill.name}`}
                title={`取消安装 ${skill.name}`}
              >
                {uninstalling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                取消
              </Button>
            ) : (
              <span className="inline-flex h-7 min-w-[76px] items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground shadow-sm shadow-primary/10">
                <Check className="h-3.5 w-3.5" />
                已安装
              </span>
            )}
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onInstall(skill)}
            disabled={actionBusy}
            className={cn(
              "h-8 px-2 opacity-100 transition-opacity sm:opacity-0 sm:focus-visible:opacity-100",
              (actionVisible || installing) && "sm:opacity-100"
            )}
            aria-label={`安装 ${skill.name}`}
            title={`安装 ${skill.name}`}
          >
            {installing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            安装
          </Button>
        )}
      </div>
    </article>
  );
}

export function SkillsMarketplace() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<SkillsConfigResponse>(() => emptyResponse());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [uninstallingKey, setUninstallingKey] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [backendStatus, setBackendStatus] =
    useState<BackendStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllInstalled, setShowAllInstalled] = useState(false);
  const [detailSkill, setDetailSkill] = useState<SkillEntry | null>(null);

  const workbenchHref = useMemo(
    () => workbenchHrefFromSearchParams(searchParams),
    [searchParams]
  );
  const chatComposerHref = useMemo(
    () => withChatComposerHash(workbenchHref),
    [workbenchHref]
  );
  const skillCreatorHref = useMemo(
    () => withComposerDraft(workbenchHref, SKILL_CREATOR_DRAFT),
    [workbenchHref]
  );
  const actionBusy =
    loading ||
    installingKey !== null ||
    uninstallingKey !== null ||
    checkingStatus ||
    restarting;
  const installedSkills = useMemo(
    () => data.skills.filter((skill) => selected.has(skill.key)),
    [data.skills, selected]
  );
  const visibleInstalledSkills = showAllInstalled
    ? installedSkills
    : installedSkills.slice(0, INSTALLED_PREVIEW_COUNT);
  const hiddenInstalledCount = Math.max(
    0,
    installedSkills.length - visibleInstalledSkills.length
  );
  const filteredSkills = useMemo(
    () =>
      data.skills.filter((skill) => skillMatchesQuery(skill, searchQuery)),
    [data.skills, searchQuery]
  );

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "技能加载失败");
      }
      const nextData = payload as SkillsConfigResponse;
      setData(nextData);
      setSelected(new Set(nextData.selected));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "技能加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const checkBackendStatus = useCallback(async (): Promise<BackendStatusResult> => {
    setCheckingStatus(true);
    try {
      const response = await fetch("/api/runtime/backend/status", {
        cache: "no-store",
      });
      const status = (await response.json()) as BackendStatusResult;
      setBackendStatus(status);
      return status;
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  const restartBackendWhenIdle = useCallback(async () => {
    setRestarting(true);
    try {
      const response = await fetch("/api/runtime/backend/restart", {
        method: "POST",
      });
      const restart = (await response.json()) as BackendRestartResult;
      if (!response.ok || restart.status !== "restarted") {
        throw new Error(restart.message || "后台应用失败");
      }

      setAutoRestart(false);
      setBackendStatus({
        status: "idle",
        message: restart.message,
        url: restart.url,
        busyThreads: 0,
        interruptedThreads: 0,
      });
      setData((current) => ({
        ...current,
        requiresRestart: false,
        restart,
      }));
    } catch (restartError) {
      setError(
        restartError instanceof Error ? restartError.message : "后台应用失败"
      );
    } finally {
      setRestarting(false);
    }
  }, []);

  async function installSkill(skill: SkillEntry) {
    if (selected.has(skill.key) || actionBusy) {
      return;
    }

    const nextSelected = new Set(selected);
    nextSelected.add(skill.key);
    setInstallingKey(skill.key);
    setError(null);
    try {
      const response = await fetch("/api/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextSelected.size > 0,
          selected: Array.from(nextSelected),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "技能安装失败");
      }

      const nextData = payload as SkillsConfigResponse;
      setData({
        ...nextData,
        requiresRestart: true,
      });
      setSelected(new Set(nextData.selected));
      setBackendStatus(null);
      setAutoRestart(true);
      toast.success(`「${skill.name}」已安装，快去试试 ->`, {
        position: "top-center",
      });
    } catch (installError) {
      const message =
        installError instanceof Error ? installError.message : "技能安装失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setInstallingKey(null);
    }
  }

  async function uninstallSkill(skill: SkillEntry) {
    if (!selected.has(skill.key) || actionBusy) {
      return;
    }

    const nextSelected = new Set(selected);
    nextSelected.delete(skill.key);
    setUninstallingKey(skill.key);
    setError(null);
    try {
      const response = await fetch("/api/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: nextSelected.size > 0,
          selected: Array.from(nextSelected),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "取消安装失败");
      }

      const nextData = payload as SkillsConfigResponse;
      setData({
        ...nextData,
        requiresRestart: true,
      });
      setSelected(new Set(nextData.selected));
      setBackendStatus(null);
      setAutoRestart(true);
      toast.success(`「${skill.name}」已取消安装`, {
        position: "top-center",
      });
    } catch (uninstallError) {
      const message =
        uninstallError instanceof Error ? uninstallError.message : "取消安装失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setUninstallingKey(null);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!autoRestart || !data.requiresRestart || actionBusy) {
      return;
    }

    let cancelled = false;
    const checkAndRestart = async () => {
      try {
        const status = await checkBackendStatus();
        if (!cancelled && status.status === "idle") {
          await restartBackendWhenIdle();
        }
      } catch {
        // Keep this quiet; install remains saved and the next poll can retry.
      }
    };
    void checkAndRestart();
    const interval = window.setInterval(checkAndRestart, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    actionBusy,
    autoRestart,
    checkBackendStatus,
    data.requiresRestart,
    restartBackendWhenIdle,
  ]);

  return (
    <div className="flex min-h-[calc(100vh-var(--app-footer-height))] flex-col overflow-x-hidden bg-background text-foreground">
      <header className="flex h-14 items-center gap-3 border-b border-border px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2"
        >
          <Link href={chatComposerHref}>
            <ArrowLeft className="h-4 w-4" />
            对话框
          </Link>
        </Button>
        <div className="text-sm font-semibold">能力插件</div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-hidden px-6 py-7">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal">技能</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              赋予 InternAgents 更强大的能力
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索技能"
                className="h-10 rounded-md pl-9"
              />
            </div>
            <Button
              asChild
              variant="outline"
              className="h-10 shrink-0 rounded-full px-4"
            >
              <Link href={skillCreatorHref}>
                <Plus className="h-4 w-4" />
                创建技能
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <section className="mb-8 border-b border-border pb-8">
          <div className="mb-5 flex items-center gap-2">
            <h2 className="text-base font-semibold">已安装</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {installedSkills.length}
            </span>
          </div>

          {loading ? (
            <SkillSkeleton />
          ) : installedSkills.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              还没有安装技能
            </div>
          ) : (
            <>
              <div className="grid w-full max-w-full grid-cols-1 gap-x-8 gap-y-4 overflow-x-hidden md:grid-cols-2">
                {visibleInstalledSkills.map((skill) => (
                  <SkillCard
                    key={skill.key}
                    actionBusy={actionBusy}
                    installing={installingKey === skill.key}
                    installed
                    onInstall={installSkill}
                    onOpenDetails={setDetailSkill}
                    onUninstall={uninstallSkill}
                    skill={skill}
                    uninstalling={uninstallingKey === skill.key}
                  />
                ))}
              </div>
              {(hiddenInstalledCount > 0 || showAllInstalled) && (
                <div className="mt-6 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-md"
                    onClick={() => setShowAllInstalled((current) => !current)}
                  >
                    {showAllInstalled
                      ? "收起"
                      : `显示更多${hiddenInstalledCount ? ` (${hiddenInstalledCount})` : ""}`}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="space-y-5">
          <h2 className="text-base font-semibold">全部技能</h2>

          {loading ? (
            <SkillSkeleton />
          ) : data.skills.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              暂时没有技能
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              没有找到匹配的技能
            </div>
          ) : (
            <div className="grid w-full max-w-full grid-cols-1 gap-x-8 gap-y-4 overflow-x-hidden md:grid-cols-2">
              {filteredSkills.map((skill) => {
                const installed = selected.has(skill.key);
                return (
                  <SkillCard
                    key={skill.key}
                    actionBusy={actionBusy}
                    installing={installingKey === skill.key}
                    installed={installed}
                    onInstall={installSkill}
                    onOpenDetails={setDetailSkill}
                    onUninstall={uninstallSkill}
                    skill={skill}
                    uninstalling={uninstallingKey === skill.key}
                  />
                );
              })}
            </div>
          )}
        </section>

        {backendStatus?.status === "busy" && (
          <div className="mt-4 text-xs text-muted-foreground">
            技能已保存，后台空闲后会自动准备好。
          </div>
        )}
      </main>

      <Dialog
        open={detailSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSkill(null);
          }
        }}
      >
        {detailSkill && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <SkillGlyph skill={detailSkill} />
                <div className="min-w-0">
                  <DialogTitle className="truncate text-base leading-6">
                    {detailSkill.name}
                  </DialogTitle>
                  <DialogDescription className="mt-1">
                    {selected.has(detailSkill.key) ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <Check className="h-3.5 w-3.5" />
                        已安装
                      </span>
                    ) : (
                      "未安装"
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            <div className="text-sm leading-6">
              <p className="text-muted-foreground">
                {detailSkill.description || "暂无介绍"}
              </p>
            </div>
            <DialogFooter>
              {selected.has(detailSkill.key) ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => uninstallSkill(detailSkill)}
                  disabled={actionBusy}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {uninstallingKey === detailSkill.key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  取消安装
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => installSkill(detailSkill)}
                  disabled={actionBusy}
                >
                  {installingKey === detailSkill.key ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  安装
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
