"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CloudDownload,
  ExternalLink,
  FolderPlus,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { workbenchHrefFromSearchParams } from "@/app/utils/navigationContext";
import {
  SCIENCE_SKILL_CATEGORIES,
  SCIENCE_SKILL_SOURCE,
  SCIENCE_SKILLS,
  type ScienceSkillSnapshot,
} from "@/app/skills/science-skill-catalog";
import {
  filterAndRankBySearch,
  prepareSearchQuery,
  type SearchDocument,
} from "@/app/skills/skill-search";
import { scienceSkillDisplayText } from "@/app/skills/science-skill-display";
import type {
  BackendRestartResult,
  BackendStatusResult,
  ImportSkillsResponse,
  SkillEntry,
  SkillImportType,
  SkillsConfigResponse,
} from "@/app/skills/types";

const CHAT_COMPOSER_HASH = "chat-composer";
const COMPOSER_DRAFT_QUERY_KEY = "composerDraft";
const SKILL_CREATOR_DRAFT =
  "@skill-creator 请帮我创建一个能够实现「......」的skill";
const ALL_SCIENCE_CATEGORY_ID = "all";
const DEFAULT_SCIENCE_CATEGORY_ID =
  SCIENCE_SKILL_CATEGORIES[0]?.id ?? ALL_SCIENCE_CATEGORY_ID;
const FEATURED_SKILL_FOLDERS = [
  "skill-creator",
  "patent-disclosure-skill",
  "baoyu-compress-image",
  "baoyu-xhs-images",
  "docx",
  "pptx",
  "xlsx",
  "pdf",
];

const SKILL_DISPLAY_TEXT: Record<
  string,
  {
    name: string;
    description: string;
  }
> = {
  "skill-creator": {
    name: "技能创建器",
    description: "创建或更新 InternAgents 技能，把常用流程封装成可复用能力。",
  },
  "patent-disclosure-skill": {
    name: "专利申请",
    description:
      "扫描技术资料挖掘专利点，完成查新对比、自检，并生成专利技术交底书。",
  },
  "baoyu-compress-image": {
    name: "图片压缩",
    description: "压缩和优化图片体积，支持转换为 WebP、PNG、JPEG 等格式。",
  },
  "baoyu-xhs-images": {
    name: "小红书图片生成",
    description:
      "把内容拆成适合社交媒体传播的系列图片卡片，支持多种风格、布局和配色。",
  },
  docx: {
    name: "Docx文档处理",
    description:
      "创建、读取、编辑和整理 Docx 文档，支持版式、批注、修订和导出检查。",
  },
  pptx: {
    name: "PPT幻灯片处理",
    description:
      "创建、读取、编辑和整理演示文稿，支持模板、版式、讲稿备注和幻灯片合并拆分。",
  },
  xlsx: {
    name: "Excel表格处理",
    description:
      "读取、清洗、编辑和生成 Excel 表格，支持公式、格式、图表和数据整理。",
  },
  pdf: {
    name: "PDF 处理",
    description:
      "读取、合并、拆分、旋转、加水印、生成和填写表单，也可处理文字识别流程。",
  },
  "code-review": {
    name: "代码审查",
    description: "检查代码改动中的正确性、回归风险、可维护性、测试和安全问题。",
  },
  "experiment-analysis": {
    name: "实验结果分析",
    description: "分析实验结果、比较指标、生成统计表和关键结论。",
  },
  "paper-reading": {
    name: "论文阅读",
    description: "阅读论文并提炼研究问题、方法、实验设计和可复用结论。",
  },
  "project-design-philosophy": {
    name: "项目设计哲学",
    description: "整理项目设计原则、架构取舍、边界约束和实现风格。",
  },
};
const SCIENCE_SKILL_IDS = new Set(SCIENCE_SKILLS.map((skill) => skill.id));
const SCIENCE_SKILL_NAME_TO_ID = new Map(
  SCIENCE_SKILLS.map((skill) => [skill.name, skill.id])
);
const SCIENCE_CATEGORY_BY_ID = new Map(
  SCIENCE_SKILL_CATEGORIES.map((category) => [category.id, category])
);

function emptyResponse(): SkillsConfigResponse {
  return {
    enabled: false,
    catalogPaths: [
      "~/.internagents/myskills",
      "~/.internagents/imported-skills",
      "skills",
      ".internagents/imported-skills",
    ],
    activePath: ".internagents/active-skills",
    selected: [],
    skills: [],
  };
}

function skillPath(skill: SkillEntry): string {
  return skill.relativePath || skill.folderName || skill.key;
}

function displayTextForSkill(skill: SkillEntry) {
  const translation = SKILL_DISPLAY_TEXT[skill.folderName.toLowerCase()];
  return {
    name: translation?.name ?? skill.name,
    description: translation?.description ?? skill.description,
  };
}

function searchDocumentForSkill(skill: SkillEntry): SearchDocument {
  const display = displayTextForSkill(skill);
  return {
    title: display.name,
    description: display.description,
    keywords: [
      skill.name,
      skill.description,
      skillPath(skill),
      skill.folderName,
      skill.sourcePath,
    ],
  };
}

function searchDocumentForScienceSkill(
  skill: ScienceSkillSnapshot
): SearchDocument {
  const category = SCIENCE_CATEGORY_BY_ID.get(skill.categoryId);
  const display = scienceSkillDisplayText(skill, category);
  return {
    title: display.name,
    description: display.description,
    keywords: [
      skill.name,
      skill.description,
      skill.id,
      skill.sourcePath,
      category?.name ?? "",
      category?.description ?? "",
    ],
  };
}

function featuredSkillRank(skill: SkillEntry): number {
  const folderName = skill.folderName.toLowerCase();
  return FEATURED_SKILL_FOLDERS.findIndex((name) => name === folderName);
}

function scienceSkillIdForInstalledSkill(skill: SkillEntry): string | null {
  if (SCIENCE_SKILL_IDS.has(skill.folderName)) {
    return skill.folderName;
  }

  const normalizedFolder = skill.folderName.replace(/-\d+$/, "");
  if (SCIENCE_SKILL_IDS.has(normalizedFolder)) {
    return normalizedFolder;
  }

  return SCIENCE_SKILL_NAME_TO_ID.get(skill.name) ?? null;
}

function withChatComposerHash(href: string): string {
  const [base] = href.split("#");
  return `${base}#${CHAT_COMPOSER_HASH}`;
}

function withComposerDraft(href: string, draft: string): string {
  const parsed = new URL(href, "http://internagents.local");
  parsed.searchParams.set(COMPOSER_DRAFT_QUERY_KEY, draft);
  parsed.hash = CHAT_COMPOSER_HASH;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function SkillGlyph({ skill }: { skill: SkillEntry }) {
  const display = displayTextForSkill(skill);
  const label = display.name.trim().charAt(0).toUpperCase() || "S";

  return (
    <span className="text-primary-foreground flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold shadow-sm shadow-primary/10">
      {label}
    </span>
  );
}

function SkillSkeleton() {
  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex items-start gap-4"
        >
          <div className="h-11 w-11 animate-pulse rounded-md bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkillCard({
  onOpenDetails,
  skill,
}: {
  onOpenDetails: (skill: SkillEntry) => void;
  skill: SkillEntry;
}) {
  const display = displayTextForSkill(skill);

  return (
    <article className="flex min-h-[76px] min-w-0 max-w-full items-start overflow-hidden rounded-lg border border-transparent px-2 py-1 transition-[background-color,border-color] hover:border-border hover:bg-card/75">
      <button
        type="button"
        onClick={() => onOpenDetails(skill)}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-4 rounded-md px-2 py-3 text-left outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`查看 ${display.name} 详情`}
      >
        <SkillGlyph skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold leading-6">
            {display.name}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {display.description}
          </div>
        </div>
      </button>
    </article>
  );
}

function ScienceSkillCard({
  actionBusy,
  installed,
  installing,
  onInstall,
  skill,
}: {
  actionBusy: boolean;
  installed: boolean;
  installing: boolean;
  onInstall: (skill: ScienceSkillSnapshot) => void;
  skill: ScienceSkillSnapshot;
}) {
  const category = SCIENCE_CATEGORY_BY_ID.get(skill.categoryId);
  const display = scienceSkillDisplayText(skill, category);
  const label = display.name.trim().charAt(0).toUpperCase() || "S";

  return (
    <article className="flex min-h-[120px] min-w-0 max-w-full items-start gap-4 rounded-lg border border-border/70 bg-card/30 px-4 py-4 transition-[background-color,border-color] hover:border-border hover:bg-card/60">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-primary">
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-6">
              {display.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {display.description}
            </p>
          </div>
          <Button
            type="button"
            variant={installed ? "secondary" : "outline"}
            size="sm"
            onClick={() => onInstall(skill)}
            disabled={actionBusy || installed}
            className="h-8 shrink-0 px-2"
            title={
              installed ? `${display.name} 已添加` : `安装 ${display.name}`
            }
          >
            {installing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : installed ? (
              <Check className="h-4 w-4" />
            ) : (
              <CloudDownload className="h-4 w-4" />
            )}
            {installed ? "已添加" : "安装"}
          </Button>
        </div>
        <div className="mt-3 truncate font-mono text-[11px] text-muted-foreground">
          {skill.sourcePath}
        </div>
      </div>
    </article>
  );
}

export function SkillsMarketplace() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<SkillsConfigResponse>(() => emptyResponse());
  const [loading, setLoading] = useState(true);
  const [importingSkill, setImportingSkill] = useState<SkillImportType | null>(
    null
  );
  const [installingScienceSkillId, setInstallingScienceSkillId] = useState<
    string | null
  >(null);
  const [pickingLocalFolder, setPickingLocalFolder] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [autoRestart, setAutoRestart] = useState(false);
  const [backendStatus, setBackendStatus] =
    useState<BackendStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [localSource, setLocalSource] = useState("");
  const [cloudSource, setCloudSource] = useState("");
  const [scienceCategoryId, setScienceCategoryId] = useState(
    DEFAULT_SCIENCE_CATEGORY_ID
  );
  const [detailSkill, setDetailSkill] = useState<SkillEntry | null>(null);

  const workbenchHref = useMemo(
    () => workbenchHrefFromSearchParams(searchParams),
    [searchParams]
  );
  const chatComposerHref = useMemo(
    () => withChatComposerHash(workbenchHref),
    [workbenchHref]
  );
  const skillCreatorHref = useMemo(
    () => withComposerDraft(workbenchHref, SKILL_CREATOR_DRAFT),
    [workbenchHref]
  );
  const actionBusy =
    loading ||
    importingSkill !== null ||
    installingScienceSkillId !== null ||
    pickingLocalFolder ||
    checkingStatus ||
    restarting;
  const preparedSearchQuery = useMemo(
    () => prepareSearchQuery(searchQuery),
    [searchQuery]
  );
  const featuredSkills = useMemo(
    () =>
      data.skills
        .filter((skill) => featuredSkillRank(skill) !== -1)
        .sort(
          (left, right) => featuredSkillRank(left) - featuredSkillRank(right)
        ),
    [data.skills]
  );
  const filteredFeaturedSkills = useMemo(
    () =>
      filterAndRankBySearch(
        featuredSkills,
        preparedSearchQuery,
        searchDocumentForSkill
      ),
    [featuredSkills, preparedSearchQuery]
  );
  const detailSkillDisplay = detailSkill
    ? displayTextForSkill(detailSkill)
    : null;
  const selectedSkillKeys = useMemo(
    () => new Set(data.selected),
    [data.selected]
  );
  const installedScienceSkillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const skill of data.skills) {
      if (!selectedSkillKeys.has(skill.key)) {
        continue;
      }
      const scienceSkillId = scienceSkillIdForInstalledSkill(skill);
      if (scienceSkillId) {
        ids.add(scienceSkillId);
      }
    }
    return ids;
  }, [data.skills, selectedSkillKeys]);
  const activeScienceCategory = useMemo(
    () =>
      SCIENCE_SKILL_CATEGORIES.find(
        (category) => category.id === scienceCategoryId
      ),
    [scienceCategoryId]
  );
  const filteredScienceSkills = useMemo(() => {
    const searching = Boolean(preparedSearchQuery.normalized);
    const categorySkills =
      searching || scienceCategoryId === ALL_SCIENCE_CATEGORY_ID
        ? SCIENCE_SKILLS
        : SCIENCE_SKILLS.filter(
            (skill) => skill.categoryId === scienceCategoryId
          );

    return filterAndRankBySearch(
      categorySkills,
      preparedSearchQuery,
      searchDocumentForScienceSkill
    );
  }, [preparedSearchQuery, scienceCategoryId]);

  async function saveSelectedSkills(nextSelected: Set<string>) {
    const response = await fetch("/api/skills", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: nextSelected.size > 0,
        selected: Array.from(nextSelected),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "技能安装失败");
    }

    const nextData = payload as SkillsConfigResponse;
    setData({
      ...nextData,
      requiresRestart: true,
    });
    setBackendStatus(null);
    setAutoRestart(true);
    return nextData;
  }

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "技能加载失败");
      }
      const nextData = payload as SkillsConfigResponse;
      setData(nextData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "技能加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const checkBackendStatus =
    useCallback(async (): Promise<BackendStatusResult> => {
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
    }, []);

  const restartBackendWhenIdle = useCallback(async () => {
    setRestarting(true);
    try {
      const response = await fetch("/api/runtime/backend/restart", {
        method: "POST",
      });
      const restart = (await response.json()) as BackendRestartResult;
      if (!response.ok || restart.status !== "restarted") {
        throw new Error(restart.message || "后台应用失败");
      }

      setAutoRestart(false);
      setBackendStatus({
        status: "idle",
        message: restart.message,
        url: restart.url,
        busyThreads: 0,
        interruptedThreads: 0,
      });
      setData((current) => ({
        ...current,
        requiresRestart: false,
        restart,
      }));
    } catch (restartError) {
      setError(
        restartError instanceof Error ? restartError.message : "后台应用失败"
      );
    } finally {
      setRestarting(false);
    }
  }, []);

  async function importAndInstallSkill(
    type: SkillImportType,
    sourceOverride?: string,
    options: {
      clearInput?: boolean;
      successMessage?: (importedCount: number) => string;
    } = {}
  ) {
    const source =
      sourceOverride?.trim() ||
      (type === "local" ? localSource.trim() : cloudSource.trim());
    if (!source) {
      toast.error(
        type === "local" ? "请输入本地技能路径" : "请输入云端技能地址",
        {
          position: "top-center",
        }
      );
      return;
    }

    setImportingSkill(type);
    setError(null);
    try {
      const response = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, source }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "技能添加失败");
      }

      const importResult = payload as ImportSkillsResponse;
      const nextSelected = new Set(importResult.selected);
      for (const importedKey of importResult.imported) {
        nextSelected.add(importedKey);
      }
      await saveSelectedSkills(nextSelected);

      const shouldClearInput = options.clearInput ?? !sourceOverride;
      if (type === "local" && shouldClearInput) {
        setLocalSource("");
      } else if (type === "cloud" && shouldClearInput) {
        setCloudSource("");
      }
      toast.success(
        options.successMessage?.(importResult.imported.length) ??
          `已安装 ${importResult.imported.length} 个技能`,
        {
          position: "top-center",
        }
      );
    } catch (importError) {
      const message =
        importError instanceof Error ? importError.message : "技能安装失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setImportingSkill(null);
    }
  }

  async function pickAndInstallLocalSkill() {
    const typedSource = localSource.trim();
    if (typedSource) {
      await importAndInstallSkill("local", typedSource, { clearInput: true });
      return;
    }

    setPickingLocalFolder(true);
    setError(null);
    try {
      const response = await fetch("/api/skills/local-picker", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        path?: string;
        cancelled?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "无法打开本地文件夹选择器");
      }
      if (payload.cancelled) {
        return;
      }
      if (!payload.path) {
        throw new Error("没有选择本地技能文件夹。");
      }

      setLocalSource(payload.path);
      await importAndInstallSkill("local", payload.path, { clearInput: true });
    } catch (pickError) {
      const message =
        pickError instanceof Error
          ? pickError.message
          : "无法打开本地文件夹选择器";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setPickingLocalFolder(false);
    }
  }

  async function installScienceSkill(skill: ScienceSkillSnapshot) {
    if (installedScienceSkillIds.has(skill.id) || actionBusy) {
      return;
    }

    setInstallingScienceSkillId(skill.id);
    const display = scienceSkillDisplayText(
      skill,
      SCIENCE_CATEGORY_BY_ID.get(skill.categoryId)
    );
    try {
      await importAndInstallSkill("cloud", skill.installUrl, {
        clearInput: false,
        successMessage: () => `「${display.name}」已添加`,
      });
    } finally {
      setInstallingScienceSkillId(null);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!autoRestart || !data.requiresRestart || actionBusy) {
      return;
    }

    let cancelled = false;
    const checkAndRestart = async () => {
      try {
        const status = await checkBackendStatus();
        if (!cancelled && status.status === "idle") {
          await restartBackendWhenIdle();
        }
      } catch {
        // Keep this quiet; install remains saved and the next poll can retry.
      }
    };
    void checkAndRestart();
    const interval = window.setInterval(checkAndRestart, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    actionBusy,
    autoRestart,
    checkBackendStatus,
    data.requiresRestart,
    restartBackendWhenIdle,
  ]);

  return (
    <div className="flex min-h-[calc(100vh-var(--app-footer-height))] flex-col overflow-x-hidden bg-background text-foreground">
      <header className="flex h-14 items-center gap-3 border-b border-border px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-8 px-2"
        >
          <Link href={chatComposerHref}>
            <ArrowLeft className="h-4 w-4" />
            对话框
          </Link>
        </Button>
        <div className="text-sm font-semibold">能力插件</div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-hidden px-6 py-7">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal">技能</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              赋予 InternAgents 更强大的能力
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索技能"
                className="h-10 rounded-md pl-9"
              />
            </div>
            <Button
              asChild
              variant="outline"
              className="h-10 shrink-0 rounded-full px-4"
            >
              <Link href={skillCreatorHref}>
                <Plus className="h-4 w-4" />
                创建技能
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <section className="mb-8 border-b border-border pb-8">
          <div className="mb-4 flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">安装技能</h2>
          </div>
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
              <Label
                htmlFor="skills-local-source"
                className="text-xs text-muted-foreground"
              >
                本地目录
              </Label>
              <Input
                id="skills-local-source"
                value={localSource}
                onChange={(event) => setLocalSource(event.target.value)}
                placeholder="/Users/me/skills/paper-reading 或 skills/my-skill"
                disabled={actionBusy}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void pickAndInstallLocalSkill()}
                disabled={actionBusy}
                title={
                  localSource.trim()
                    ? "安装输入框中的本地技能路径"
                    : "打开本地文件夹选择器并安装技能"
                }
              >
                {pickingLocalFolder || importingSkill === "local" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderPlus className="h-4 w-4" />
                )}
                安装
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[5rem_1fr_auto] sm:items-center">
              <Label
                htmlFor="skills-cloud-source"
                className="text-xs text-muted-foreground"
              >
                云端地址
              </Label>
              <Input
                id="skills-cloud-source"
                value={cloudSource}
                onChange={(event) => setCloudSource(event.target.value)}
                placeholder="github:owner/repo/path 或 https://github.com/owner/repo"
                disabled={actionBusy}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void importAndInstallSkill("cloud")}
                disabled={actionBusy || !cloudSource.trim()}
              >
                {importingSkill === "cloud" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CloudDownload className="h-4 w-4" />
                )}
                安装
              </Button>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">精选通用技能</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {featuredSkills.length}
            </span>
          </div>

          {loading ? (
            <SkillSkeleton />
          ) : featuredSkills.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              暂时没有精选技能
            </div>
          ) : filteredFeaturedSkills.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              没有找到匹配的精选技能
            </div>
          ) : (
            <div className="grid w-full max-w-full grid-cols-1 gap-x-8 gap-y-4 overflow-x-hidden md:grid-cols-2">
              {filteredFeaturedSkills.map((skill) => (
                <SkillCard
                  key={skill.key}
                  onOpenDetails={setDetailSkill}
                  skill={skill}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mb-8 border-t border-border pt-8">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="text-base font-semibold">
                  InternAgents 精选科学技能
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {SCIENCE_SKILL_SOURCE.total}
                </span>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">
                快照来自 InternScience/scp，点击安装时会从 GitHub
                下载对应技能目录。
                <a
                  href="https://scphub.intern-ai.org.cn/"
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-flex items-center gap-1 font-medium text-[#2F6868] underline-offset-4 hover:underline dark:text-[hsl(var(--primary))]"
                >
                  SCPHub 提供了 200+ 高质量科学领域技能
                  <ExternalLink
                    className="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </a>
              </p>
            </div>
            <div className="shrink-0 truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
              {SCIENCE_SKILL_SOURCE.commit.slice(0, 12)}
            </div>
          </div>

          <div
            className="mb-5 flex flex-wrap gap-2"
            role="tablist"
            aria-label="科学技能分类"
          >
            <Button
              type="button"
              variant={
                scienceCategoryId === ALL_SCIENCE_CATEGORY_ID
                  ? "default"
                  : "outline"
              }
              size="sm"
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => setScienceCategoryId(ALL_SCIENCE_CATEGORY_ID)}
              role="tab"
              aria-selected={scienceCategoryId === ALL_SCIENCE_CATEGORY_ID}
            >
              全部
              <span className="ml-1 text-[11px] opacity-75">
                {SCIENCE_SKILL_SOURCE.total}
              </span>
            </Button>
            {SCIENCE_SKILL_CATEGORIES.map((category) => (
              <Button
                key={category.id}
                type="button"
                variant={
                  scienceCategoryId === category.id ? "default" : "outline"
                }
                size="sm"
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setScienceCategoryId(category.id)}
                role="tab"
                aria-selected={scienceCategoryId === category.id}
              >
                {category.name}
                <span className="ml-1 text-[11px] opacity-75">
                  {category.count}
                </span>
              </Button>
            ))}
          </div>

          {!searchQuery.trim() && activeScienceCategory && (
            <div className="mb-5 rounded-md border border-border/70 bg-card/30 px-4 py-3 text-xs leading-5 text-muted-foreground">
              {activeScienceCategory.description}
            </div>
          )}

          {filteredScienceSkills.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              没有找到匹配的科学技能
            </div>
          ) : (
            <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
              {filteredScienceSkills.map((skill) => (
                <ScienceSkillCard
                  key={skill.id}
                  actionBusy={actionBusy}
                  installed={installedScienceSkillIds.has(skill.id)}
                  installing={installingScienceSkillId === skill.id}
                  onInstall={installScienceSkill}
                  skill={skill}
                />
              ))}
            </div>
          )}
        </section>

        {backendStatus?.status === "busy" && (
          <div className="mt-4 text-xs text-muted-foreground">
            技能已保存，后台空闲后会自动准备好。
          </div>
        )}
      </main>

      <Dialog
        open={detailSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailSkill(null);
          }
        }}
      >
        {detailSkill && detailSkillDisplay && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <SkillGlyph skill={detailSkill} />
                <div className="min-w-0">
                  <DialogTitle className="truncate text-base leading-6">
                    {detailSkillDisplay.name}
                  </DialogTitle>
                </div>
              </div>
            </DialogHeader>
            <div className="text-sm leading-6">
              <p className="text-muted-foreground">
                {detailSkillDisplay.description || "暂无介绍"}
              </p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
