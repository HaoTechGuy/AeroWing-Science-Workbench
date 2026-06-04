"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  Check,
  CloudDownload,
  FolderCog,
  FolderPlus,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  ImportSkillsResponse,
  SkillImportType,
  SkillsConfigResponse,
} from "@/app/skills/types";

export interface SkillsConfigCardState {
  hasChanges: boolean;
  isBusy: boolean;
  requiresRestart: boolean;
}

export interface SkillsConfigSaveResult {
  saved: boolean;
  needsRestart: boolean;
}

export interface SkillsConfigCardHandle {
  save: (options?: {
    silent?: boolean;
  }) => Promise<SkillsConfigSaveResult>;
  markApplied: () => void;
}

interface SkillsConfigCardProps {
  onStateChange?: (state: SkillsConfigCardState) => void;
}

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

export const SkillsConfigCard = forwardRef<
  SkillsConfigCardHandle,
  SkillsConfigCardProps
>(function SkillsConfigCard({ onStateChange }, ref) {
  const [data, setData] = useState<SkillsConfigResponse>(() => emptyResponse());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importingSkill, setImportingSkill] = useState<SkillImportType | null>(
    null
  );
  const [pickingLocalFolder, setPickingLocalFolder] = useState(false);
  const [localSource, setLocalSource] = useState("");
  const [cloudSource, setCloudSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedCount = selected.size;
  const draftEnabled = selectedCount > 0;
  const actionBusy =
    loading ||
    saving ||
    pickingLocalFolder ||
    importingSkill !== null;
  const isBusy = actionBusy;
  const hasChanges = useMemo(() => {
    const initial = new Set(data.selected);
    if (draftEnabled !== data.enabled || selected.size !== initial.size) {
      return true;
    }
    return Array.from(selected).some((key) => !initial.has(key));
  }, [data.enabled, data.selected, draftEnabled, selected]);
  const requiresRestart = Boolean(data.requiresRestart);

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

  const saveSkills = useCallback(async function saveSkills(
    options: { silent?: boolean } = {}
  ): Promise<SkillsConfigSaveResult> {
    setSaving(true);
    setError(null);
    try {
      if (!hasChanges) {
        return { saved: true, needsRestart: requiresRestart };
      }

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
      if (!options.silent) {
        toast.success("技能配置已保存");
      }
      return { saved: true, needsRestart: true };
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "技能配置保存失败";
      setError(message);
      toast.error(message);
      return { saved: false, needsRestart: false };
    } finally {
      setSaving(false);
    }
  }, [draftEnabled, hasChanges, requiresRestart, selected]);

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

  useImperativeHandle(
    ref,
    () => ({
      save: saveSkills,
      markApplied: () => {
        setData((current) => ({
          ...current,
          requiresRestart: false,
          restart: undefined,
          backendStatus: undefined,
        }));
      },
    }),
    [saveSkills]
  );

  useEffect(() => {
    onStateChange?.({
      hasChanges,
      isBusy,
      requiresRestart,
    });
  }, [hasChanges, isBusy, onStateChange, requiresRestart]);

  return (
    <section
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      data-tour="config-skills"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">技能</h2>
            <div className="mt-1 text-sm text-muted-foreground">
              选择本地可加载技能，也可以添加本地路径或云端来源；通过页面顶部按钮统一应用。
            </div>
          </div>
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
        {requiresRestart && !hasChanges && (
          <span className="text-amber-700">有技能配置等待应用。</span>
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
});
