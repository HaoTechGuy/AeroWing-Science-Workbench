"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Cpu,
  KeyRound,
  Loader2,
  Moon,
  Save,
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
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadConfig() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "配置读取失败");
      }
      setConfig(payload as ConfigResponse);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "配置读取失败";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setConfig(payload as ConfigResponse);
      setApiKeyDraft("");
      toast.success(payload.message || "配置已保存");
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "配置保存失败";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
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

        <Button
          form="internagents-config-form"
          type="submit"
          disabled={loading || saving}
          className="h-9"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存配置
        </Button>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-6">
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <form
          id="internagents-config-form"
          onSubmit={saveConfig}
          className="space-y-5"
        >
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-[#2F6868] dark:text-teal-300">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold">模型</h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  使用 OpenRouter 连接模型。模型和 key 会保存在本地配置中。
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

          <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div>模型和授权模式会在后台重启后生效。</div>
            <div className="truncate">配置文件：{config.configPath || "-"}</div>
          </div>
        </form>
      </main>
    </div>
  );
}
