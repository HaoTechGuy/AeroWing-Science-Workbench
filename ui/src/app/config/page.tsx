"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Cpu,
  KeyRound,
  Loader2,
  Moon,
  Save,
  ServerCog,
  Shield,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  applyTheme,
  getStoredTheme,
  type ThemeMode,
} from "@/lib/theme";

type AuthorizationMode = "auto" | "write" | "all";

interface ConfigResponse {
  configPath: string;
  envPath: string;
  model: string;
  openrouterApiKeySet: boolean;
  openrouterApiKeyPreview: string;
  authorizationMode: AuthorizationMode;
  message?: string;
}

interface BackendRestartResult {
  status: "restarted" | "failed";
  message: string;
  url: string;
  pid?: number;
  oldPid?: number;
  logPath: string;
}

interface BackendStatusResult {
  status: "idle" | "busy" | "unavailable";
  message: string;
  url: string;
  busyThreads: number;
  interruptedThreads: number;
}

const DEFAULT_CONFIG: ConfigResponse = {
  configPath: "",
  envPath: "",
  model: "anthropic/claude-sonnet-4",
  openrouterApiKeySet: false,
  openrouterApiKeyPreview: "",
  authorizationMode: "auto",
};

const MODEL_PRESETS = [
  "deepseek/deepseek-chat",
  "deepseek/deepseek-r1",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-pro",
  "openai/gpt-4.1",
];

const AUTHORIZATION_OPTIONS: Array<{
  id: AuthorizationMode;
  title: string;
  badge?: string;
  description: string;
  detail: string;
}> = [
  {
    id: "auto",
    title: "自动授权",
    badge: "推荐",
    description: "所有工具调用直接执行，不弹出审批。",
    detail: "适合只在自己电脑上使用、并且信任当前项目和模型的开发场景。",
  },
  {
    id: "write",
    title: "写入需审批",
    description: "写文件和改文件前需要确认。",
    detail: "读取、搜索和命令执行更顺畅，本地文件变更仍会先停下来等你确认。",
  },
  {
    id: "all",
    title: "全部工具需审批",
    description: "常见工具调用都会先请求确认。",
    detail: "最保守，但对话过程中会出现更多审批步骤。",
  },
];

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  title: string;
  description: string;
}> = [
  {
    id: "light",
    title: "白天",
    description: "明亮界面，适合白天和高亮度环境。",
  },
  {
    id: "dark",
    title: "黑夜",
    description: "深色界面，适合夜间和低亮度环境。",
  },
];

export default function ConfigPage() {
  const [config, setConfig] = useState<ConfigResponse>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] =
    useState<ConfigResponse>(DEFAULT_CONFIG);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [backendStatus, setBackendStatus] =
    useState<BackendStatusResult | null>(null);
  const [restartResult, setRestartResult] =
    useState<BackendRestartResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actionBusy = loading || saving || restarting;
  const isBusy = actionBusy || checkingStatus;
  const hasChanges = useMemo(() => {
    return (
      config.model !== savedConfig.model ||
      config.authorizationMode !== savedConfig.authorizationMode ||
      apiKeyDraft.trim().length > 0
    );
  }, [
    apiKeyDraft,
    config.authorizationMode,
    config.model,
    savedConfig.authorizationMode,
    savedConfig.model,
  ]);
  const canApplyWhenIdle = !isBusy;
  const canApplyNow = !isBusy && !hasChanges;

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "配置读取失败");
      }
      const nextConfig = payload as ConfigResponse;
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setRequiresRestart(false);
      setRestartResult(null);
      setBackendStatus(null);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "配置读取失败";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          openrouterApiKey: apiKeyDraft.trim(),
          authorizationMode: config.authorizationMode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "配置保存失败");
      }
      const nextConfig = payload as ConfigResponse;
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setApiKeyDraft("");
      setRequiresRestart(true);
      setBackendStatus(null);
      setRestartResult(null);
      setAutoRestart(true);
      toast.success(payload.message || "配置已保存，将在空闲时自动应用");
      return true;
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "配置保存失败";
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
      return status;
    } finally {
      setCheckingStatus(false);
    }
  }

  async function restartBackendNow({ manual }: { manual: boolean }) {
    let status: BackendStatusResult | null = null;
    if (manual) {
      status = await checkBackendStatus();
      const confirmed = window.confirm(
        [
          "立即应用会重新加载配置。",
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
      setRestartResult(restart);
      setRequiresRestart(restart.status !== "restarted");

      if (!response.ok || restart.status !== "restarted") {
        throw new Error(restart.message || "配置应用失败");
      }

      setAutoRestart(false);
      setBackendStatus({
        status: "idle",
        message: "配置已应用。",
        url: restart.url,
        busyThreads: 0,
        interruptedThreads: 0,
      });
      toast.success(restart.message || "配置已应用");
    } catch (restartError) {
      const message =
        restartError instanceof Error ? restartError.message : "配置应用失败";
      setError(message);
      toast.error(message);
    } finally {
      setRestarting(false);
    }
  }

  async function applyWhenIdle() {
    if (hasChanges) {
      await saveConfig();
      return;
    }

    setRequiresRestart(true);
    setBackendStatus(null);
    setRestartResult(null);
    setAutoRestart(true);
    toast.success("将在后台空闲时自动应用当前配置");
  }

  function updateTheme(nextTheme: ThemeMode) {
    setThemeMode(nextTheme);
    applyTheme(nextTheme);
  }

  useEffect(() => {
    const storedTheme = getStoredTheme();
    setThemeMode(storedTheme);
    applyTheme(storedTheme);
    void loadConfig();
  }, []);

  useEffect(() => {
    if (!autoRestart || !requiresRestart || hasChanges || actionBusy) {
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
        // Keep polling; the visible status text updates on the next successful check.
      }
    };

    void checkAndRestart();
    const interval = window.setInterval(checkAndRestart, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRestart, requiresRestart, hasChanges, actionBusy]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2"
          >
            <Link href="/?assistantId=agent">
              <ArrowLeft className="h-4 w-4" />
              工作台
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">配置</h1>
            <div className="truncate text-xs text-muted-foreground">
              模型、授权模式和界面风格
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={applyWhenIdle}
            disabled={!canApplyWhenIdle}
            title={
              hasChanges
                ? "保存当前配置，并在后台空闲时自动应用。"
                : "后台空闲时自动重启并加载当前配置。"
            }
            className="h-9 bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            空闲时应用
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => restartBackendNow({ manual: true })}
            disabled={!canApplyNow}
            title={
              hasChanges
                ? "请先保存当前配置，再立即应用。"
                : "立即重启后台并加载当前配置。"
            }
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
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form
          id="internagents-config-form"
          onSubmit={(event) => {
            event.preventDefault();
            void applyWhenIdle();
          }}
          className="space-y-5"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              模型和授权模式需要应用后生效；界面风格会立即生效。
            </span>
            {requiresRestart && !hasChanges && (
              <span className="text-amber-700">有配置等待应用。</span>
            )}
            {restartResult && (
              <span
                className={cn(
                  restartResult.status === "restarted"
                    ? "text-green-700"
                    : "text-red-700"
                )}
              >
                {restartResult.message}
              </span>
            )}
            {backendStatus && (
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

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">模型</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  默认使用上海人工智能实验室研发的集思系统，为每个问题自动选择最佳模型进行回答。
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在读取配置...
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                <div className="space-y-2">
                  <Label htmlFor="openrouter-key">OpenRouter API Key</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="openrouter-key"
                      type="password"
                      value={apiKeyDraft}
                      onChange={(event) => setApiKeyDraft(event.target.value)}
                      placeholder={
                        config.openrouterApiKeySet
                          ? config.openrouterApiKeyPreview
                          : "粘贴 sk-or-v1-..."
                      }
                      autoComplete="off"
                      className="pl-9"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    留空保存时会保留已有 key，不会覆盖。
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="openrouter-model">模型</Label>
                  <Input
                    id="openrouter-model"
                    value={config.model}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder="deepseek/deepseek-chat"
                  />
                  <div className="flex flex-wrap gap-2">
                    {MODEL_PRESETS.map((model) => (
                      <Button
                        key={model}
                        type="button"
                        size="sm"
                        variant={config.model === model ? "default" : "outline"}
                        onClick={() =>
                          setConfig((current) => ({
                            ...current,
                            model,
                          }))
                        }
                      >
                        {model}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">授权模式</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  授权模式决定 agent 调用工具时是否需要你手动确认。
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {AUTHORIZATION_OPTIONS.map((option) => {
                const active = config.authorizationMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setConfig((current) => ({
                        ...current,
                        authorizationMode: option.id,
                      }))
                    }
                    className={cn(
                      "flex min-h-44 flex-col rounded-lg border bg-background p-4 text-left transition hover:border-primary/50 hover:bg-accent",
                      active
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-border"
                    )}
                  >
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-[#2F6868] dark:text-teal-300">
                        <Shield className="h-4 w-4" />
                      </div>
                      {option.badge && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          {option.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-semibold">{option.title}</div>
                    <div className="mt-2 text-sm text-foreground">
                      {option.description}
                    </div>
                    <div className="mt-3 text-xs leading-5 text-muted-foreground">
                      {option.detail}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                {themeMode === "dark" ? (
                  <Moon className="h-5 w-5" />
                ) : (
                  <Sun className="h-5 w-5" />
                )}
              </div>
              <div>
                <h2 className="text-base font-semibold">界面风格</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  选择白天或黑夜模式。这个设置会立即应用在当前浏览器。
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {THEME_OPTIONS.map((option) => {
                const active = themeMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => updateTheme(option.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border bg-background p-4 text-left transition hover:border-primary/50 hover:bg-accent",
                      active
                        ? "border-primary ring-2 ring-primary/20"
                        : "border-border"
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-[#2F6868] dark:text-teal-300">
                      {option.id === "dark" ? (
                        <Moon className="h-4 w-4" />
                      ) : (
                        <Sun className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">
                        {option.title}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {option.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="flex justify-end text-xs text-muted-foreground">
            <div className="truncate">配置文件：{config.configPath || "-"}</div>
          </div>
        </form>
      </main>
    </div>
  );
}
