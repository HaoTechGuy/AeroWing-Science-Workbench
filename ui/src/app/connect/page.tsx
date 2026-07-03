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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/app/hooks/useLanguage";
import {
  clearConnectionConfig,
  getConfig,
  getDefaultConfig,
  saveConnectionConfig,
} from "@/lib/config";

export default function ConnectPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [deploymentUrl, setDeploymentUrl] = useState("");
  const [assistantId, setAssistantId] = useState("");

  useEffect(() => {
    const config = getConfig();
    setDeploymentUrl(config.deploymentUrl);
    setAssistantId(config.assistantId);
  }, []);

  function saveAndReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextDeploymentUrl = deploymentUrl.trim();
    const nextAssistantId = assistantId.trim();

    if (!nextDeploymentUrl || !nextAssistantId) {
      toast.error(t("connectionMissingFields"));
      return;
    }

    try {
      new URL(nextDeploymentUrl);
    } catch {
      toast.error(t("serverUrlRequired"));
      return;
    }

    saveConnectionConfig({
      deploymentUrl: nextDeploymentUrl,
      assistantId: nextAssistantId,
    });

    toast.success(t("connectionSaved"));
    router.push(`/?assistantId=${encodeURIComponent(nextAssistantId)}`);
  }

  function restoreDefault() {
    const config = getDefaultConfig();
    clearConnectionConfig();
    setDeploymentUrl(config.deploymentUrl);
    setAssistantId(config.assistantId);
    toast.success(t("defaultConnectionRestored"));
  }

  return (
    <div className="flex min-h-[calc(100vh-var(--app-footer-height))] flex-col bg-background text-foreground">
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
              {t("backToWorkbench")}
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {t("connectServer")}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {t("connectServerSubtitle")}
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
              <Server className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold">
                {t("serverConnection")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("serverConnectionDescription")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deployment-url">{t("serverAddress")}</Label>
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
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={restoreDefault}
            >
              <RotateCcw className="h-4 w-4" />
              {t("restoreDefault")}
            </Button>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Save className="h-4 w-4" />
              {t("saveAndReturnWorkbench")}
            </Button>
          </div>
        </form>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background">
              <Cloud className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                {t("cloudHosting")}
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-primary">
                  Beta
                </span>
              </h2>
              <div className="mt-1 text-sm text-muted-foreground">
                {t("cloudHostingDescription")}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-border/80 bg-background px-3 py-3">
              <Globe2 className="mb-2 h-4 w-4 text-primary" />
              <div className="text-sm font-medium">
                {t("deploymentAddress")}
              </div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("deploymentAddressHelp")}
              </div>
            </div>
            <div className="rounded-md border border-border/80 bg-background px-3 py-3">
              <Server className="mb-2 h-4 w-4 text-primary" />
              <div className="text-sm font-medium">Assistant ID</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("assistantIdHelp")}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
