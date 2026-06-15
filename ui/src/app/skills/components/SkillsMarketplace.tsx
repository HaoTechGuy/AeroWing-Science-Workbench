"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CloudDownload,
  ExternalLink,
  FolderPlus,
  Loader2,
  MessageCircle,
  PackageCheck,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WORKBENCH_RETURN_STORAGE_KEY,
  safeWorkbenchHref,
  workbenchHrefFromSearchParams,
} from "@/app/utils/navigationContext";
import { cn } from "@/lib/utils";
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
const ENABLE_SKILL_QUERY_KEY = "enableSkill";
const SKILL_CREATOR_SKILL_ID = "skill-creator";
const SKILL_CREATOR_DRAFT = "@skill-creator请帮我创建一个能够实现「……」的skill";
const ALL_SCIENCE_CATEGORY_ID = "all";
const DEFAULT_SCIENCE_CATEGORY_ID = ALL_SCIENCE_CATEGORY_ID;
const SCIENCE_MARKET_TAB = "science-market";
const INSTALLED_SKILLS_TAB = "installed-skills";
type SkillsTab = typeof SCIENCE_MARKET_TAB | typeof INSTALLED_SKILLS_TAB;
const UPLOAD_LOCAL_MODE = "local";
const UPLOAD_CLOUD_MODE = "cloud";
type UploadSkillMode = typeof UPLOAD_LOCAL_MODE | typeof UPLOAD_CLOUD_MODE;
type SelectedSkillsUpdate =
  | Set<string>
  | ((currentSelected: Set<string>) => Set<string>);
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
const SCIENCE_SKILL_BY_ID = new Map(
  SCIENCE_SKILLS.map((skill) => [skill.id, skill])
);
const SCIENCE_SKILL_NAME_TO_ID = new Map(
  SCIENCE_SKILLS.map((skill) => [skill.name, skill.id])
);
const SCIENCE_CATEGORY_BY_ID = new Map(
  SCIENCE_SKILL_CATEGORIES.map((category) => [category.id, category])
);
const CARD_CLASS =
  "relative flex min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/60 transition-[background-color,border-color] hover:border-primary/25 hover:bg-card";

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
  const scienceSkillId = scienceSkillIdForInstalledSkill(skill);
  const scienceSkill = scienceSkillId
    ? SCIENCE_SKILL_BY_ID.get(scienceSkillId)
    : null;
  if (scienceSkill) {
    return scienceSkillDisplayText(
      scienceSkill,
      SCIENCE_CATEGORY_BY_ID.get(scienceSkill.categoryId)
    );
  }

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

function isFeaturedSkill(skill: SkillEntry): boolean {
  return featuredSkillRank(skill) !== -1;
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

function withEnabledSkill(href: string, skillId: string): string {
  const parsed = new URL(href, "http://internagents.local");
  parsed.searchParams.set(ENABLE_SKILL_QUERY_KEY, skillId);
  parsed.hash = CHAT_COMPOSER_HASH;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function SkillGlyph({ skill }: { skill: SkillEntry }) {
  const display = displayTextForSkill(skill);
  const label = display.name.trim().charAt(0).toUpperCase() || "S";

  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-primary">
      {label}
    </span>
  );
}

function SkillSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            CARD_CLASS,
            "min-h-[112px] items-start gap-4 px-4 py-4"
          )}
        >
          <div className="h-10 w-10 animate-pulse rounded-md bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="h-3 w-72 max-w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

function InstalledSkillCard({
  group,
  onOpenDetails,
  onUninstall,
  skill,
  uninstalling,
}: {
  group: "default" | "science" | "imported";
  onOpenDetails: (skill: SkillEntry) => void;
  onUninstall?: (skill: SkillEntry) => void;
  skill: SkillEntry;
  uninstalling?: boolean;
}) {
  const display = displayTextForSkill(skill);
  const isScienceGroup = group === "science";
  const canUninstall = group !== "default" && typeof onUninstall === "function";

  return (
    <article
      className={cn(
        CARD_CLASS,
        "group items-start",
        isScienceGroup ? "min-h-[120px]" : "min-h-[112px]"
      )}
    >
      <button
        type="button"
        onClick={() => onOpenDetails(skill)}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-start gap-4 px-4 py-4 text-left outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          canUninstall ? "pr-24" : "pr-4"
        )}
        aria-label={`查看 ${display.name} 详情`}
      >
        <SkillGlyph skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold leading-6">
            {display.name}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {display.description}
          </div>
        </div>
      </button>
      {canUninstall ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onUninstall?.(skill)}
          disabled={uninstalling}
          className="absolute right-3 top-3 h-8 gap-1 px-2 text-xs opacity-100 transition-opacity sm:opacity-0 sm:focus-visible:opacity-100 sm:group-hover:opacity-100"
          aria-label={`卸载 ${display.name}`}
          title={`卸载 ${display.name}`}
        >
          {uninstalling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          <span>卸载</span>
        </Button>
      ) : null}
    </article>
  );
}

function ScienceSkillCard({
  enableHref,
  installDisabled,
  installed,
  installing,
  onInstall,
  skill,
}: {
  enableHref: string;
  installDisabled: boolean;
  installed: boolean;
  installing: boolean;
  onInstall: (skill: ScienceSkillSnapshot) => void;
  skill: ScienceSkillSnapshot;
}) {
  const category = SCIENCE_CATEGORY_BY_ID.get(skill.categoryId);
  const display = scienceSkillDisplayText(skill, category);
  const label = display.name.trim().charAt(0).toUpperCase() || "S";

  return (
    <article
      className={cn(CARD_CLASS, "min-h-[120px] items-start gap-4 px-4 py-4")}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-primary">
        {label}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-6">
              {display.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
              {display.description}
            </p>
          </div>
          {installed ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2"
              title={`启用 ${display.name}`}
            >
              <Link
                href={enableHref}
                aria-label={`启用 ${display.name}`}
              >
                <MessageCircle className="h-4 w-4" />
                启用
              </Link>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onInstall(skill)}
              disabled={installDisabled || installing}
              className="h-8 shrink-0 px-2"
              title={`安装 ${display.name}`}
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              {installing ? "安装中" : "安装"}
            </Button>
          )}
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
  const [activeTab, setActiveTab] = useState<SkillsTab>(SCIENCE_MARKET_TAB);
  const [addSkillMenuOpen, setAddSkillMenuOpen] = useState(false);
  const [uploadSkillDialogOpen, setUploadSkillDialogOpen] = useState(false);
  const [uploadSkillMode, setUploadSkillMode] =
    useState<UploadSkillMode>(UPLOAD_LOCAL_MODE);
  const [importingSkill, setImportingSkill] = useState<SkillImportType | null>(
    null
  );
  const [installingScienceSkillIds, setInstallingScienceSkillIds] = useState<
    Set<string>
  >(() => new Set());
  const [uninstallingSkillKey, setUninstallingSkillKey] = useState<
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
  const [storedWorkbenchHref, setStoredWorkbenchHref] = useState<string | null>(
    null
  );
  const [detailSkill, setDetailSkill] = useState<SkillEntry | null>(null);
  const addSkillMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const workbenchHref = useMemo(
    () => storedWorkbenchHref ?? workbenchHrefFromSearchParams(searchParams),
    [searchParams, storedWorkbenchHref]
  );
  const chatComposerHref = useMemo(
    () => withChatComposerHash(workbenchHref),
    [workbenchHref]
  );
  const skillCreatorHref = useMemo(
    () =>
      withEnabledSkill(
        withComposerDraft(workbenchHref, SKILL_CREATOR_DRAFT),
        SKILL_CREATOR_SKILL_ID
      ),
    [workbenchHref]
  );
  const actionBusy =
    loading ||
    importingSkill !== null ||
    uninstallingSkillKey !== null ||
    pickingLocalFolder ||
    checkingStatus ||
    restarting;
  const preparedSearchQuery = useMemo(
    () => prepareSearchQuery(searchQuery),
    [searchQuery]
  );

  useEffect(() => {
    const hasExplicitWorkbenchTarget =
      Boolean(searchParams.get("returnTo")) ||
      Boolean(searchParams.get("threadId")) ||
      Boolean(searchParams.get("workspaceId"));

    if (hasExplicitWorkbenchTarget) {
      setStoredWorkbenchHref(null);
      return;
    }

    try {
      const stored = safeWorkbenchHref(
        window.localStorage.getItem(WORKBENCH_RETURN_STORAGE_KEY)
      );
      setStoredWorkbenchHref(stored);
    } catch {
      setStoredWorkbenchHref(null);
    }
  }, [searchParams]);
  const featuredSkills = useMemo(
    () =>
      data.skills
        .filter(isFeaturedSkill)
        .sort(
          (left, right) => featuredSkillRank(left) - featuredSkillRank(right)
        ),
    [data.skills]
  );
  const filteredDefaultSkills = useMemo(
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
  const selectedSkills = useMemo(
    () => data.skills.filter((skill) => selectedSkillKeys.has(skill.key)),
    [data.skills, selectedSkillKeys]
  );
  const installedScienceSkills = useMemo(
    () =>
      selectedSkills.filter((skill) =>
        Boolean(scienceSkillIdForInstalledSkill(skill))
      ),
    [selectedSkills]
  );
  const importedSkills = useMemo(
    () =>
      selectedSkills.filter(
        (skill) =>
          !isFeaturedSkill(skill) && !scienceSkillIdForInstalledSkill(skill)
      ),
    [selectedSkills]
  );
  const filteredInstalledScienceSkills = useMemo(
    () =>
      filterAndRankBySearch(
        installedScienceSkills,
        preparedSearchQuery,
        searchDocumentForSkill
      ),
    [installedScienceSkills, preparedSearchQuery]
  );
  const filteredImportedSkills = useMemo(
    () =>
      filterAndRankBySearch(
        importedSkills,
        preparedSearchQuery,
        searchDocumentForSkill
      ),
    [importedSkills, preparedSearchQuery]
  );
  const installedSkillCount =
    featuredSkills.length +
    installedScienceSkills.length +
    importedSkills.length;
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

  async function saveSelectedSkills(updateSelected: SelectedSkillsUpdate) {
    const run = selectedSaveQueueRef.current.then(async () => {
      const currentResponse = await fetch("/api/skills", {
        cache: "no-store",
      });
      const currentPayload = await currentResponse.json();
      if (!currentResponse.ok) {
        throw new Error(currentPayload.error || "技能加载失败");
      }

      const currentData = currentPayload as SkillsConfigResponse;
      const currentSelected = new Set(currentData.selected);
      const nextSelected =
        typeof updateSelected === "function"
          ? updateSelected(currentSelected)
          : updateSelected;

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
    });

    selectedSaveQueueRef.current = run.catch(() => undefined);
    return run;
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
      closeDialogOnSuccess?: boolean;
      goToInstalled?: boolean;
      successMessage?: (importedCount: number) => string;
      suppressGlobalBusy?: boolean;
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

    const shouldShowGlobalBusy = !options.suppressGlobalBusy;
    if (shouldShowGlobalBusy) {
      setImportingSkill(type);
    }
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
      await saveSelectedSkills((currentSelected) => {
        const nextSelected = new Set([
          ...currentSelected,
          ...importResult.selected,
        ]);
        for (const importedKey of importResult.imported) {
          nextSelected.add(importedKey);
        }
        return nextSelected;
      });

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
      if (options.closeDialogOnSuccess) {
        setUploadSkillDialogOpen(false);
      }
      if (options.goToInstalled) {
        setActiveTab(INSTALLED_SKILLS_TAB);
      }
    } catch (importError) {
      const message =
        importError instanceof Error ? importError.message : "技能安装失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      if (shouldShowGlobalBusy) {
        setImportingSkill(null);
      }
    }
  }

  async function pickAndInstallLocalSkill(
    options: {
      closeDialogOnSuccess?: boolean;
      forcePicker?: boolean;
      goToInstalled?: boolean;
    } = {}
  ) {
    const typedSource = options.forcePicker ? "" : localSource.trim();
    if (typedSource) {
      await importAndInstallSkill("local", typedSource, {
        clearInput: true,
        closeDialogOnSuccess: options.closeDialogOnSuccess,
        goToInstalled: options.goToInstalled,
      });
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
      await importAndInstallSkill("local", payload.path, {
        clearInput: true,
        closeDialogOnSuccess: options.closeDialogOnSuccess,
        goToInstalled: options.goToInstalled,
      });
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
    if (
      installedScienceSkillIds.has(skill.id) ||
      installingScienceSkillIds.has(skill.id)
    ) {
      return;
    }

    setInstallingScienceSkillIds((current) => {
      const next = new Set(current);
      next.add(skill.id);
      return next;
    });
    const display = scienceSkillDisplayText(
      skill,
      SCIENCE_CATEGORY_BY_ID.get(skill.categoryId)
    );
    try {
      await importAndInstallSkill("cloud", skill.installUrl, {
        clearInput: false,
        suppressGlobalBusy: true,
        successMessage: () => `已安装「${display.name}」技能`,
      });
    } finally {
      setInstallingScienceSkillIds((current) => {
        const next = new Set(current);
        next.delete(skill.id);
        return next;
      });
    }
  }

  async function uninstallSkill(skill: SkillEntry) {
    if (actionBusy) {
      return;
    }

    const display = displayTextForSkill(skill);
    setUninstallingSkillKey(skill.key);
    setError(null);
    try {
      await saveSelectedSkills((currentSelected) => {
        const nextSelected = new Set(currentSelected);
        nextSelected.delete(skill.key);
        return nextSelected;
      });
      toast.success(`已卸载「${display.name}」技能`, {
        position: "top-center",
      });
    } catch (uninstallError) {
      const message =
        uninstallError instanceof Error
          ? uninstallError.message
          : "技能卸载失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setUninstallingSkillKey(null);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!addSkillMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        addSkillMenuRef.current &&
        !addSkillMenuRef.current.contains(event.target as Node)
      ) {
        setAddSkillMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAddSkillMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [addSkillMenuOpen]);

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
      <header className="flex h-12 items-center gap-3 border-b border-border px-6">
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

      <main className="mx-auto w-full max-w-6xl flex-1 overflow-x-hidden px-6 py-4">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
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
            <div
              ref={addSkillMenuRef}
              className="relative"
            >
              <Button
                type="button"
                variant="default"
                className="h-10 w-full shrink-0 rounded-full px-4 sm:w-auto"
                onClick={() => setAddSkillMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={addSkillMenuOpen}
              >
                <Plus className="h-4 w-4" />
                添加技能
              </Button>

              {addSkillMenuOpen ? (
                <div
                  role="menu"
                  aria-label="添加技能"
                  className="absolute right-0 top-12 z-30 w-48 rounded-lg border border-border bg-popover p-2 shadow-lg shadow-black/10"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex h-10 w-full items-center rounded-md px-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => {
                      setUploadSkillMode(UPLOAD_LOCAL_MODE);
                      setUploadSkillDialogOpen(true);
                      setAddSkillMenuOpen(false);
                    }}
                  >
                    上传技能
                  </button>
                  <Link
                    href={skillCreatorHref}
                    role="menuitem"
                    className="flex h-10 w-full items-center rounded-md px-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => setAddSkillMenuOpen(false)}
                  >
                    创建技能
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as SkillsTab)}
          className="gap-6"
        >
          <div className="border-b border-border">
            <TabsList className="h-auto gap-6 rounded-none bg-transparent p-0">
              <TabsTrigger
                value={SCIENCE_MARKET_TAB}
                className="data-[state=active]:[&_span]:bg-primary/10 relative h-11 rounded-none bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:-bottom-px after:left-0 after:right-0 after:h-[3px] after:rounded-full after:bg-transparent after:content-[''] hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:bg-primary data-[state=active]:[&_span]:text-primary"
              >
                精选科学技能
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors">
                  {SCIENCE_SKILL_SOURCE.total}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value={INSTALLED_SKILLS_TAB}
                className="data-[state=active]:[&_span]:bg-primary/10 relative h-11 rounded-none bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:-bottom-px after:left-0 after:right-0 after:h-[3px] after:rounded-full after:bg-transparent after:content-[''] hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:bg-primary data-[state=active]:[&_span]:text-primary"
              >
                已安装技能
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors">
                  {installedSkillCount}
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value={SCIENCE_MARKET_TAB}>
            <section className="mb-8">
              <div className="mb-5">
                <div className="min-w-0">
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    快照来自 InternScience/scp，点击安装时会从 GitHub
                    下载对应技能目录。
                    <a
                      href="https://scphub.intern-ai.org.cn/"
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      SCPHub 提供了 200+ 高质量科学领域技能
                      <ExternalLink
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </a>
                  </p>
                </div>
              </div>

              <div
                className="mb-3 flex flex-wrap gap-2"
                role="tablist"
                aria-label="科学技能分类"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-9 rounded-full border px-3 text-[13px] shadow-none transition-colors",
                    scienceCategoryId === ALL_SCIENCE_CATEGORY_ID
                      ? "text-primary-foreground hover:!bg-primary/90 hover:!text-primary-foreground border-primary bg-primary"
                      : "border-border bg-background text-muted-foreground hover:!border-foreground/20 hover:!bg-muted/70 hover:!text-foreground dark:bg-transparent dark:hover:!border-white/20 dark:hover:!bg-white/10 dark:hover:!text-white"
                  )}
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
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-9 rounded-full border px-3 text-[13px] shadow-none transition-colors",
                      scienceCategoryId === category.id
                        ? "text-primary-foreground hover:!bg-primary/90 hover:!text-primary-foreground border-primary bg-primary"
                        : "border-border bg-background text-muted-foreground hover:!border-foreground/20 hover:!bg-muted/70 hover:!text-foreground dark:bg-transparent dark:hover:!border-white/20 dark:hover:!bg-white/10 dark:hover:!text-white"
                    )}
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
                <div className="mb-6 max-w-3xl border-t border-border/70 pt-3 text-sm leading-6 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {activeScienceCategory.name}：
                  </span>
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
                      enableHref={withEnabledSkill(workbenchHref, skill.id)}
                      installDisabled={loading}
                      installed={installedScienceSkillIds.has(skill.id)}
                      installing={installingScienceSkillIds.has(skill.id)}
                      onInstall={installScienceSkill}
                      skill={skill}
                    />
                  ))}
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value={INSTALLED_SKILLS_TAB}>
            <section className="space-y-8">
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <PackageCheck className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-sm font-semibold">默认通用技能</h2>
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    默认安装
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {featuredSkills.length}
                  </span>
                </div>

                {loading ? (
                  <SkillSkeleton />
                ) : featuredSkills.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    暂时没有默认通用技能
                  </div>
                ) : filteredDefaultSkills.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    没有找到匹配的默认通用技能
                  </div>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredDefaultSkills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.key}
                        group="default"
                        onOpenDetails={setDetailSkill}
                        skill={skill}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-sm font-semibold">已安装科学技能</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {installedScienceSkills.length}
                  </span>
                </div>

                {loading ? (
                  <SkillSkeleton />
                ) : installedScienceSkills.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    还没有安装科学技能
                  </div>
                ) : filteredInstalledScienceSkills.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    没有找到匹配的已安装科学技能
                  </div>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredInstalledScienceSkills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.key}
                        group="science"
                        onOpenDetails={setDetailSkill}
                        onUninstall={uninstallSkill}
                        skill={skill}
                        uninstalling={uninstallingSkillKey === skill.key}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <FolderPlus className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-sm font-semibold">导入技能</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {importedSkills.length}
                  </span>
                </div>

                {loading ? (
                  <SkillSkeleton />
                ) : importedSkills.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    还没有导入技能
                  </div>
                ) : filteredImportedSkills.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    没有找到匹配的导入技能
                  </div>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredImportedSkills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.key}
                        group="imported"
                        onOpenDetails={setDetailSkill}
                        onUninstall={uninstallSkill}
                        skill={skill}
                        uninstalling={uninstallingSkillKey === skill.key}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </TabsContent>
        </Tabs>

        {backendStatus?.status === "busy" && (
          <div className="mt-4 text-xs text-muted-foreground">
            技能已保存，后台空闲后会自动准备好。
          </div>
        )}
      </main>

      <Dialog
        open={uploadSkillDialogOpen}
        onOpenChange={setUploadSkillDialogOpen}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>上传技能</DialogTitle>
            <DialogDescription>
              从本地目录或云端地址上传已有技能。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div
              className="grid grid-cols-2 rounded-lg bg-muted p-1"
              role="tablist"
              aria-label="上传技能方式"
            >
              <button
                type="button"
                role="tab"
                aria-selected={uploadSkillMode === UPLOAD_LOCAL_MODE}
                className={cn(
                  "h-9 rounded-md text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
                  uploadSkillMode === UPLOAD_LOCAL_MODE
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setUploadSkillMode(UPLOAD_LOCAL_MODE)}
              >
                本地上传
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={uploadSkillMode === UPLOAD_CLOUD_MODE}
                className={cn(
                  "h-9 rounded-md text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
                  uploadSkillMode === UPLOAD_CLOUD_MODE
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setUploadSkillMode(UPLOAD_CLOUD_MODE)}
              >
                云端地址
              </button>
            </div>

            {uploadSkillMode === UPLOAD_LOCAL_MODE ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
                  <FolderPlus className="mx-auto h-8 w-8 text-muted-foreground" />
                  <div className="mt-3 text-sm font-medium">
                    选择本地技能目录
                  </div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    目录内需要包含 SKILL.md 文件
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    onClick={() =>
                      void pickAndInstallLocalSkill({
                        closeDialogOnSuccess: true,
                        forcePicker: true,
                        goToInstalled: true,
                      })
                    }
                    disabled={actionBusy}
                  >
                    {pickingLocalFolder || importingSkill === "local" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FolderPlus className="h-4 w-4" />
                    )}
                    选择目录并安装
                  </Button>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  适合已经下载到本机的技能。选择目录后会自动安装并出现在已安装技能里。
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-2">
                  <Label
                    htmlFor="skills-cloud-source"
                    className="text-xs text-muted-foreground"
                  >
                    云端地址
                  </Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="skills-cloud-source"
                      value={cloudSource}
                      onChange={(event) => setCloudSource(event.target.value)}
                      placeholder="github:owner/repo/path 或 https://github.com/owner/repo"
                      disabled={actionBusy}
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        void importAndInstallSkill("cloud", undefined, {
                          closeDialogOnSuccess: true,
                          goToInstalled: true,
                        })
                      }
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
                <div className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  支持 GitHub 仓库地址或 github:owner/repo/path 格式。
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
