"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Cpu,
  FolderOpen,
  KeyRound,
  Loader2,
  Mail,
  Moon,
  Save,
  ServerCog,
  Shield,
  ShieldCheck,
  Sun,
  Ticket,
  User,
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
import {
  SkillsConfigCard,
  type SkillsConfigCardHandle,
  type SkillsConfigCardState,
} from "@/app/config/components/SkillsConfigCard";
import { workbenchHrefFromSearchParams } from "@/app/utils/navigationContext";

type AuthorizationMode = "auto" | "write" | "all";
type ModelSelectionMode = "auto" | "manual";
type ModelProvider = "gateway" | "openrouter";
type OnboardingMissing = "gatewayEmail" | "openrouterApiKey";

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
  gatewayUsername: string;
  gatewayInviteCode: string;
  gatewayModel: string;
  gatewayApiKeySet: boolean;
  gatewayApiKeyPreview: string;
  gatewayCreditRmb: string;
  gatewayRemainingRmb: string;
  openrouterModel: string;
  openrouterApiKey: string;
  openrouterApiKeySet: boolean;
  openrouterApiKeyPreview: string;
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

interface GatewayModelOption {
  id: string;
  title: string;
  provider: string;
  description: string;
  upstreamModel?: string;
  upstreamProvider?: string;
  inputPriceRmbPer1m?: number;
  outputPriceRmbPer1m?: number;
  isDefault?: boolean;
}

interface GatewayModelsPayload {
  defaultModel?: unknown;
  models?: unknown;
  error?: unknown;
}

const DEFAULT_CONFIG: ConfigResponse = {
  configPath: "",
  envPath: "",
  resourcesPath: "",
  workspacePath: ".",
  workspaceResolvedPath: "",
  modelProvider: "gateway",
  model: "deepseek-v4-flash",
  modelSelectionMode: "manual",
  autoModel: "jisi/auto",
  effectiveModel: "deepseek-v4-flash",
  gatewayEmail: "",
  gatewayUsername: "",
  gatewayInviteCode: "",
  gatewayModel: "deepseek-v4-flash",
  gatewayApiKeySet: false,
  gatewayApiKeyPreview: "",
  gatewayCreditRmb: "",
  gatewayRemainingRmb: "",
  openrouterModel: "deepseek-v4-flash",
  openrouterApiKey: "",
  openrouterApiKeySet: false,
  openrouterApiKeyPreview: "",
  authorizationMode: "auto",
  desktopMode: false,
  needsOnboarding: false,
  missing: [],
};

const MODEL_PROVIDER_OPTIONS: Array<{
  id: ModelProvider;
  title: string;
  subtitle?: string;
  badge?: string;
  description: string;
}> = [
  {
    id: "gateway",
    title: "集思",
    subtitle: "上海人工智能实验室研发",
    badge: "推荐",
    description: "免费，提供国产模型支持。",
  },
  {
    id: "openrouter",
    title: "OpenRouter",
    subtitle: "商业收费",
    description: "提供更丰富模型支持，需要设置代理。",
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
    description: "常用权限直接放行，不弹出审批。",
    detail: "适合只在自己电脑上使用、并且信任当前项目和模型的开发场景。",
  },
  {
    id: "write",
    title: "写入需审批",
    description: "读取权限直接放行，写入权限需确认。",
    detail: "适合日常使用，本地文件变更会先停下来等你确认。",
  },
  {
    id: "all",
    title: "全部需审批",
    description: "所有权限都需要确认后再继续。",
    detail: "最保守，适合敏感项目或希望逐步确认的场景。",
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

function normalizeGatewayModelOption(value: unknown): GatewayModelOption | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id.trim()) {
    return null;
  }
  const id = record.id.trim();
  return {
    id,
    title:
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : id,
    provider:
      typeof record.provider === "string" && record.provider.trim()
        ? record.provider.trim()
        : "集思",
    description:
      typeof record.description === "string" && record.description.trim()
        ? record.description.trim()
        : "集思网关可用模型。",
    upstreamModel:
      typeof record.upstreamModel === "string" ? record.upstreamModel : undefined,
    upstreamProvider:
      typeof record.upstreamProvider === "string"
        ? record.upstreamProvider
        : undefined,
    inputPriceRmbPer1m:
      typeof record.inputPriceRmbPer1m === "number"
        ? record.inputPriceRmbPer1m
        : undefined,
    outputPriceRmbPer1m:
      typeof record.outputPriceRmbPer1m === "number"
        ? record.outputPriceRmbPer1m
        : undefined,
    isDefault: record.isDefault === true,
  };
}

async function fetchGatewayModels(signal: AbortSignal): Promise<GatewayModelOption[]> {
  const response = await fetch("/api/gateway/models", {
    cache: "no-store",
    signal,
  });
  const payload = (await response.json().catch(() => ({}))) as GatewayModelsPayload;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "集思模型列表读取失败。"
    );
  }
  const models = Array.isArray(payload.models)
    ? payload.models
        .map(normalizeGatewayModelOption)
        .filter((model): model is GatewayModelOption => Boolean(model))
    : [];
  if (models.length === 0) {
    throw new Error("集思未返回可用模型。");
  }
  return models;
}

function priceSummary(option: GatewayModelOption) {
  if (
    typeof option.inputPriceRmbPer1m !== "number" ||
    typeof option.outputPriceRmbPer1m !== "number"
  ) {
    return "";
  }
  return `¥${option.inputPriceRmbPer1m}/百万输入 · ¥${option.outputPriceRmbPer1m}/百万输出`;
}

function ConfigPageContent() {
  const searchParams = useSearchParams();
  const skillsConfigRef = useRef<SkillsConfigCardHandle>(null);
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
  const [gatewayModelOptions, setGatewayModelOptions] = useState<
    GatewayModelOption[]
  >([]);
  const [gatewayModelsLoading, setGatewayModelsLoading] = useState(false);
  const [gatewayModelsError, setGatewayModelsError] = useState<string | null>(
    null
  );
  const [skillsState, setSkillsState] = useState<SkillsConfigCardState>({
    hasChanges: false,
    isBusy: false,
    requiresRestart: false,
  });

  const actionBusy = loading || saving || restarting;
  const isBusy = actionBusy || checkingStatus || skillsState.isBusy;
  const hasChanges = useMemo(() => {
    return (
      config.modelProvider !== savedConfig.modelProvider ||
      config.gatewayEmail !== savedConfig.gatewayEmail ||
      config.gatewayUsername !== savedConfig.gatewayUsername ||
      config.gatewayInviteCode !== savedConfig.gatewayInviteCode ||
      config.openrouterApiKey.trim() !== "" ||
      config.model !== savedConfig.model ||
      config.modelSelectionMode !== savedConfig.modelSelectionMode ||
      config.authorizationMode !== savedConfig.authorizationMode ||
      config.workspacePath !== savedConfig.workspacePath
    );
  }, [
    config.authorizationMode,
    config.gatewayEmail,
    config.gatewayInviteCode,
    config.gatewayUsername,
    config.model,
    config.modelProvider,
    config.modelSelectionMode,
    config.openrouterApiKey,
    config.workspacePath,
    savedConfig.authorizationMode,
    savedConfig.gatewayEmail,
    savedConfig.gatewayInviteCode,
    savedConfig.gatewayUsername,
    savedConfig.model,
    savedConfig.modelProvider,
    savedConfig.modelSelectionMode,
    savedConfig.workspacePath,
  ]);
  const selectedJisiModel = useMemo(
    () => gatewayModelOptions.find((option) => option.id === config.model),
    [config.model, gatewayModelOptions]
  );
  const restartSensitiveChanged = useMemo(() => {
    return (
      config.modelProvider !== savedConfig.modelProvider ||
      config.gatewayEmail !== savedConfig.gatewayEmail ||
      config.gatewayUsername !== savedConfig.gatewayUsername ||
      config.gatewayInviteCode !== savedConfig.gatewayInviteCode ||
      config.openrouterApiKey.trim() !== "" ||
      config.model !== savedConfig.model ||
      config.modelSelectionMode !== savedConfig.modelSelectionMode ||
      config.authorizationMode !== savedConfig.authorizationMode
    );
  }, [
    config.authorizationMode,
    config.gatewayEmail,
    config.gatewayInviteCode,
    config.gatewayUsername,
    config.model,
    config.modelProvider,
    config.modelSelectionMode,
    config.openrouterApiKey,
    savedConfig.authorizationMode,
    savedConfig.gatewayEmail,
    savedConfig.gatewayInviteCode,
    savedConfig.gatewayUsername,
    savedConfig.model,
    savedConfig.modelProvider,
    savedConfig.modelSelectionMode,
  ]);
  const hasAnyChanges = hasChanges || skillsState.hasChanges;
  const hasPendingRestart = requiresRestart || skillsState.requiresRestart;
  const canApplyWhenIdle = !isBusy;
  const canApplyNow = !isBusy;
  const onboardingMode = onboardingRequested || config.needsOnboarding;
  const backendStatusMessage = backendStatus?.message.trim();
  const showBackendStatus = Boolean(backendStatusMessage) && !restartResult;
  const workbenchHref = useMemo(
    () => workbenchHrefFromSearchParams(searchParams),
    [searchParams]
  );

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
        openrouterApiKey: "",
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
    options: { scheduleIdle?: boolean; silent?: boolean } = {}
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
          model:
            config.modelProvider === "openrouter"
              ? config.openrouterModel || "deepseek-v4-flash"
              : config.model || "deepseek-v4-flash",
          modelProvider: config.modelProvider,
          modelSelectionMode: "manual",
          gatewayEmail:
            config.modelProvider === "gateway"
              ? config.gatewayEmail.trim() || undefined
              : undefined,
          gatewayUsername:
            config.modelProvider === "gateway"
              ? config.gatewayUsername.trim() || undefined
              : undefined,
          gatewayInviteCode:
            config.modelProvider === "gateway"
              ? config.gatewayInviteCode.trim() || undefined
              : undefined,
          openrouterApiKey:
            config.modelProvider === "openrouter"
              ? config.openrouterApiKey.trim() || undefined
              : undefined,
          authorizationMode: config.authorizationMode,
          workspacePath: onboardingMode ? undefined : config.workspacePath,
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
      if (!options.silent) {
        toast.success(
          needsRestart
            ? scheduleIdle
              ? "配置已保存，将在空闲时自动应用"
              : "配置已保存"
            : "工作区已保存，已热切换"
        );
      }
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
      skillsConfigRef.current?.markApplied();
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

  async function saveUnifiedConfig(): Promise<{
    saved: boolean;
    needsRestart: boolean;
  }> {
    let configResult = {
      saved: true,
      needsRestart: requiresRestart,
    };
    if (hasChanges) {
      configResult = await saveConfig({ scheduleIdle: false, silent: true });
      if (!configResult.saved) {
        return { saved: false, needsRestart: false };
      }
    }

    let skillsResult = {
      saved: true,
      needsRestart: skillsState.requiresRestart,
    };
    if (skillsState.hasChanges) {
      const skillsConfig = skillsConfigRef.current;
      if (!skillsConfig) {
        toast.error("技能配置尚未加载完成。");
        return { saved: false, needsRestart: false };
      }
      skillsResult = await skillsConfig.save({ silent: true });
      if (!skillsResult.saved) {
        return { saved: false, needsRestart: false };
      }
    }

    return {
      saved: true,
      needsRestart:
        configResult.needsRestart ||
        skillsResult.needsRestart ||
        requiresRestart ||
        skillsState.requiresRestart,
    };
  }

  async function applyWhenIdle() {
    const result = await saveUnifiedConfig();
    if (!result.saved) {
      return;
    }

    if (result.needsRestart) {
      setAutoRestart(true);
      toast.success("配置已保存，将在空闲时自动应用");
      return;
    }

    toast.success("配置已保存");
  }

  async function applyNow() {
    const result = await saveUnifiedConfig();
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

  function updateModelProvider(modelProvider: ModelProvider) {
    setConfig((current) => ({
      ...current,
      modelProvider,
      modelSelectionMode: "manual",
      model: "deepseek-v4-flash",
      openrouterModel: "deepseek-v4-flash",
    }));
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
    if (
      !autoRestart ||
      !hasPendingRestart ||
      hasAnyChanges ||
      actionBusy ||
      skillsState.isBusy
    ) {
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
  }, [
    autoRestart,
    hasPendingRestart,
    hasAnyChanges,
    actionBusy,
    skillsState.isBusy,
  ]);

  useEffect(() => {
    if (loading || onboardingMode || config.modelProvider !== "gateway") {
      setGatewayModelOptions([]);
      setGatewayModelsLoading(false);
      setGatewayModelsError(null);
      return;
    }

    const controller = new AbortController();
    const debounce = window.setTimeout(() => {
      setGatewayModelsLoading(true);
      setGatewayModelsError(null);
      void fetchGatewayModels(controller.signal)
        .then((models) => {
          if (!controller.signal.aborted) {
            setGatewayModelOptions(models);
          }
        })
        .catch((modelError) => {
          if (!controller.signal.aborted) {
            const message =
              modelError instanceof Error
                ? modelError.message
                : "集思模型列表读取失败。";
            setGatewayModelOptions([]);
            setGatewayModelsError(message);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setGatewayModelsLoading(false);
          }
        });
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(debounce);
    };
  }, [config.modelProvider, loading, onboardingMode]);

  return (
    <div className="min-h-[calc(100vh-var(--app-footer-height))] bg-background text-foreground">
      {!onboardingMode && (
        <header
          className="flex h-16 items-center justify-between border-b border-border px-6"
          data-tour="config-header"
        >
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
              <h1 className="truncate text-xl font-semibold">配置</h1>
              <div className="truncate text-xs text-muted-foreground">
                模型、工作区、授权模式、技能和界面风格
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <>
              <Button
                size="sm"
                onClick={applyWhenIdle}
                disabled={!canApplyWhenIdle}
                title={
                  hasAnyChanges
                    ? "保存当前配置和技能选择，并在后台空闲时自动应用。"
                    : "后台空闲时自动重启并加载当前配置和技能。"
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
                title="保存当前配置和技能选择并立即应用。"
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
          </div>
        </header>
      )}

      <main
        className={cn(
          "mx-auto w-full px-6 py-6",
          onboardingMode
            ? "flex min-h-[calc(100vh-var(--app-footer-height))] max-w-lg flex-col justify-center"
            : "max-w-5xl"
        )}
      >
        {onboardingMode && (
          <div className="mb-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              首次设置 InternAgents
            </h1>
            <div className="mt-2 text-sm text-muted-foreground">
              默认使用 deepseek-v4-flash；进入工作台后可在配置页更改。
            </div>
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}
        {config.workspaceError && !loading && !onboardingMode && (
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
          className={cn(onboardingMode ? "w-full space-y-4" : "space-y-5")}
        >
          {!onboardingMode && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                模型、授权模式和技能需要重启后端后生效；工作区和界面风格会立即生效。
              </span>
              {hasPendingRestart && !hasAnyChanges && (
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
          )}

          <section
            className={cn(
              "rounded-lg border border-border bg-card shadow-sm",
              onboardingMode ? "p-4" : "p-5"
            )}
            data-tour="config-model"
          >
            {!onboardingMode && (
              <div className="mb-5 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                  <Cpu className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">模型</h2>
                  <div className="mt-1 text-sm text-muted-foreground">
                    使用集思或 OpenRouter 管理模型服务。
                  </div>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                正在读取配置...
              </div>
            ) : (
              <div
                className={cn(
                  onboardingMode ? "space-y-4" : "space-y-5"
                )}
              >
                <div className="space-y-3">
                  {!onboardingMode && <Label>模型服务</Label>}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {MODEL_PROVIDER_OPTIONS.map((option) => {
                      const active = config.modelProvider === option.id;
                      const ProviderIcon =
                        option.id === "gateway" ? ServerCog : KeyRound;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => updateModelProvider(option.id)}
                          className={cn(
                            "flex min-h-28 flex-col rounded-lg border bg-background p-3 text-left transition hover:border-primary/50 hover:bg-accent",
                            active
                              ? "border-primary ring-2 ring-primary/20"
                              : "border-border"
                          )}
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-[#2F6868] dark:text-teal-300">
                              <ProviderIcon className="h-4 w-4" />
                            </div>
                            {option.badge && (
                              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                                {option.badge}
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-semibold">
                            {option.title}
                          </div>
                          <div className="mt-1.5 text-sm text-foreground">
                            {option.description}
                          </div>
                          {option.subtitle && (
                            <div className="mt-2 text-xs leading-5 text-muted-foreground">
                              {option.subtitle}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {!onboardingMode && (
                  <div className="text-xs leading-5 text-muted-foreground">
                    默认模型：deepseek-v4-flash
                  </div>
                )}

                {config.modelProvider === "gateway" ? (
                  <>
                    {!onboardingMode && (
                      <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Label htmlFor="gateway-email">
                            集思账号绑定
                          </Label>
                          <div className="mt-1 text-xs text-muted-foreground">
                            保存时会校验邮箱、用户名和邀请码，并完成账号绑定。
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
                          {config.gatewayApiKeySet ? "已绑定" : "未绑定"}
                        </span>
                      </div>
                    )}

                    <div
                      className={cn(
                        "grid md:grid-cols-3",
                        onboardingMode ? "mt-4 gap-3" : "gap-4"
                      )}
                    >
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
                          <User className="h-3.5 w-3.5" />
                          用户名
                        </div>
                        <Input
                          id="gateway-username"
                          type="text"
                          autoComplete="name"
                          value={config.gatewayUsername}
                          disabled={loading}
                          onChange={(event) =>
                            setConfig((current) => ({
                              ...current,
                              gatewayUsername: event.target.value,
                            }))
                          }
                          placeholder="你的用户名"
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <Ticket className="h-3.5 w-3.5" />
                          邀请码
                        </div>
                        <Input
                          id="gateway-invite-code"
                          type="text"
                          autoComplete="off"
                          value={config.gatewayInviteCode}
                          disabled={loading}
                          onChange={(event) =>
                            setConfig((current) => ({
                              ...current,
                              gatewayInviteCode: event.target.value,
                            }))
                          }
                          placeholder="JISI-XXXXXXXXXX"
                        />
                      </div>
                    </div>

                    {!onboardingMode && (
                      <div className="mt-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <Label>集思模型</Label>
                            <div className="mt-1 text-xs text-muted-foreground">
                              从集思读取可用模型，选择后保存生效。
                            </div>
                          </div>
                          {selectedJisiModel ? (
                            <span className="rounded-full bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">
                              当前：{selectedJisiModel.title}
                            </span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                              当前：请选择模型
                            </span>
                          )}
                        </div>

                        {gatewayModelsLoading && (
                          <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            正在读取可用模型...
                          </div>
                        )}

                        {gatewayModelsError && !gatewayModelsLoading && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                            {gatewayModelsError} 请稍后重试。
                          </div>
                        )}

                        {gatewayModelOptions.length > 0 ? (
                          <div className="grid gap-2 md:grid-cols-2">
                        {gatewayModelOptions.map((option) => {
                          const active = config.model === option.id;
                          const summary = priceSummary(option);
                          return (
                            <button
                                  key={option.id}
                                  type="button"
                                  onClick={() =>
                                    setConfig((current) => ({
                                      ...current,
                                      model: option.id,
                                      modelSelectionMode: "manual",
                                    }))
                                  }
                                  className={cn(
                                    "flex min-h-28 flex-col rounded-lg border bg-background p-3 text-left transition hover:border-primary/50 hover:bg-accent",
                                    active
                                      ? "border-primary ring-2 ring-primary/20"
                                      : "border-border"
                                  )}
                                >
                                  <div className="mb-3 flex items-center justify-between gap-2">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-[#2F6868] dark:text-teal-300">
                                      <Cpu className="h-4 w-4" />
                                    </div>
                                    {option.isDefault && (
                                      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                                        默认
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm font-semibold">
                                    {option.title}
                                  </div>
                                  <div className="mt-1.5 text-sm text-foreground">
                                    {option.provider}
                                  </div>
                                  <div className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                    {option.description}
                                  </div>
                                  {summary && (
                                    <div className="mt-2 text-xs leading-5 text-muted-foreground">
                                      {summary}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ) : !gatewayModelsLoading && !gatewayModelsError ? (
                          <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                            暂无可展示模型。请稍后重试。
                          </div>
                        ) : null}
                      </div>
                    )}

                    {!onboardingMode && (
                      <div className="mt-4 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                        <div className="min-w-0 truncate">
                          模型：{config.model || "deepseek-v4-flash"}
                        </div>
                        <div className="min-w-0 truncate">服务：免费</div>
                      </div>
                    )}
                  </>
                ) : (
                  <div
                    className={cn(
                      onboardingMode ? "mt-4 space-y-3" : "mt-5 space-y-4"
                    )}
                  >
                    {!onboardingMode && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label htmlFor="openrouter-api-key">
                          OpenRouter API Key
                        </Label>
                        <span
                          className={cn(
                            "rounded-full px-2 py-1 text-xs font-medium",
                            config.openrouterApiKeySet
                              ? "bg-[#E8F3F1] text-[#2F6868] dark:bg-teal-950/50 dark:text-teal-200"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {config.openrouterApiKeySet ? "已保存" : "未保存"}
                        </span>
                      </div>
                    )}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <KeyRound className="h-3.5 w-3.5" />
                        API Key
                      </div>
                      <Input
                        id="openrouter-api-key"
                        type="password"
                        autoComplete="off"
                        value={config.openrouterApiKey}
                        disabled={loading}
                        onChange={(event) =>
                          setConfig((current) => ({
                            ...current,
                            openrouterApiKey: event.target.value,
                          }))
                        }
                        placeholder={
                          config.openrouterApiKeySet
                            ? "已保存，留空则继续使用当前 key"
                            : "sk-or-..."
                        }
                      />
                    </div>
                    {!onboardingMode && (
                      <div className="text-xs text-muted-foreground">
                        模型：{config.openrouterModel || "deepseek-v4-flash"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {onboardingMode && (
            <Button
              type="submit"
              disabled={!canApplyNow}
              className="h-10 w-full bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
            >
              {saving || restarting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ServerCog className="h-4 w-4" />
              )}
              完成设置，进入InternAgents
            </Button>
          )}

          {!onboardingMode && (
            <>
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
                      设置读取、写入等权限是否需要手动确认。
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
                        <div className="text-sm font-semibold">
                          {option.title}
                        </div>
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

              <SkillsConfigCard
                ref={skillsConfigRef}
                onStateChange={setSkillsState}
              />

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

              <ArchivedThreadsCard />

              <div className="flex justify-end text-xs text-muted-foreground">
                <div className="truncate">
                  配置文件：{config.configPath || "-"}
                </div>
              </div>
            </>
          )}
        </form>
      </main>
    </div>
  );
}

export default function ConfigPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      }
    >
      <ConfigPageContent />
    </Suspense>
  );
}
