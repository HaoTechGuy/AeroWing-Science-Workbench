"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Cpu,
  FolderOpen,
  Loader2,
  Mail,
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
import { ArchivedThreadsCard } from "@/app/config/components/ArchivedThreadsCard";
import { SkillsConfigCard } from "@/app/config/components/SkillsConfigCard";

type AuthorizationMode = "auto" | "write" | "all";
type ModelSelectionMode = "auto" | "manual";
type ModelProvider = "gateway";
type OnboardingMissing = "gatewayEmail" | "workspacePath";

interface ConfigResponse {
  configPath: string;
  envPath: string;
  resourcesPath: string;
  workspacePath: string;
  workspaceResolvedPath: string;
  modelProvider: ModelProvider;
  model: string;
  modelSelectionMode: ModelSelectionMode;
  autoModel: string;
  effectiveModel: string;
  gatewayEmail: string;
  gatewayBaseUrl: string;
  gatewayApiBaseUrl: string;
  gatewayModel: string;
  gatewayApiKeySet: boolean;
  gatewayApiKeyPreview: string;
  gatewayCreditRmb: string;
  gatewayRemainingRmb: string;
  authorizationMode: AuthorizationMode;
  desktopMode: boolean;
  needsOnboarding: boolean;
  missing: OnboardingMissing[];
  workspaceError?: string;
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
  resourcesPath: "",
  workspacePath: ".",
  workspaceResolvedPath: "",
  modelProvider: "gateway",
  model: "deepseek/deepseek-v4-flash",
  modelSelectionMode: "auto",
  autoModel: "jisi/auto",
  effectiveModel: "jisi/auto",
  gatewayEmail: "",
  gatewayBaseUrl: "https://jisi.example.com",
  gatewayApiBaseUrl: "https://jisi.example.com/v1",
  gatewayModel: "deepseek-v4-flash",
  gatewayApiKeySet: false,
  gatewayApiKeyPreview: "",
  gatewayCreditRmb: "",
  gatewayRemainingRmb: "",
  authorizationMode: "auto",
  desktopMode: false,
  needsOnboarding: false,
  missing: [],
};

const MODEL_SELECTION_OPTIONS: Array<{
  id: ModelSelectionMode;
  title: string;
  badge?: string;
  description: string;
}> = [
  {
    id: "auto",
    title: "自动模型选择",
    badge: "推荐",
    description: "由集思根据问题自动选择合适模型。",
  },
  {
    id: "manual",
    title: "手动指定模型",
    description: "固定使用下方选择或填写的模型。",
  },
];

const JISI_MODEL_OPTIONS: Array<{
  id: string;
  title: string;
  vendor: string;
  description: string;
  badge?: string;
}> = [
  {
    id: "deepseek/deepseek-v4-flash",
    title: "DeepSeek V4 Flash",
    vendor: "DeepSeek",
    description: "默认推荐，速度优先，适合日常对话、代码协作和轻量分析。",
    badge: "默认",
  },
  {
    id: "deepseek/deepseek-r1",
    title: "DeepSeek R1",
    vendor: "DeepSeek",
    description: "推理能力更强，适合复杂规划、数学推导和多步骤分析。",
  },
  {
    id: "deepseek/deepseek-chat",
    title: "DeepSeek Chat",
    vendor: "DeepSeek",
    description: "通用中文对话和代码任务，输出稳定，成本友好。",
  },
  {
    id: "qwen/Qwen3-235B",
    title: "通义千问 Qwen3 235B",
    vendor: "Qwen",
    description: "大参数通用模型，适合中文写作、知识问答和研究整理。",
  },
  {
    id: "moonshot/kimi-k2.5",
    title: "Kimi K2.5",
    vendor: "Moonshot",
    description: "长文本理解和中文材料处理友好，适合文档阅读场景。",
  },
  {
    id: "shlab/intern-s1-pro",
    title: "Intern S1 Pro",
    vendor: "SH-Lab",
    description: "上海人工智能实验室模型，适合科研分析和科学问答。",
  },
  {
    id: "zhipu/glm-5",
    title: "GLM-5",
    vendor: "Zhipu",
    description: "国产通用模型，适合中文知识问答和结构化生成。",
  },
  {
    id: "minimax/minimax2.5",
    title: "MiniMax 2.5",
    vendor: "MiniMax",
    description: "轻量通用模型，适合快速对话、摘要和改写任务。",
  },
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

const ONBOARDING_MISSING_LABELS: Record<OnboardingMissing, string> = {
  gatewayEmail: "集思绑定邮箱",
  workspacePath: "本机工作区",
};

export default function ConfigPage() {
  const [config, setConfig] = useState<ConfigResponse>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] =
    useState<ConfigResponse>(DEFAULT_CONFIG);
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [requiresRestart, setRequiresRestart] = useState(false);
  const [onboardingRequested, setOnboardingRequested] = useState(false);
  const [backendStatus, setBackendStatus] =
    useState<BackendStatusResult | null>(null);
  const [restartResult, setRestartResult] =
    useState<BackendRestartResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actionBusy = loading || saving || restarting;
  const isBusy = actionBusy || checkingStatus;
  const hasChanges = useMemo(() => {
    return (
      config.gatewayEmail !== savedConfig.gatewayEmail ||
      config.gatewayBaseUrl !== savedConfig.gatewayBaseUrl ||
      config.model !== savedConfig.model ||
      config.modelSelectionMode !== savedConfig.modelSelectionMode ||
      config.authorizationMode !== savedConfig.authorizationMode ||
      config.workspacePath !== savedConfig.workspacePath
    );
  }, [
    config.authorizationMode,
    config.gatewayBaseUrl,
    config.gatewayEmail,
    config.model,
    config.modelSelectionMode,
    config.workspacePath,
    savedConfig.authorizationMode,
    savedConfig.gatewayBaseUrl,
    savedConfig.gatewayEmail,
    savedConfig.model,
    savedConfig.modelSelectionMode,
    savedConfig.workspacePath,
  ]);
  const selectedJisiModel = useMemo(
    () => JISI_MODEL_OPTIONS.find((option) => option.id === config.model),
    [config.model]
  );
  const restartSensitiveChanged = useMemo(() => {
    return (
      config.gatewayEmail !== savedConfig.gatewayEmail ||
      config.gatewayBaseUrl !== savedConfig.gatewayBaseUrl ||
      config.model !== savedConfig.model ||
      config.modelSelectionMode !== savedConfig.modelSelectionMode ||
      config.authorizationMode !== savedConfig.authorizationMode
    );
  }, [
    config.authorizationMode,
    config.gatewayBaseUrl,
    config.gatewayEmail,
    config.model,
    config.modelSelectionMode,
    savedConfig.authorizationMode,
    savedConfig.gatewayBaseUrl,
    savedConfig.gatewayEmail,
    savedConfig.model,
    savedConfig.modelSelectionMode,
  ]);
  const canApplyWhenIdle = !isBusy;
  const canApplyNow = !isBusy;
  const onboardingMode = onboardingRequested || config.needsOnboarding;
  const onboardingMissingLabels = config.missing
    .map((key) => ONBOARDING_MISSING_LABELS[key])
    .filter(Boolean);
  const backendStatusMessage = backendStatus?.message.trim();
  const showBackendStatus = Boolean(backendStatusMessage) && !restartResult;

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "配置读取失败");
      }
      const nextConfig = {
        ...DEFAULT_CONFIG,
        ...payload,
        modelProvider: "gateway",
      } as ConfigResponse;
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

  async function saveConfig(
    options: { scheduleIdle?: boolean } = {}
  ): Promise<{ saved: boolean; needsRestart: boolean }> {
    const scheduleIdle = options.scheduleIdle ?? true;
    const needsRestart = restartSensitiveChanged;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          modelProvider: "gateway",
          modelSelectionMode: config.modelSelectionMode,
          gatewayEmail: config.gatewayEmail.trim() || undefined,
          gatewayBaseUrl: config.gatewayBaseUrl.trim() || undefined,
          authorizationMode: config.authorizationMode,
          workspacePath: config.workspacePath,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "配置保存失败");
      }
      const nextConfig = payload as ConfigResponse;
      setConfig(nextConfig);
      setSavedConfig(nextConfig);
      setRequiresRestart(needsRestart);
      setBackendStatus(null);
      setRestartResult(null);
      setAutoRestart(scheduleIdle && needsRestart);
      toast.success(
        needsRestart
          ? scheduleIdle
            ? "配置已保存，将在空闲时自动应用"
            : "配置已保存"
          : "工作区已保存，已热切换"
      );
      return { saved: true, needsRestart };
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "配置保存失败";
      setError(message);
      toast.error(message);
      return { saved: false, needsRestart: false };
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

  async function restartBackendNow({
    manual,
    redirectHome = false,
  }: {
    manual: boolean;
    redirectHome?: boolean;
  }): Promise<boolean> {
    if (manual) {
      const status = await checkBackendStatus();
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
        return false;
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
      setBackendStatus(null);
      toast.success(restart.message || "配置已应用");
      if (redirectHome) {
        window.location.href = "/?assistantId=agent_local";
      }
      return true;
    } catch (restartError) {
      const message =
        restartError instanceof Error ? restartError.message : "配置应用失败";
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setRestarting(false);
    }
  }

  async function applyWhenIdle() {
    await saveConfig({ scheduleIdle: true });
  }

  async function applyNow() {
    const result = await saveConfig({ scheduleIdle: false });
    if (result.saved && result.needsRestart) {
      await restartBackendNow({ manual: true });
    }
  }

  async function finishOnboarding() {
    const result = await saveConfig({ scheduleIdle: false });
    if (!result.saved) {
      return;
    }
    if (result.needsRestart) {
      await restartBackendNow({ manual: false, redirectHome: true });
      return;
    }
    window.location.href = "/?assistantId=agent_local";
  }

  function updateTheme(nextTheme: ThemeMode) {
    setThemeMode(nextTheme);
    applyTheme(nextTheme);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setOnboardingRequested(params.get("onboarding") === "1");
    }
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
    <div className="min-h-[calc(100vh-var(--app-footer-height))] bg-background text-foreground">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-4">
          {!onboardingMode && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 px-2"
            >
              <Link href="/?assistantId=agent_local">
                <ArrowLeft className="h-4 w-4" />
                工作台
              </Link>
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {onboardingMode ? "首次设置 InternAgents" : "配置"}
            </h1>
            <div className="truncate text-xs text-muted-foreground">
              {onboardingMode
                ? "绑定集思、选择工作区并设置授权后进入工作台"
                : "模型、工作区、授权模式、技能和界面风格"}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onboardingMode ? (
            <Button
              size="sm"
              onClick={() => void finishOnboarding()}
              disabled={!canApplyNow}
              className="h-9 bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
            >
              {saving || restarting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ServerCog className="h-4 w-4" />
              )}
              完成设置
            </Button>
          ) : (
            <>
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
                onClick={() => void applyNow()}
                disabled={!canApplyNow}
                title="保存配置并立即应用。"
                className="h-9"
              >
                {restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ServerCog className="h-4 w-4" />
                )}
                立即应用
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}
        {onboardingMode && (
          <div className="mb-4 rounded-md border border-[#BFD9D4] bg-[#F1F7F5] px-4 py-3 text-sm text-[#24595A] dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-100">
            <div className="font-medium">欢迎使用 InternAgents 桌面版</div>
            {onboardingMissingLabels.length > 0 && (
              <div className="mt-1 text-xs">
                还需要设置：{onboardingMissingLabels.join("、")}
              </div>
            )}
          </div>
        )}
        {config.workspaceError && !loading && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            {config.workspaceError}
          </div>
        )}

        <form
          id="internagents-config-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (onboardingMode) {
              void finishOnboarding();
            } else {
              void applyWhenIdle();
            }
          }}
          className="space-y-5"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              模型和授权模式需要重启后端后生效；技能在技能卡片中单独应用；工作区和界面风格会立即生效。
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

          <section
            className="rounded-lg border border-border bg-card p-5 shadow-sm"
            data-tour="config-model"
          >
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">模型</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  使用集思统一管理 key、额度和模型服务。
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在读取配置...
              </div>
            ) : (
              <div className="rounded-md border border-border bg-background p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label htmlFor="gateway-email">集思绑定邮箱</Label>
                    <div className="mt-1 text-xs text-muted-foreground">
                      保存时会用这个邮箱领取或复用集思 key，并写入本机 `.env`。
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-1 text-xs font-medium",
                      config.gatewayApiKeySet
                        ? "bg-[#E8F3F1] text-[#2F6868] dark:bg-teal-950/50 dark:text-teal-200"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {config.gatewayApiKeySet
                      ? config.gatewayApiKeyPreview || "已绑定"
                      : "未绑定"}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      邮箱
                    </div>
                    <Input
                      id="gateway-email"
                      type="email"
                      autoComplete="email"
                      value={config.gatewayEmail}
                      disabled={loading}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          gatewayEmail: event.target.value,
                        }))
                      }
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <ServerCog className="h-3.5 w-3.5" />
                      集思地址
                    </div>
                    <Input
                      id="gateway-base-url"
                      value={config.gatewayBaseUrl}
                      disabled={loading}
                      onChange={(event) =>
                        setConfig((current) => ({
                          ...current,
                          gatewayBaseUrl: event.target.value,
                        }))
                      }
                      placeholder="https://jisi.example.com"
                    />
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <Label>模型选择</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {MODEL_SELECTION_OPTIONS.map((option) => {
                      const active = config.modelSelectionMode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            setConfig((current) => ({
                              ...current,
                              modelSelectionMode: option.id,
                            }))
                          }
                          className={cn(
                            "rounded-md border bg-background px-3 py-2.5 text-left transition hover:border-primary/60 hover:bg-accent",
                            active
                              ? "border-primary ring-2 ring-primary/20"
                              : "border-border"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold">
                              {option.title}
                            </div>
                            {option.badge && (
                              <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-4 text-primary-foreground">
                                {option.badge}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {option.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {config.modelSelectionMode === "auto" ? (
                  <div className="mt-3 rounded-md bg-[#F1F7F5] px-3 py-2 text-sm text-[#2F6868] dark:bg-teal-950/40 dark:text-teal-100">
                    已启用自动模型选择。集思会根据问题自动匹配合适模型。
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <Label>集思国产模型</Label>
                          <div className="mt-1 text-xs text-muted-foreground">
                            选择集思系统中可用的国产模型；也可以在下方填写模型 ID。
                          </div>
                        </div>
                        {selectedJisiModel ? (
                          <span className="rounded-full bg-[#E8F3F1] px-2 py-1 text-xs font-medium text-[#2F6868] dark:bg-teal-950/50 dark:text-teal-200">
                            当前：{selectedJisiModel.title}
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                            当前：自定义模型
                          </span>
                        )}
                      </div>

                      <div className="grid gap-1.5 md:grid-cols-2">
                        {JISI_MODEL_OPTIONS.map((option) => {
                          const active = config.model === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() =>
                                setConfig((current) => ({
                                  ...current,
                                  model: option.id,
                                }))
                              }
                              className={cn(
                                "flex min-h-20 flex-col rounded-md border bg-background px-3 py-2.5 text-left transition hover:border-primary/60 hover:bg-accent",
                                active
                                  ? "border-primary ring-2 ring-primary/20"
                                  : "border-border"
                              )}
                            >
                              <div className="flex min-w-0 items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="truncate text-[13px] font-semibold leading-5">
                                    {option.title}
                                  </div>
                                  <div className="shrink-0 text-[11px] text-muted-foreground">
                                    {option.vendor}
                                  </div>
                                </div>
                                {option.badge && (
                                  <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-4 text-primary-foreground">
                                    {option.badge}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 line-clamp-1 text-xs leading-5 text-muted-foreground">
                                {option.description}
                              </div>
                              <div className="mt-1 truncate font-mono text-[11px] leading-4 text-muted-foreground">
                                {option.id}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="jisi-model">填写模型 ID</Label>
                      <Input
                        id="jisi-model"
                        value={config.model}
                        onChange={(event) =>
                          setConfig((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
                        }
                        placeholder="deepseek/deepseek-v4-flash"
                      />
                      <div className="text-xs text-muted-foreground">
                        可以直接粘贴集思支持的模型 ID。
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-4 grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
                  <div className="min-w-0 truncate">
                    模型：
                    {config.modelSelectionMode === "auto"
                      ? config.autoModel || "jisi/auto"
                      : config.model || "deepseek/deepseek-v4-flash"}
                  </div>
                  <div className="min-w-0 truncate">
                    API：{config.gatewayApiBaseUrl || "-"}
                  </div>
                  <div className="min-w-0 truncate">
                    额度：
                    {config.gatewayRemainingRmb
                      ? `剩余 ¥${config.gatewayRemainingRmb}`
                      : config.gatewayCreditRmb
                      ? `总额 ¥${config.gatewayCreditRmb}`
                      : "绑定后显示"}
                  </div>
                </div>

                <div className="mt-3 rounded-md bg-[#F1F7F5] px-3 py-2 text-sm text-[#2F6868] dark:bg-teal-950/40 dark:text-teal-100">
                  集思会使用 OpenAI-compatible 接口请求模型服务，真实
                  DeepSeek key 保留在服务端。
                </div>
              </div>
            )}
          </section>

          <section
            className="rounded-lg border border-border bg-card p-5 shadow-sm"
            data-tour="config-workspace"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                <FolderOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">工作区</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  选择本机资源的文件夹；文件浏览和 Agent 命令都会以它为根目录。
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="workspace-path">本机工作区路径</Label>
                <Input
                  id="workspace-path"
                  value={config.workspacePath}
                  disabled={loading}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      workspacePath: event.target.value,
                    }))
                  }
                  placeholder="/Users/you/Projects/example"
                />
              </div>
              <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                <div className="min-w-0 truncate">
                  当前解析：{config.workspaceResolvedPath || "-"}
                </div>
                <div className="min-w-0 truncate">
                  资源配置：{config.resourcesPath || "-"}
                </div>
              </div>
            </div>
          </section>

          <section
            className="rounded-lg border border-border bg-card p-5 shadow-sm"
            data-tour="config-authorization"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold">授权模式</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  授权模式决定 InternAgent 调用工具时是否需要你手动确认。
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

          {!onboardingMode && <SkillsConfigCard />}

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

          {!onboardingMode && <ArchivedThreadsCard />}

          <div className="flex justify-end text-xs text-muted-foreground">
            <div className="truncate">配置文件：{config.configPath || "-"}</div>
          </div>
        </form>
      </main>
    </div>
  );
}
