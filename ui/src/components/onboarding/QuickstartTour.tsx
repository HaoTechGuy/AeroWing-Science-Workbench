"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Map,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type QuickstartStep = {
  id: string;
  route: string;
  href?: string;
  target?: string;
  title: string;
  body: string;
};

type TourEventDetail = {
  stepId?: string;
  restart?: boolean;
  force?: boolean;
  auto?: boolean;
};

const QUICKSTART_COMPLETED_KEY = "internagents.quickstart.completed.v1";
const QUICKSTART_STEP_KEY = "internagents.quickstart.step.v1";
const QUICKSTART_ONBOARDING_ENDPOINT = "/api/onboarding/quickstart";
const QUICKSTART_START_PARAM = "quickstart";
const WORKBENCH_HREF = "/?assistantId=agent_local";
const WORKBENCH_PARAM_KEYS = [
  "resourceId",
  "assistantId",
  "workspaceId",
  "threadId",
  "file",
];

type RuntimeWindow = Window & {
  __INTERNAGENTS_RUNTIME_CONFIG__?: {
    desktopMode?: boolean;
  };
};

type AutoStartGate = "pending" | "local" | "desktop";

type QuickstartAutoStartStatus = {
  desktopMode?: boolean;
  shouldAutoStart?: boolean;
};

const QUICKSTART_STEPS: QuickstartStep[] = [
  {
    id: "welcome",
    route: "/",
    href: WORKBENCH_HREF,
    title: "InternAgents 快速导览",
    body: "这条导览会先介绍主工作台，再带你快速看配置和关于与更新这些页面各自负责什么。",
  },
  {
    id: "local-agent",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="local-agent"]',
    title: "当前项目",
    body: "这里确认当前使用的项目或资源。打开下拉菜单可以切换已有工作区，也可以打开或新增本地工作区、接入远程工作区。",
  },
  {
    id: "workspace",
    route: "/",
    href: WORKBENCH_HREF,
    target: "#workspace-files",
    title: "项目工作区",
    body: "这里是智能体的项目工作区，展示当前项目文件，也是智能体读取文件、写入结果和执行任务时使用的目录。",
  },
  {
    id: "chat",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="chat-input"]',
    title: "当前会话",
    body: "中间是当前会话。你可以向智能体提问、交代任务、附加图片或文件，并在顶部修改会话标题。",
  },
  {
    id: "thread-history",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="thread-list"]',
    title: "项目会话记录",
    body: "这里保留当前项目的会话历史。你可以切换旧会话、新建会话，也可以归档不常用的对话。",
  },
  {
    id: "config",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="nav-config"]',
    title: "配置",
    body: "点击这里进入配置页，可以调整模型、工作区、授权模式、技能和界面风格。",
  },
  {
    id: "config-model",
    route: "/config",
    target: '[data-tour="config-model"]',
    title: "模型选择",
    body: "这里可以选择集思或 OpenRouter。使用集思时，可以在集思模型列表里更换模型，保存并应用后生效。",
  },
  {
    id: "config-workspace",
    route: "/config",
    target: '[data-tour="config-workspace"]',
    title: "工作区设置",
    body: "这里可以修改本机工作区路径。文件浏览和智能体执行任务时，都会以这个工作区为根目录。",
  },
  {
    id: "about",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="nav-about"]',
    title: "关于与更新",
    body: "点击这里进入关于与更新页，可以查看帮助文档、重新开始导览，也可以检查本机更新。",
  },
  {
    id: "about-help",
    route: "/about",
    target: '[data-tour="about-help-docs"]',
    title: "帮助文档",
    body: "这里可以打开用户手册，查看功能说明、常见工作流和更多使用细节。",
  },
  {
    id: "about-update",
    route: "/about",
    target: '[data-tour="about-update-check"]',
    title: "检查更新",
    body: "这里可以检查是否有新版本。检查到可用版本后，再按需执行一键更新。",
  },
  {
    id: "finish",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="chat-input"]',
    title: "准备好了",
    body: "导览结束后，可以先发送一个文献调研任务，例如：请帮我调研并下载大模型智能体相关文献。",
  },
];

function readCompleted() {
  try {
    return window.localStorage.getItem(QUICKSTART_COMPLETED_KEY) === "true";
  } catch {
    return true;
  }
}

function writeCompleted(completed: boolean) {
  try {
    window.localStorage.setItem(QUICKSTART_COMPLETED_KEY, String(completed));
  } catch {
    // Ignore storage failures; the visible tour state still works for the session.
  }
}

function readStoredStepIndex() {
  try {
    const storedStepId = window.localStorage.getItem(QUICKSTART_STEP_KEY);
    const storedIndex = QUICKSTART_STEPS.findIndex(
      (step) => step.id === storedStepId
    );
    return storedIndex >= 0 ? storedIndex : 0;
  } catch {
    return 0;
  }
}

function writeStoredStep(stepId: string) {
  try {
    window.localStorage.setItem(QUICKSTART_STEP_KEY, stepId);
  } catch {
    // Ignore storage failures.
  }
}

function removeStoredStep() {
  try {
    window.localStorage.removeItem(QUICKSTART_STEP_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function isDesktopRuntime() {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(
    (window as RuntimeWindow).__INTERNAGENTS_RUNTIME_CONFIG__?.desktopMode
  );
}

function getInitialAutoStartGate(): AutoStartGate {
  return isDesktopRuntime() ? "pending" : "local";
}

async function readAutoStartStatus(): Promise<QuickstartAutoStartStatus> {
  const response = await fetch(QUICKSTART_ONBOARDING_ENDPOINT, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("无法读取导览自动启动状态。");
  }
  return (await response.json()) as QuickstartAutoStartStatus;
}

async function markAutoShown() {
  try {
    await fetch(QUICKSTART_ONBOARDING_ENDPOINT, {
      method: "PUT",
      cache: "no-store",
    });
  } catch {
    // Keep the tour usable even if the best-effort desktop marker write fails.
  }
}

function clampCardPosition(left: number, top: number) {
  const cardWidth = Math.min(360, window.innerWidth - 32);
  const cardHeight = 260;
  return {
    left: Math.max(16, Math.min(left, window.innerWidth - cardWidth - 16)),
    top: Math.max(16, Math.min(top, window.innerHeight - cardHeight - 16)),
    width: cardWidth,
  };
}

function isConfigSetupRoute() {
  try {
    return new URLSearchParams(window.location.search).get("onboarding") === "1";
  } catch {
    return false;
  }
}

function isQuickstartStartRoute() {
  try {
    return (
      new URLSearchParams(window.location.search).get(QUICKSTART_START_PARAM) ===
      "1"
    );
  } catch {
    return false;
  }
}

function clearQuickstartStartRoute() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(QUICKSTART_START_PARAM);
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`
    );
  } catch {
    // Keep the tour running even if the URL cannot be cleaned up.
  }
}

function safeWorkbenchHref(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value, "http://internagents.local");
    if (
      parsed.origin !== "http://internagents.local" ||
      parsed.pathname !== "/"
    ) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function getWorkbenchHref() {
  if (typeof window === "undefined") {
    return WORKBENCH_HREF;
  }

  try {
    const currentParams = new URLSearchParams(window.location.search);
    const explicitReturnTo = safeWorkbenchHref(currentParams.get("returnTo"));
    if (explicitReturnTo) {
      return explicitReturnTo;
    }

    const nextParams = new URLSearchParams();
    for (const key of WORKBENCH_PARAM_KEYS) {
      const value = currentParams.get(key);
      if (value) {
        nextParams.set(key, value);
      }
    }
    if (!nextParams.get("assistantId")) {
      nextParams.set("assistantId", "agent_local");
    }
    return `/?${nextParams.toString()}`;
  } catch {
    return WORKBENCH_HREF;
  }
}

function getPageHref(pathname: string) {
  if (typeof window === "undefined") {
    return pathname;
  }

  try {
    const nextParams = new URLSearchParams();
    nextParams.set("returnTo", getWorkbenchHref());
    return `${pathname}?${nextParams.toString()}`;
  } catch {
    return pathname;
  }
}

export function QuickstartTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [autoStartGate, setAutoStartGate] = useState<AutoStartGate>(
    getInitialAutoStartGate
  );

  const step = QUICKSTART_STEPS[stepIndex] ?? QUICKSTART_STEPS[0];
  const totalSteps = QUICKSTART_STEPS.length;
  const isLastStep = stepIndex === totalSteps - 1;
  const isFirstStep = stepIndex === 0;
  const onStepRoute = pathname === step.route;
  const stepHref = useMemo(
    () =>
      step.href ||
      (step.route === "/" ? getWorkbenchHref() : getPageHref(step.route)),
    [step.href, step.route]
  );

  const startTour = useCallback((detail?: TourEventDetail) => {
    if (!detail?.restart && !detail?.force && readCompleted()) {
      return;
    }
    if (isConfigSetupRoute()) {
      return;
    }

    const requestedIndex = detail?.stepId
      ? QUICKSTART_STEPS.findIndex((candidate) => candidate.id === detail.stepId)
      : -1;
    const nextIndex =
      requestedIndex >= 0
        ? requestedIndex
        : detail?.restart
        ? 0
        : readStoredStepIndex();

    writeCompleted(false);
    if (detail?.auto) {
      void markAutoShown();
    }
    setStepIndex(nextIndex);
    setActive(true);
  }, []);

  useEffect(() => {
    if (!isQuickstartStartRoute() || isConfigSetupRoute()) {
      return;
    }

    clearQuickstartStartRoute();
    startTour({ auto: true, force: true, restart: true });
  }, [pathname, startTour]);

  useEffect(() => {
    if (
      autoStartGate === "pending" ||
      autoStartGate === "desktop"
    ) {
      return;
    }

    if (!active && !readCompleted() && !isConfigSetupRoute()) {
      setStepIndex(readStoredStepIndex());
      setActive(true);
    }
  }, [active, autoStartGate, pathname]);

  const endTour = useCallback(() => {
    writeCompleted(true);
    removeStoredStep();
    setActive(false);
  }, []);

  useEffect(() => {
    function handleStart(event: Event) {
      startTour((event as CustomEvent<TourEventDetail>).detail);
    }

    async function handleAutoStart() {
      if (active) {
        return;
      }

      try {
        const status = await readAutoStartStatus();
        if (status.desktopMode) {
          setAutoStartGate("desktop");
          if (status.shouldAutoStart) {
            startTour({ auto: true, force: true });
          }
          return;
        }
      } catch {
        if (isDesktopRuntime()) {
          setAutoStartGate("desktop");
          return;
        }
      }

      setAutoStartGate("local");
      startTour();
    }

    window.addEventListener("internagents.quickstart.start", handleStart);
    window.addEventListener("internagents.quickstart.autostart", handleAutoStart);
    return () => {
      window.removeEventListener("internagents.quickstart.start", handleStart);
      window.removeEventListener(
        "internagents.quickstart.autostart",
        handleAutoStart
      );
    };
  }, [active, startTour]);

  useEffect(() => {
    if (!active) {
      return;
    }
    writeStoredStep(step.id);
    if (!onStepRoute) {
      router.push(stepHref);
    }
  }, [active, onStepRoute, router, step.id, stepHref]);

  useEffect(() => {
    if (!active || !onStepRoute) {
      setTargetRect(null);
      setTargetMissing(false);
      return;
    }

    let frameId = 0;
    let timeoutId = 0;
    let attempts = 0;

    const updateTarget = () => {
      attempts += 1;
      const target = step.target
        ? document.querySelector<HTMLElement>(step.target)
        : null;

      if (!step.target) {
        setTargetRect(null);
        setTargetMissing(false);
        return;
      }

      if (!target && attempts < 18) {
        timeoutId = window.setTimeout(updateTarget, 100);
        return;
      }

      if (!target) {
        setTargetRect(null);
        setTargetMissing(true);
        return;
      }

      target.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "smooth",
      });

      frameId = window.requestAnimationFrame(() => {
        setTargetRect(target.getBoundingClientRect());
        setTargetMissing(false);
      });
    };

    updateTarget();
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);

    return () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [active, onStepRoute, step.target]);

  const cardStyle = useMemo<CSSProperties>(() => {
    if (!active || !onStepRoute || !targetRect) {
      return {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const spaceRight = window.innerWidth - targetRect.right;
    const spaceLeft = targetRect.left;
    const preferRight = spaceRight >= 392 || spaceRight >= spaceLeft;
    const left = preferRight ? targetRect.right + 18 : targetRect.left - 378;
    const top = targetRect.top + Math.min(24, targetRect.height / 3);
    const clamped = clampCardPosition(left, top);

    return {
      left: clamped.left,
      top: clamped.top,
      width: clamped.width,
    };
  }, [active, onStepRoute, targetRect]);

  const spotlightStyle = useMemo<CSSProperties | null>(() => {
    if (!active || !onStepRoute || !targetRect) {
      return null;
    }

    return {
      left: Math.max(8, targetRect.left - 8),
      top: Math.max(8, targetRect.top - 8),
      width: Math.min(window.innerWidth - 16, targetRect.width + 16),
      height: Math.min(window.innerHeight - 16, targetRect.height + 16),
    };
  }, [active, onStepRoute, targetRect]);

  const goPrevious = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  const goNext = useCallback(() => {
    if (isLastStep) {
      endTour();
      return;
    }
    setStepIndex((current) =>
      Math.min(QUICKSTART_STEPS.length - 1, current + 1)
    );
  }, [endTour, isLastStep]);

  if (!active) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70]">
      {!spotlightStyle && <div className="absolute inset-0 bg-black/45" />}
      {spotlightStyle && (
        <div
          className="pointer-events-none fixed rounded-lg border-2 border-white bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.45),0_10px_40px_rgba(0,0,0,0.28)] ring-4 ring-[#2F6868]/60"
          style={spotlightStyle}
        />
      )}
      <section
        className={cn(
          "fixed max-w-[calc(100vw-32px)] rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xl",
          !targetRect && "w-[360px]"
        )}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quickstart-tour-title"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Map className="h-3.5 w-3.5" />
              导览 {stepIndex + 1} / {totalSteps}
            </div>
            <h2
              id="quickstart-tour-title"
              className="text-sm font-semibold leading-6"
            >
              {step.title}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={endTour}
            aria-label="关闭导览"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>
        {!onStepRoute && (
          <p className="mt-2 text-xs text-muted-foreground">正在跳转...</p>
        )}
        {targetMissing && (
          <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
            当前区域暂未渲染，仍可继续下一步。
          </p>
        )}

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-[#2F6868] transition-all"
            style={{
              width: `${((stepIndex + 1) / totalSteps) * 100}%`,
            }}
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={endTour}
            className="h-9"
          >
            跳过
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goPrevious}
              disabled={isFirstStep}
              className="h-9"
            >
              <ArrowLeft className="h-4 w-4" />
              上一步
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={goNext}
              className="h-9 bg-[#2F6868] text-white hover:bg-[#2F6868]/90"
            >
              {isLastStep ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  完成
                </>
              ) : (
                <>
                  下一步
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
