"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, Save, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface ExpertAgentTemplate {
  name: string;
  description: string;
  enabled: boolean;
}

interface ExpertAgentsResponse {
  templates: ExpertAgentTemplate[];
  error?: string;
}

export function ExpertAgentsCard() {
  const [templates, setTemplates] = useState<ExpertAgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = useMemo(
    () => templates.filter((template) => template.enabled).map((template) => template.name),
    [templates]
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agents", { cache: "no-store" });
      const payload = (await response.json()) as ExpertAgentsResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Expert agents load failed.");
      }
      setTemplates(payload.templates);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Expert agents load failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/agents", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = (await response.json()) as ExpertAgentsResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Expert agents save failed.");
      }
      setTemplates(payload.templates);
      toast.success("专家 Agent 配置已保存");
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Expert agents save failed.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function toggle(name: string, checked: boolean) {
    setTemplates((current) =>
      current.map((template) =>
        template.name === name ? { ...template, enabled: checked } : template
      )
    );
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          启用内置航空专家模板。主控 Agent 会结合任务内容和可用工具自动分派，不需要用户手动选择子 Agent。
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={loading || saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          保存
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在读取专家 Agent...
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => (
            <div
              key={template.name}
              className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background p-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-primary">
                    <Bot className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 truncate font-mono text-sm font-semibold">
                    {template.name}
                  </div>
                </div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {template.description}
                </div>
              </div>
              <Switch
                checked={template.enabled}
                onCheckedChange={(checked) => toggle(template.name, checked)}
                aria-label={`Toggle ${template.name}`}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        <UsersRound className="h-4 w-4 shrink-0" />
        当前版本保存专家模板和工具路由；复杂运行图谱会在后续编排阶段逐步产品化。
      </div>
    </div>
  );
}
