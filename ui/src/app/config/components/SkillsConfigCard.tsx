"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CloudDownload,
  FolderCog,
  FolderPlus,
  Loader2,
  Save,
  ServerCog,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  BackendRestartResult,
  BackendStatusResult,
  ImportSkillsResponse,
  SkillImportType,
  SkillsConfigResponse,
} from "@/app/skills/types";

function SkillSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-32 animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}

function emptyResponse(): SkillsConfigResponse {
  return {
    enabled: false,
    catalogPaths: ["skills"],
    activePath: ".internagents/active-skills",
    selected: [],
    skills: [],
  };
}

export function SkillsConfigCard() {
  const [data, setData] = useState<SkillsConfigResponse>(() => emptyResponse());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [importingSkill, setImportingSkill] = useState<SkillImportType | null>(
    null
  );
  const [pickingLocalFolder, setPickingLocalFolder] = useState(false);
  const [localSource, setLocalSource] = useState("");
  const [cloudSource, setCloudSource] = useState("");
  const [autoRestart, setAutoRestart] = useState(false);
  const [backendStatus, setBackendStatus] =
    useState<BackendStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = selected.size;
  const draftEnabled = selectedCount > 0;
  const actionBusy =
    loading ||
    saving ||
    restarting ||
    pickingLocalFolder ||
    importingSkill !== null;
  const isBusy = actionBusy || checkingStatus;
  const hasChanges = useMemo(() => {
    const initial = new Set(data.selected);
    if (draftEnabled !== data.enabled || selected.size !== initial.size) {
      return true;
    }
    return Array.from(selected).some((key) => !initial.has(key));
  }, [data.enabled, data.selected, draftEnabled, selected]);
  const canApplyWhenIdle = !isBusy;
  const canApplyNow = !isBusy;
  const restartMessage = data.restart?.message.trim();
  const backendStatusMessage = backendStatus?.message.trim();
  const showBackendStatus =
    Boolean(backendStatusMessage) && backendStatusMessage !== restartMessage;

  async function loadSkills() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "技能配置加载失败");
      }
      const nextData = payload as SkillsConfigResponse;
      setData(nextData);
      setSelected(new Set(nextData.selected));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "技能配置加载失败"
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveSkills(
    options: { scheduleIdle?: boolean } = {}
  ): Promise<boolean> {
    const scheduleIdle = options.scheduleIdle ?? true;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/skills", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draftEnabled,
          selected: Array.from(selected),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "技能配置保存失败");
      }
      const nextData = payload as SkillsConfigResponse;
      setData({
        ...nextData,
        requiresRestart: true,
      });
      setSelected(new Set(nextData.selected));
      setBackendStatus(null);
      setAutoRestart(scheduleIdle);
      toast.success(
        scheduleIdle
          ? nextData.message || "技能配置已保存，将在空闲时自动应用"
          : "技能配置已保存"
      );
      return true;
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "技能配置保存失败";
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function checkBackendStatus(): Promise<BackendStatusResult> {
    setCheckingStatus(true);
    try {
      const response = await fetch("/api/runtime/backend/status", {
        cache: "no-store",
      });
      const status = (await response.json()) as BackendStatusResult;
      setBackendStatus(status);
      setData((current) => ({
        ...current,
        backendStatus: status,
      }));
      return status;
    } finally {
      setCheckingStatus(false);
    }
  }

  async function restartBackendNow({ manual }: { manual: boolean }) {
    if (manual) {
      const status = await checkBackendStatus();
      const confirmed = window.confirm(
        [
          "立即应用会重新加载技能配置。",
          "",
          "风险：正在运行或等待审批的任务可能中断。历史会话会保留，但当前未完成的步骤可能需要重新发送。",
          "",
          status.status === "idle"
            ? "当前检测结果：后台空闲。确认立即应用？"
            : `当前检测结果：${status.message} 确认仍然立即应用？`,
        ].join("\n")
      );
      if (!confirmed) {
        return;
      }
    }

    setRestarting(true);
    setError(null);
    try {
      const response = await fetch("/api/runtime/backend/restart", {
        method: "POST",
      });
      const restart = (await response.json()) as BackendRestartResult;
      setData((current) => ({
        ...current,
        requiresRestart: restart.status !== "restarted",
        restart,
      }));

      if (!response.ok || restart.status !== "restarted") {
        throw new Error(restart.message || "后台重启失败");
      }

      setAutoRestart(false);
      setBackendStatus({
        status: "idle",
        message: "技能配置已应用。",
        url: restart.url,
        busyThreads: 0,
        interruptedThreads: 0,
      });
      toast.success(restart.message || "技能配置已应用");
    } catch (restartError) {
      const message =
        restartError instanceof Error ? restartError.message : "技能配置应用失败";
      setError(message);
      toast.error(message);
    } finally {
      setRestarting(false);
    }
  }

  async function applyWhenIdle() {
    if (hasChanges) {
      await saveSkills({ scheduleIdle: true });
      return;
    }

    setData((current) => ({
      ...current,
      requiresRestart: true,
    }));
    setBackendStatus(null);
    setAutoRestart(true);
    toast.success("将在后台空闲时自动应用当前技能配置");
  }

  async function applyNow() {
    if (hasChanges) {
      const saved = await saveSkills({ scheduleIdle: false });
      if (!saved) {
        return;
      }
    }

    await restartBackendNow({ manual: true });
  }

  function toggleSkill(key: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    setSelected(next);
  }

  async function importSkill(type: SkillImportType, sourceOverride?: string) {
    const source =
      sourceOverride?.trim() ||
      (type === "local" ? localSource.trim() : cloudSource.trim());
    if (!source) {
      toast.error(type === "local" ? "请输入本地技能路径" : "请输入云端技能地址");
      return;
    }

    setImportingSkill(type);
    setError(null);
    try {
      const response = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, source }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "技能添加失败");
      }

      const nextData = payload as ImportSkillsResponse;
      setData((current) => ({
        ...nextData,
        requiresRestart: current.requiresRestart,
        restart: current.restart,
        backendStatus: current.backendStatus,
      }));
      setSelected(new Set(nextData.selected));
      if (type === "local") {
        setLocalSource("");
      } else {
        setCloudSource("");
      }
      toast.success(nextData.message || "技能已添加");
    } catch (importError) {
      const message =
        importError instanceof Error ? importError.message : "技能添加失败";
      setError(message);
      toast.error(message);
    } finally {
      setImportingSkill(null);
    }
  }

  async function pickAndImportLocalSkill() {
    const typedSource = localSource.trim();
    if (typedSource) {
      await importSkill("local", typedSource);
      return;
    }

    setPickingLocalFolder(true);
    setError(null);
    try {
      const response = await fetch("/api/skills/local-picker", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        path?: string;
        cancelled?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "无法打开本地文件夹选择器");
      }
      if (payload.cancelled) {
        return;
      }
      if (!payload.path) {
        throw new Error("没有选择本地技能文件夹。");
      }

      setLocalSource(payload.path);
      await importSkill("local", payload.path);
    } catch (pickError) {
      const message =
        pickError instanceof Error
          ? pickError.message
          : "无法打开本地文件夹选择器";
      setError(message);
      toast.error(message);
    } finally {
      setPickingLocalFolder(false);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, []);

  useEffect(() => {
    if (!autoRestart || !data.requiresRestart || hasChanges || actionBusy) {
      return;
    }

    let cancelled = false;
    const checkAndRestart = async () => {
      try {
        const status = await checkBackendStatus();
        if (!cancelled && status.status === "idle") {
          await restartBackendNow({ manual: false });
        }
      } catch {
        // Keep polling; the visible status panel will update on the next success.
      }
    };
    void checkAndRestart();
    const interval = window.setInterval(checkAndRestart, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRestart, data.requiresRestart, hasChanges, actionBusy]);

  return (
    <section
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      data-tour="config-skills"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">技能</h2>
            <div className="mt-1 text-sm text-muted-foreground">
              选择本地可加载技能，也可以添加本地路径或云端来源。
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void applyWhenIdle()}
            disabled={!canApplyWhenIdle}
            title={
              hasChanges
                ? "保存当前技能选择，并在后台空闲时自动应用。"
                : "后台空闲时自动重启并加载当前技能配置。"
            }
            className="h-9 bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            空闲应用
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void applyNow()}
            disabled={!canApplyNow}
            title="保存技能选择并立即应用。"
            className="h-9"
          >
            {restarting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ServerCog className="h-4 w-4" />
            )}
            立即应用
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          已选择 {selectedCount} 个技能。建议选择 20 个以内；新选择的技能需要应用后生效。
        </span>
        {data.requiresRestart && !hasChanges && (
          <span className="text-amber-700">有技能配置等待应用。</span>
        )}
        {data.restart && (
          <span
            className={cn(
              data.restart.status === "restarted"
                ? "text-green-700"
                : "text-red-700"
            )}
          >
            {data.restart.message}
          </span>
        )}
        {backendStatus && showBackendStatus && (
          <span
            className={cn(
              backendStatus.status === "idle"
                ? "text-green-700"
                : backendStatus.status === "busy"
                ? "text-amber-700"
                : "text-red-700"
            )}
          >
            {backendStatus.message}
          </span>
        )}
      </div>

      <div className="space-y-5">
        {loading ? (
          <SkillSkeleton />
        ) : data.skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background px-6 py-8 text-center">
            <FolderCog className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="text-base font-semibold">还没有可选技能</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              在项目的 skills 目录下放置包含 SKILL.md 的技能文件夹后，这里会自动出现。
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.skills.map((skill) => {
              const checked = selected.has(skill.key);
              return (
                <article
                  key={skill.key}
                  className={cn(
                    "flex min-h-32 flex-col justify-between rounded-lg border bg-background p-3 transition-colors",
                    checked
                      ? "border-[#2F6868] bg-[#F1F7F6] ring-2 ring-[#2F6868]/10 dark:bg-teal-950/20"
                      : "border-border hover:border-[#2F6868]/40"
                  )}
                >
                  <div>
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card">
                        {checked ? (
                          <Check className="h-4 w-4 text-[#2F6868]" />
                        ) : (
                          <Sparkles className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <Switch
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          toggleSkill(skill.key, nextChecked)
                        }
                        disabled={isBusy}
                        aria-label={`选择 ${skill.name}`}
                      />
                    </div>
                    <h3 className="text-sm font-semibold">{skill.name}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {skill.description}
                    </p>
                  </div>
                  <div className="mt-3 truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                    {skill.relativePath}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="border-t border-border pt-4">
          <div className="mb-3 flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-[#2F6868] dark:text-teal-300" />
            <h3 className="text-sm font-semibold">添加技能</h3>
          </div>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
              <Label
                htmlFor="config-local-skill-source"
                className="text-xs text-muted-foreground"
              >
                本地路径
              </Label>
              <Input
                id="config-local-skill-source"
                value={localSource}
                onChange={(event) => setLocalSource(event.target.value)}
                placeholder="/Users/me/skills/paper-reading 或 skills/my-skill"
                disabled={isBusy}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void pickAndImportLocalSkill()}
                disabled={isBusy}
                title={
                  localSource.trim()
                    ? "添加输入框中的本地技能路径"
                    : "打开本地文件夹选择器并添加技能"
                }
              >
                {pickingLocalFolder || importingSkill === "local" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                添加
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
              <Label
                htmlFor="config-cloud-skill-source"
                className="text-xs text-muted-foreground"
              >
                云端地址
              </Label>
              <Input
                id="config-cloud-skill-source"
                value={cloudSource}
                onChange={(event) => setCloudSource(event.target.value)}
                placeholder="github:owner/repo/path 或 https://github.com/owner/repo"
                disabled={isBusy}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void importSkill("cloud")}
                disabled={isBusy || !cloudSource.trim()}
              >
                {importingSkill === "cloud" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CloudDownload className="h-4 w-4" />
                )}
                添加
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
