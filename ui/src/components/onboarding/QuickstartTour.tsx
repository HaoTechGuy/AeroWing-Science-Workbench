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
};

const QUICKSTART_COMPLETED_KEY = "internagents.quickstart.completed.v1";
const QUICKSTART_STEP_KEY = "internagents.quickstart.step.v1";
const WORKBENCH_HREF = "/?assistantId=agent";

const QUICKSTART_STEPS: QuickstartStep[] = [
  {
    id: "welcome",
    route: "/",
    href: WORKBENCH_HREF,
    title: "InternAgents 快速导览",
    body: "这条导览会先介绍主工作台，再带你快速看连接服务器、配置和关于与更新这些页面各自负责什么。",
  },
  {
    id: "local-agent",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="local-agent"]',
    title: "当前项目",
    body: "这里确认当前使用的项目或资源。切换项目会影响左侧文件、项目会话和智能体运行上下文。",
  },
  {
    id: "workspace",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="workspace-panel"]',
    title: "项目工作区",
    body: "左侧展示当前项目文件。你可以浏览代码、文本、图片和 PDF；智能体的文件读取和命令也围绕这个工作区展开。",
  },
  {
    id: "chat",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="chat-input"]',
    title: "项目会话",
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
    id: "connect",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="nav-connect"]',
    title: "连接服务器",
    body: "连接服务器页面负责配置 InternAgents 要连接的本地或远程智能体服务。通常本机开发保留默认地址；需要连接云端或其他运行环境时再修改。",
  },
  {
    id: "config",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="nav-config"]',
    title: "配置",
    body: "这个页面负责模型、工作区、授权模式和界面风格等设置。模型和授权通常影响后端行为，工作区和界面相关设置会直接影响使用体验。",
  },
  {
    id: "about",
    route: "/",
    href: WORKBENCH_HREF,
    target: '[data-tour="nav-about"]',
    title: "关于与更新",
    body: "这个页面负责介绍 InternAgents、重新开始导览，以及检查和执行本机更新。需要确认版本或重新看导览时来这里。",
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

export function QuickstartTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);

  const step = QUICKSTART_STEPS[stepIndex] ?? QUICKSTART_STEPS[0];
  const totalSteps = QUICKSTART_STEPS.length;
  const isLastStep = stepIndex === totalSteps - 1;
  const isFirstStep = stepIndex === 0;
  const onStepRoute = pathname === step.route;

  const startTour = useCallback((detail?: TourEventDetail) => {
    if (!detail?.restart && readCompleted()) {
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
    setStepIndex(nextIndex);
    setActive(true);
  }, []);

  useEffect(() => {
    if (!active && !readCompleted() && !isConfigSetupRoute()) {
      setStepIndex(readStoredStepIndex());
      setActive(true);
    }
  }, [active, pathname]);

  const endTour = useCallback(() => {
    writeCompleted(true);
    removeStoredStep();
    setActive(false);
  }, []);

  useEffect(() => {
    function handleStart(event: Event) {
      startTour((event as CustomEvent<TourEventDetail>).detail);
    }

    function handleAutoStart() {
      if (!active) {
        startTour();
      }
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
      router.push(step.href || step.route);
    }
  }, [active, onStepRoute, router, step.href, step.id, step.route]);

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
    <div className="fixed inset-0 z-50">
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
              Quickstart {stepIndex + 1} / {totalSteps}
            </div>
            <h2
              id="quickstart-tour-title"
              className="text-base font-semibold leading-6"
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
            aria-label="关闭 Quickstart"
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
