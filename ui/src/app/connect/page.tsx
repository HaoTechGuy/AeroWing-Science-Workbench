"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Cloud,
  Globe2,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearConnectionConfig,
  getConfig,
  getDefaultConfig,
  saveConnectionConfig,
} from "@/lib/config";

export default function ConnectPage() {
  const router = useRouter();
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [langsmithApiKey, setLangsmithApiKey] = useState("");

  useEffect(() => {
    const config = getConfig();
    setDeploymentUrl(config.deploymentUrl);
    setAssistantId(config.assistantId);
    setLangsmithApiKey(config.langsmithApiKey || "");
  }, []);

  function saveAndReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextDeploymentUrl = deploymentUrl.trim();
    const nextAssistantId = assistantId.trim();

    if (!nextDeploymentUrl || !nextAssistantId) {
      toast.error("请填写服务器地址和 Assistant ID");
      return;
    }

    try {
      new URL(nextDeploymentUrl);
    } catch {
      toast.error("服务器地址需要是完整 URL");
      return;
    }

    saveConnectionConfig({
      deploymentUrl: nextDeploymentUrl,
      assistantId: nextAssistantId,
      langsmithApiKey,
    });

    toast.success("连接配置已保存");
    router.push(`/?assistantId=${encodeURIComponent(nextAssistantId)}`);
  }

  function restoreDefault() {
    const config = getDefaultConfig();
    clearConnectionConfig();
    setDeploymentUrl(config.deploymentUrl);
    setAssistantId(config.assistantId);
    setLangsmithApiKey(config.langsmithApiKey || "");
    toast.success("已恢复默认连接配置");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
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
            <h1 className="truncate text-xl font-semibold">连接服务器</h1>
            <p className="truncate text-xs text-muted-foreground">
              配置 InternAgents 要连接的本地或远程服务
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-6 py-6">
        <form
          onSubmit={saveAndReturn}
          className="rounded-lg border border-border bg-card p-5"
        >
          <div className="mb-5 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <Server className="h-5 w-5 text-[#2F6868]" />
            </div>
            <div>
              <h2 className="text-base font-semibold">服务器连接</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                本机默认连接 LangGraph 开发服务；保存后回到工作台会自动使用新配置。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deployment-url">服务器地址</Label>
              <Input
                id="deployment-url"
                value={deploymentUrl}
                onChange={(event) => setDeploymentUrl(event.target.value)}
                placeholder="http://127.0.0.1:2024"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="assistant-id">Assistant ID</Label>
              <Input
                id="assistant-id"
                value={assistantId}
                onChange={(event) => setAssistantId(event.target.value)}
                placeholder="agent"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="langsmith-api-key">LangSmith API Key</Label>
              <Input
                id="langsmith-api-key"
                value={langsmithApiKey}
                onChange={(event) => setLangsmithApiKey(event.target.value)}
                placeholder="本地服务通常可留空"
                type="password"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={restoreDefault}
            >
              <RotateCcw className="h-4 w-4" />
              恢复默认
            </Button>
            <Button
              type="submit"
              className="bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
            >
              <Save className="h-4 w-4" />
              保存并返回工作台
            </Button>
          </div>
        </form>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <Cloud className="h-5 w-5 text-[#2F6868]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">云端托管</h2>
              <div className="mt-1 text-sm text-muted-foreground">
                连接云端部署的 InternAgents，让同一个助手可以长期运行、跨设备访问。
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border/80 bg-background px-3 py-3">
              <Globe2 className="mb-2 h-4 w-4 text-[#2F6868]" />
              <div className="text-sm font-medium">部署地址</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                将云端 Deployment URL 填入上方服务器地址。
              </div>
            </div>
            <div className="rounded-md border border-border/80 bg-background px-3 py-3">
              <Server className="mb-2 h-4 w-4 text-[#2F6868]" />
              <div className="text-sm font-medium">Assistant ID</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                使用云端 graph 或 assistant 对应的 ID。
              </div>
            </div>
            <div className="rounded-md border border-border/80 bg-background px-3 py-3">
              <ShieldCheck className="mb-2 h-4 w-4 text-[#2F6868]" />
              <div className="text-sm font-medium">访问密钥</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                需要鉴权时，把 API Key 填到上方密钥栏。
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
