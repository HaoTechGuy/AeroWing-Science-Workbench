"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Beaker,
  FolderOpen,
  Loader2,
  Plus,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { LocalWorkspace } from "@/app/types/workspace";
import {
  pageHrefWithAppReturn,
  projectsHrefFromSearchParams,
} from "@/app/utils/navigationContext";
import { useLanguage } from "@/app/hooks/useLanguage";
import { getConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

interface WorkspacesPayload {
  cancelled?: boolean;
  defaultWorkspaceId?: string;
  workspaceId?: string;
  workspaces?: LocalWorkspace[];
  error?: string;
}

interface RuntimeConfigStatus {
  desktopMode?: boolean;
  needsOnboarding?: boolean;
}

async function shouldOpenInitialConfig(): Promise<boolean> {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const payload = (await response
      .json()
      .catch(() => null)) as RuntimeConfigStatus | null;
    return (
      response.ok &&
      payload?.desktopMode === true &&
      payload?.needsOnboarding === true
    );
  } catch {
    return false;
  }
}

function compactPath(value: string) {
  if (!value) return "-";
  const homePrefix = "/Users/";
  if (value.startsWith(homePrefix)) {
    const parts = value.split("/").filter(Boolean);
    if (parts.length > 2) {
      return `~/${parts.slice(2).join("/")}`;
    }
  }
  return value;
}

function ProjectsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();
  const config = useMemo(() => getConfig(), []);
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([]);
  const [defaultWorkspaceId, setDefaultWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkingInitialConfig, setCheckingInitialConfig] = useState(true);
  const [picking, setPicking] = useState(false);

  const localResource = config.resources.find(
    (resource) => resource.id === "local"
  );
  const assistantId =
    localResource?.assistantId || config.assistantId || "agent_local";
  const projectsHref = useMemo(
    () => projectsHrefFromSearchParams(searchParams),
    [searchParams]
  );
  const configHref = useMemo(
    () => pageHrefWithAppReturn("/config", projectsHref),
    [projectsHref]
  );
  const initialConfigHref = useMemo(() => {
    const href = pageHrefWithAppReturn("/config", projectsHref);
    const separator = href.includes("?") ? "&" : "?";
    return `${href}${separator}onboarding=1`;
  }, [projectsHref]);
  const workbenchHref = useCallback(
    (workspaceId: string) => {
      const params = new URLSearchParams({
        assistantId,
        resourceId: "local",
        workspaceId,
      });
      return `/?${params.toString()}`;
    },
    [assistantId]
  );

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      const payload = (await response.json()) as WorkspacesPayload;
      if (!response.ok) {
        throw new Error(payload.error || t("projectListReadFailed"));
      }
      setWorkspaces(payload.workspaces || []);
      setDefaultWorkspaceId(payload.defaultWorkspaceId || "");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("projectListReadFailed");
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const pickWorkspace = useCallback(async () => {
    setPicking(true);
    try {
      const response = await fetch("/api/workspaces", { method: "POST" });
      const payload = (await response.json()) as WorkspacesPayload;
      if (!response.ok) {
        throw new Error(payload.error || t("projectPickFailed"));
      }
      if (payload.cancelled) {
        return;
      }
      const nextWorkspaceId = payload.workspaceId || payload.defaultWorkspaceId;
      if (payload.workspaces) {
        setWorkspaces(payload.workspaces);
      }
      if (payload.defaultWorkspaceId) {
        setDefaultWorkspaceId(payload.defaultWorkspaceId);
      }
      if (nextWorkspaceId) {
        router.push(workbenchHref(nextWorkspaceId));
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("projectPickFailed");
      toast.error(message);
    } finally {
      setPicking(false);
    }
  }, [router, t, workbenchHref]);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      if (await shouldOpenInitialConfig()) {
        if (!cancelled) {
          router.replace(initialConfigHref);
        }
        return;
      }
      if (!cancelled) {
        setCheckingInitialConfig(false);
        void loadWorkspaces();
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [initialConfigHref, loadWorkspaces, router]);

  if (checkingInitialConfig) {
    return (
      <main className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t("loading")}</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-var(--app-footer-height))] bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <Beaker className="h-6 w-6 text-primary" />
              <div>
                <h1 className="font-serif text-3xl font-semibold leading-none">
                  InternAgentS
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("localResearchWorkbench")}
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="outline"
              size="sm"
            >
              <Link href={configHref}>
                <Settings className="h-4 w-4" />
                {t("settings")}
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void pickWorkspace()}
              disabled={picking}
            >
              {picking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {t("newProject")}
            </Button>
          </div>
        </header>

        <section>
          <div className="mb-4 flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{t("projects")}</h2>
          </div>

          {loading ? (
            <div className="flex h-36 items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t("loadingProjects")}
            </div>
          ) : workspaces.length > 0 ? (
            <div className="space-y-2">
              {workspaces.map((workspace) => {
                const active = workspace.id === defaultWorkspaceId;
                return (
                  <Link
                    key={workspace.id}
                    href={workbenchHref(workspace.id)}
                    className={cn(
                      "group grid gap-3 rounded-lg border border-border bg-card px-4 py-4 shadow-sm transition hover:border-primary/35 hover:bg-accent/45 sm:grid-cols-[minmax(0,1fr)_auto]",
                      active && "border-primary/35"
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-semibold">
                          {workspace.label}
                        </h3>
                        {active && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            {t("current")}
                          </span>
                        )}
                        {workspace.isRemote && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {t("remote")}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 truncate text-sm text-muted-foreground">
                        {compactPath(workspace.resolvedPath || workspace.path)}
                      </p>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      <span>{workspace.isRemote ? t("remote") : t("local")}</span>
                      <span>{t("ready")}</span>
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card px-5 py-8 text-center">
              <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-semibold">
                {t("noProjects")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("noProjectsDescription")}
              </p>
              <Button
                type="button"
                className="mt-4"
                onClick={() => void pickWorkspace()}
                disabled={picking}
              >
                {picking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {t("newProject")}
              </Button>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsPageFallback />}>
      <ProjectsPageContent />
    </Suspense>
  );
}

function ProjectsPageFallback() {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[calc(100vh-var(--app-footer-height))] items-center justify-center bg-background text-foreground">
      <p className="text-muted-foreground">{t("loading")}</p>
    </div>
  );
}
