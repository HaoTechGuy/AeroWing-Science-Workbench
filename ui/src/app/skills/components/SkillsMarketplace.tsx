"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CloudDownload,
  FolderPlus,
  KeyRound,
  Loader2,
  MessageCircle,
  PackageCheck,
  Plug,
  Search,
  Server,
  Sparkles,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  SkillConnectionsResponse,
  SkillImportType,
  SkillsConfigResponse,
} from "@/app/skills/types";

const CHAT_COMPOSER_HASH = "chat-composer";
const ENABLE_SKILL_QUERY_KEY = "enableSkill";
const ALL_SCIENCE_CATEGORY_ID = "all";
const DEFAULT_SCIENCE_CATEGORY_ID = ALL_SCIENCE_CATEGORY_ID;
const SCIENCE_MARKET_TAB = "science-market";
const INSTALLED_SKILLS_TAB = "installed-skills";
const CONNECTIONS_TAB = "connections";
const SKILL_IMPORT_TIMEOUT_MS = 95_000;
type SkillsTab =
  | typeof SCIENCE_MARKET_TAB
  | typeof INSTALLED_SKILLS_TAB
  | typeof CONNECTIONS_TAB;
type SkillsMarketplaceView = "all" | "skills" | "connections";
const UPLOAD_LOCAL_MODE = "local";
const UPLOAD_CLOUD_MODE = "cloud";
type UploadSkillMode = typeof UPLOAD_LOCAL_MODE | typeof UPLOAD_CLOUD_MODE;
type SelectedSkillsUpdate =
  | Set<string>
  | ((currentSelected: Set<string>) => Set<string>);

interface SkillsMarketplaceProps {
  embedded?: boolean;
  initialTab?: SkillsTab;
  view?: SkillsMarketplaceView;
}

function skillsTabFromSettingsHash(hash: string): SkillsTab | null {
  const normalized = hash.replace(/^#/, "");
  if (normalized === "settings-connectors") {
    return CONNECTIONS_TAB;
  }
  if (normalized === "settings-science-skills") {
    return SCIENCE_MARKET_TAB;
  }
  if (normalized === "settings-skills") {
    return INSTALLED_SKILLS_TAB;
  }
  return null;
}

function settingsHashFromSkillsTab(tab: SkillsTab): string {
  if (tab === CONNECTIONS_TAB) {
    return "settings-connectors";
  }
  if (tab === SCIENCE_MARKET_TAB) {
    return "settings-science-skills";
  }
  return "settings-skills";
}

function normalizeTabForView(
  tab: SkillsTab,
  view: SkillsMarketplaceView
): SkillsTab {
  if (view === "connections") {
    return CONNECTIONS_TAB;
  }
  if (view === "skills" && tab === CONNECTIONS_TAB) {
    return INSTALLED_SKILLS_TAB;
  }
  return tab;
}
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
const SCP_EXAMPLE_MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      "scp-drugsda-tool": {
        type: "http",
        url: "https://scp.intern-ai.org.cn/api/v1/mcp/2/DrugSDA-Tool",
        headers: {
          "SCP-HUB-API-KEY": "${SCP_HUB_API_KEY}",
        },
        allowedTools: [
          "calculate_mol_basic_info",
          "calculate_mol_hbond",
          "calculate_mol_hydrophobicity",
          "calculate_mol_topology",
        ],
      },
      "scp-drugsda-model": {
        type: "http",
        url: "https://scp.intern-ai.org.cn/api/v1/mcp/3/DrugSDA-Model",
        headers: {
          "SCP-HUB-API-KEY": "${SCP_HUB_API_KEY}",
        },
        allowedTools: ["pred_molecule_admet"],
      },
    },
  },
  null,
  2
);

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

function EmptyState({
  children,
  compact = false,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/20 px-4 text-sm text-muted-foreground",
        compact ? "py-3" : "py-6"
      )}
    >
      {children}
    </div>
  );
}

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

function emptyConnections(): SkillConnectionsResponse {
  return {
    scp: {
      envKey: "SCP_HUB_API_KEY",
      apiKeySet: false,
      apiKeyPreview: "",
    },
    mcp: {
      configPath: ".mcp.json",
      exists: false,
      configText: '{\n  "mcpServers": {}\n}\n',
      serverCount: 0,
    },
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
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-primary before:content-[attr(data-label)]"
      data-label={label}
      aria-hidden="true"
    />
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
  enabled,
  group,
  onOpenDetails,
  onToggleEnabled,
  skill,
  updating,
}: {
  enabled: boolean;
  group: "default" | "science" | "imported";
  onOpenDetails: (skill: SkillEntry) => void;
  onToggleEnabled: (skill: SkillEntry, enabled: boolean) => void;
  skill: SkillEntry;
  updating?: boolean;
}) {
  const display = displayTextForSkill(skill);
  const isScienceGroup = group === "science";
  const sourceLabel =
    group === "default" ? "内置" : group === "science" ? "科学" : "导入";

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
          "pr-24"
        )}
        aria-label={`查看 ${display.name} 详情`}
      >
        <SkillGlyph skill={skill} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold leading-6">
              {display.name}
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {sourceLabel}
            </span>
          </div>
          <div className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {display.description}
          </div>
        </div>
      </button>
      <div className="absolute right-4 top-4 flex items-center gap-2">
        {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        <Switch
          checked={enabled}
          disabled={updating}
          onCheckedChange={(checked) => onToggleEnabled(skill, checked)}
          aria-label={`${enabled ? "停用" : "启用"} ${display.name}`}
          title={`${enabled ? "停用" : "启用"} ${display.name}`}
        />
      </div>
    </article>
  );
}

function ScienceSkillCard({
  enabled,
  enableHref,
  installDisabled,
  installedSkill,
  installing,
  onInstall,
  onToggleEnabled,
  updating,
  skill,
}: {
  enabled: boolean;
  enableHref: string;
  installDisabled: boolean;
  installedSkill?: SkillEntry;
  installing: boolean;
  onInstall: (skill: ScienceSkillSnapshot) => void;
  onToggleEnabled: (skill: SkillEntry, enabled: boolean) => void;
  updating?: boolean;
  skill: ScienceSkillSnapshot;
}) {
  const category = SCIENCE_CATEGORY_BY_ID.get(skill.categoryId);
  const display = scienceSkillDisplayText(skill, category);
  const label = display.name.trim().charAt(0).toUpperCase() || "S";
  const installed = Boolean(installedSkill);

  return (
    <article
      className={cn(CARD_CLASS, "min-h-[120px] items-start gap-4 px-4 py-4")}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-semibold text-primary before:content-[attr(data-label)]"
        data-label={label}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="truncate text-sm font-semibold leading-6">
                {display.name}
              </h3>
              {installed ? (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  已安装
                </span>
              ) : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
              {display.description}
            </p>
          </div>
          {installed && installedSkill ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-8 px-2"
                title={`在当前会话使用 ${display.name}`}
              >
                <Link
                  href={enableHref}
                  aria-label={`在当前会话使用 ${display.name}`}
                >
                  <MessageCircle className="h-4 w-4" />
                  会话
                </Link>
              </Button>
              {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <Switch
                checked={enabled}
                disabled={updating}
                onCheckedChange={(checked) =>
                  onToggleEnabled(installedSkill, checked)
                }
                aria-label={`${enabled ? "停用" : "启用"} ${display.name}`}
                title={`${enabled ? "停用" : "启用"} ${display.name}`}
              />
            </div>
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

export function SkillsMarketplace({
  embedded = false,
  initialTab = INSTALLED_SKILLS_TAB,
  view = "all",
}: SkillsMarketplaceProps) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<SkillsConfigResponse>(() => emptyResponse());
  const [connections, setConnections] = useState<SkillConnectionsResponse>(() =>
    emptyConnections()
  );
  const [loading, setLoading] = useState(true);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionsSaving, setConnectionsSaving] = useState<
    "scp" | "mcp" | null
  >(null);
  const [activeTab, setActiveTab] = useState<SkillsTab>(() =>
    normalizeTabForView(initialTab, view)
  );
  const [uploadSkillDialogOpen, setUploadSkillDialogOpen] = useState(false);
  const [uploadSkillMode, setUploadSkillMode] =
    useState<UploadSkillMode>(UPLOAD_LOCAL_MODE);
  const [importingSkill, setImportingSkill] = useState<SkillImportType | null>(
    null
  );
  const [installingScienceSkillIds, setInstallingScienceSkillIds] = useState<
    Set<string>
  >(() => new Set());
  const [updatingSkillKey, setUpdatingSkillKey] = useState<
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
  const [scpApiKey, setScpApiKey] = useState("");
  const [mcpConfigText, setMcpConfigText] = useState(
    emptyConnections().mcp.configText
  );
  const [scienceCategoryId, setScienceCategoryId] = useState(
    DEFAULT_SCIENCE_CATEGORY_ID
  );
  const [storedWorkbenchHref, setStoredWorkbenchHref] = useState<string | null>(
    null
  );
  const [detailSkill, setDetailSkill] = useState<SkillEntry | null>(null);
  const selectedSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const workbenchHref = useMemo(
    () => storedWorkbenchHref ?? workbenchHrefFromSearchParams(searchParams),
    [searchParams, storedWorkbenchHref]
  );
  const actionBusy =
    loading ||
    importingSkill !== null ||
    updatingSkillKey !== null ||
    connectionsSaving !== null ||
    pickingLocalFolder ||
    checkingStatus ||
    restarting;
  const preparedSearchQuery = useMemo(
    () => prepareSearchQuery(searchQuery),
    [searchQuery]
  );
  const connectionsOnly = view === "connections";
  const skillsOnly = view === "skills";
  const scrollableSkillContent = embedded && skillsOnly;
  const activeTabForView = normalizeTabForView(activeTab, view);

  useEffect(() => {
    if (!embedded || connectionsOnly || typeof window === "undefined") {
      return;
    }

    const syncTabFromHash = () => {
      const nextTab = skillsTabFromSettingsHash(window.location.hash);
      if (nextTab && !(skillsOnly && nextTab === CONNECTIONS_TAB)) {
        setActiveTab(nextTab);
      }
    };

    syncTabFromHash();
    window.addEventListener("hashchange", syncTabFromHash);
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, [connectionsOnly, embedded, skillsOnly]);

  const handleActiveTabChange = useCallback(
    (value: string) => {
      const nextTab = normalizeTabForView(value as SkillsTab, view);
      setActiveTab(nextTab);

      if (!embedded || connectionsOnly || typeof window === "undefined") {
        return;
      }

      const nextHash = settingsHashFromSkillsTab(nextTab);
      if (window.location.hash !== `#${nextHash}`) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}#${nextHash}`
        );
      }
    },
    [connectionsOnly, embedded, view]
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
  const installedScienceSkillEntries = useMemo(() => {
    const entries = new Map<string, SkillEntry>();
    for (const skill of data.skills) {
      const scienceSkillId = scienceSkillIdForInstalledSkill(skill);
      if (scienceSkillId) {
        entries.set(scienceSkillId, skill);
      }
    }
    return entries;
  }, [data.skills]);
  const enabledScienceSkillIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [scienceSkillId, skill] of installedScienceSkillEntries) {
      if (selectedSkillKeys.has(skill.key)) {
        ids.add(scienceSkillId);
      }
    }
    return ids;
  }, [installedScienceSkillEntries, selectedSkillKeys]);
  const installedScienceSkills = useMemo(
    () =>
      data.skills.filter((skill) =>
        Boolean(scienceSkillIdForInstalledSkill(skill))
      ),
    [data.skills]
  );
  const availableScienceSkills = useMemo(
    () =>
      SCIENCE_SKILLS.filter(
        (skill) => !installedScienceSkillEntries.has(skill.id)
      ),
    [installedScienceSkillEntries]
  );
  const availableScienceCategoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of availableScienceSkills) {
      counts.set(skill.categoryId, (counts.get(skill.categoryId) ?? 0) + 1);
    }
    return counts;
  }, [availableScienceSkills]);
  const importedSkills = useMemo(
    () =>
      data.skills.filter(
        (skill) =>
          !isFeaturedSkill(skill) && !scienceSkillIdForInstalledSkill(skill)
      ),
    [data.skills]
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
        ? availableScienceSkills
        : availableScienceSkills.filter(
            (skill) => skill.categoryId === scienceCategoryId
          );

    return filterAndRankBySearch(
      categorySkills,
      preparedSearchQuery,
      searchDocumentForScienceSkill
    );
  }, [availableScienceSkills, preparedSearchQuery, scienceCategoryId]);

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

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/skills/connections", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "连接配置加载失败");
      }
      const nextConnections = payload as SkillConnectionsResponse;
      setConnections(nextConnections);
      setMcpConfigText(nextConnections.mcp.configText);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "连接配置加载失败"
      );
    } finally {
      setConnectionsLoading(false);
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
      setConnections((current) => ({
        ...current,
        requiresRestart: false,
      }));
    } catch (restartError) {
      setError(
        restartError instanceof Error ? restartError.message : "后台应用失败"
      );
    } finally {
      setRestarting(false);
    }
  }, []);

  async function saveScpConfig(options: { clear?: boolean } = {}) {
    if (actionBusy) {
      return;
    }

    if (!options.clear && !scpApiKey.trim()) {
      toast.error(
        connections.scp.apiKeySet
          ? "当前 SCP Key 保持不变。"
          : "请填写 SCP Hub API Key。",
        { position: "top-center" }
      );
      return;
    }

    setConnectionsSaving("scp");
    setError(null);
    try {
      const response = await fetch("/api/skills/connections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          options.clear
            ? { clearScpApiKey: true }
            : { scpApiKey: scpApiKey.trim() }
        ),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "SCP 配置保存失败");
      }
      const nextConnections = payload as SkillConnectionsResponse;
      setConnections(nextConnections);
      setScpApiKey("");
      setBackendStatus(null);
      if (nextConnections.requiresRestart) {
        setAutoRestart(true);
      }
      toast.success(nextConnections.message || "SCP 配置已保存", {
        position: "top-center",
      });
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "SCP 配置保存失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setConnectionsSaving(null);
    }
  }

  async function saveMcpConfig() {
    if (actionBusy) {
      return;
    }

    setConnectionsSaving("mcp");
    setError(null);
    try {
      const response = await fetch("/api/skills/connections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpConfigText }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "MCP 配置保存失败");
      }
      const nextConnections = payload as SkillConnectionsResponse;
      setConnections(nextConnections);
      setMcpConfigText(nextConnections.mcp.configText);
      setBackendStatus(null);
      if (nextConnections.requiresRestart) {
        setAutoRestart(true);
      }
      toast.success(nextConnections.message || "MCP 配置已保存", {
        position: "top-center",
      });
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "MCP 配置保存失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setConnectionsSaving(null);
    }
  }

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
        type === "local" ? "请输入本地技能路径" : "请输入 GitHub 技能地址",
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
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      SKILL_IMPORT_TIMEOUT_MS
    );
    try {
      const response = await fetch("/api/skills/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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
      const timedOut =
        importError instanceof Error &&
        (importError.name === "AbortError" ||
          importError.name === "TimeoutError");
      const message =
        timedOut
          ? "技能安装超时，请检查网络或代理后重试。"
          : importError instanceof Error
            ? importError.message
            : "技能安装失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      window.clearTimeout(timeout);
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
      installedScienceSkillEntries.has(skill.id) ||
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
    if (!connections.scp.apiKeySet) {
      toast.info("科学技能可先导入；调用 SCP 工具前需要先配置 SCP Hub Key。", {
        position: "top-center",
      });
    }
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

  async function toggleSkillEnabled(skill: SkillEntry, enabled: boolean) {
    if (actionBusy) {
      return;
    }

    const display = displayTextForSkill(skill);
    setUpdatingSkillKey(skill.key);
    setError(null);
    try {
      await saveSelectedSkills((currentSelected) => {
        const nextSelected = new Set(currentSelected);
        if (enabled) {
          nextSelected.add(skill.key);
        } else {
          nextSelected.delete(skill.key);
        }
        return nextSelected;
      });
      toast.success(`${enabled ? "已启用" : "已停用"}「${display.name}」`, {
        position: "top-center",
      });
    } catch (toggleError) {
      const message =
        toggleError instanceof Error ? toggleError.message : "技能更新失败";
      setError(message);
      toast.error(message, { position: "top-center" });
    } finally {
      setUpdatingSkillKey(null);
    }
  }

  useEffect(() => {
    if (connectionsOnly) {
      setLoading(false);
    } else {
      void loadSkills();
    }
    void loadConnections();
  }, [connectionsOnly, loadConnections, loadSkills]);

  useEffect(() => {
    const requiresRestart =
      data.requiresRestart === true || connections.requiresRestart === true;
    if (!autoRestart || !requiresRestart || actionBusy) {
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
    connections.requiresRestart,
    data.requiresRestart,
    restartBackendWhenIdle,
  ]);

  return (
    <div
      className={cn(
        "overflow-x-hidden text-foreground",
        embedded
          ? "flex h-full min-h-0 w-full flex-col bg-transparent"
          : "flex min-h-[calc(100vh-var(--app-footer-height))] flex-col bg-background"
      )}
      onKeyDownCapture={(event) => {
        if (!embedded || event.key !== "Enter") {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.tagName === "INPUT") {
          event.preventDefault();
        }
      }}
    >
      {!embedded && (
        <header className="flex h-16 items-center justify-between border-b border-border px-6">
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
              <h1 className="truncate text-xl font-semibold">能力配置</h1>
              <div className="truncate text-xs text-muted-foreground">
                Skills · 管理项目默认启用的技能，也可以为当前会话临时添加
              </div>
            </div>
          </div>
        </header>
      )}

      <main
        className={cn(
          "w-full overflow-x-hidden",
          embedded
            ? "flex h-full min-h-0 flex-col px-0 py-0"
            : "mx-auto max-w-6xl flex-1 px-6 py-6"
        )}
      >
        {embedded && (
          <>
            <span
              id="settings-science-skills"
              className="block scroll-mt-24"
              aria-hidden="true"
            />
          </>
        )}
        {activeTabForView !== CONNECTIONS_TAB ? (
          <div
            className={cn(
              "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between",
              embedded ? "mb-4" : "mb-5"
            )}
          >
            <div
              className={cn(
                "relative w-full",
                embedded ? "lg:max-w-[440px]" : "lg:max-w-sm"
              )}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={
                  activeTabForView === SCIENCE_MARKET_TAB
                    ? "搜索科学技能库"
                    : "搜索已安装技能"
                }
                className={cn(
                  "rounded-md pl-9",
                  embedded ? "h-9" : "h-10"
                )}
              />
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:justify-end">
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full shrink-0 rounded-md px-4 sm:w-auto",
                  embedded ? "h-9" : "h-10"
                )}
                onClick={() => {
                  setUploadSkillMode(UPLOAD_LOCAL_MODE);
                  setUploadSkillDialogOpen(true);
                }}
              >
                <FolderPlus className="h-4 w-4" />
                添加本地技能
              </Button>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "w-full shrink-0 rounded-md px-4 sm:w-auto",
                  embedded ? "h-9" : "h-10"
                )}
                onClick={() => {
                  setUploadSkillMode(UPLOAD_CLOUD_MODE);
                  setUploadSkillDialogOpen(true);
                }}
              >
                <CloudDownload className="h-4 w-4" />
                从 GitHub 导入
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex items-center justify-between gap-3",
              embedded ? "mb-4" : "mb-5"
            )}
          >
            <div className="min-w-0 text-sm text-muted-foreground">
              连接配置保存在本地 `.env` 和 `.mcp.json`，保存后后台会自动应用。
            </div>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "shrink-0 rounded-md px-4",
                embedded ? "h-9" : "h-10"
              )}
              onClick={() => void loadConnections()}
              disabled={actionBusy || connectionsLoading}
            >
              {connectionsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              刷新
            </Button>
          </div>
        )}

        {error && (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <Tabs
          value={activeTabForView}
          onValueChange={handleActiveTabChange}
          className={cn(
            embedded ? "gap-4" : "gap-6",
            scrollableSkillContent && "min-h-0 flex-1"
          )}
        >
          {!connectionsOnly && (
            <div className="border-b border-border">
            <TabsList
              className={cn(
                "h-auto rounded-none bg-transparent p-0",
                embedded ? "gap-5" : "gap-6"
              )}
            >
              <TabsTrigger
                type="button"
                value={INSTALLED_SKILLS_TAB}
                className={cn(
                  "data-[state=active]:[&_span]:bg-primary/10 relative rounded-none bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:-bottom-px after:left-0 after:right-0 after:rounded-full after:bg-transparent after:content-[''] hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:bg-primary data-[state=active]:[&_span]:text-primary",
                  embedded ? "h-10 after:h-0.5" : "h-11 after:h-[3px]"
                )}
              >
                技能管理
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors">
                  {data.skills.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                type="button"
                value={SCIENCE_MARKET_TAB}
                className={cn(
                  "data-[state=active]:[&_span]:bg-primary/10 relative rounded-none bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:-bottom-px after:left-0 after:right-0 after:rounded-full after:bg-transparent after:content-[''] hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:bg-primary data-[state=active]:[&_span]:text-primary",
                  embedded ? "h-10 after:h-0.5" : "h-11 after:h-[3px]"
                )}
              >
                科学技能库
                <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors">
                  {SCIENCE_SKILL_SOURCE.total}
                </span>
              </TabsTrigger>
              {!skillsOnly && (
                <TabsTrigger
                  type="button"
                  value={CONNECTIONS_TAB}
                  className={cn(
                    "data-[state=active]:[&_span]:bg-primary/10 relative rounded-none bg-transparent px-0 text-sm font-medium text-muted-foreground shadow-none transition-colors after:absolute after:-bottom-px after:left-0 after:right-0 after:rounded-full after:bg-transparent after:content-[''] hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:font-bold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:after:bg-primary data-[state=active]:[&_span]:text-primary",
                    embedded ? "h-10 after:h-0.5" : "h-11 after:h-[3px]"
                  )}
                >
                  连接配置
                  <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors">
                    {connections.scp.apiKeySet ? "SCP" : "待配置"}
                  </span>
                </TabsTrigger>
              )}
            </TabsList>
            </div>
          )}

          <TabsContent
            value={SCIENCE_MARKET_TAB}
            className={cn(
              scrollableSkillContent &&
                "-mr-2 min-h-0 overflow-y-auto overscroll-contain pr-2"
            )}
          >
            <section
              className={cn(
                embedded ? "space-y-5" : "mb-8 space-y-8"
              )}
            >
              <div
                className={cn(
                  "flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
                  connections.scp.apiKeySet
                    ? "border-primary/20 bg-primary/5 text-foreground"
                    : "border-amber-300/60 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100"
                )}
              >
                <div className="flex min-w-0 items-start gap-3">
                  {connections.scp.apiKeySet ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium">
                      {connections.scp.apiKeySet
                        ? "SCP Hub 已配置"
                        : "使用科学技能前需要配置 SCP Hub"}
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 text-xs leading-5",
                        connections.scp.apiKeySet
                          ? "text-muted-foreground"
                          : "text-amber-800 dark:text-amber-200"
                      )}
                    >
                      科学技能会调用 SCP Hub 上的 MCP 工具；安装可以先完成，真正调用前需要可用的 SCP Key 和对应 MCP server。
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 bg-background/80"
                  onClick={() => {
                    if (skillsOnly && typeof window !== "undefined") {
                      window.location.hash = "settings-connectors";
                    } else {
                      setActiveTab(CONNECTIONS_TAB);
                    }
                  }}
                >
                  <KeyRound className="h-4 w-4" />
                  {connections.scp.apiKeySet ? "查看配置" : "去配置"}
                </Button>
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-sm font-semibold">已导入科学技能</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {installedScienceSkills.length}
                  </span>
                </div>

                {loading ? (
                  <SkillSkeleton />
                ) : installedScienceSkills.length === 0 ? (
                  <EmptyState compact>还没有导入科学技能</EmptyState>
                ) : filteredInstalledScienceSkills.length === 0 ? (
                  <EmptyState compact>没有找到匹配的科学技能</EmptyState>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredInstalledScienceSkills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.key}
                        enabled={selectedSkillKeys.has(skill.key)}
                        group="science"
                        onOpenDetails={setDetailSkill}
                        onToggleEnabled={toggleSkillEnabled}
                        skill={skill}
                        updating={updatingSkillKey === skill.key}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-5">
                  <div className="mb-4 flex items-center gap-2">
                    <CloudDownload className="h-3.5 w-3.5 text-primary" />
                    <h2 className="text-sm font-semibold">可导入科学技能</h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {availableScienceSkills.length}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                      科学技能库是可导入的技能来源；导入后可设为项目默认启用，也可临时加入当前会话。
                    </p>
                  </div>
                </div>

                <div className="-mx-1 mb-3 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <div
                    className="flex min-w-max gap-2"
                    role="tablist"
                    aria-label="科学技能分类"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-[13px] shadow-none transition-colors",
                        scienceCategoryId === ALL_SCIENCE_CATEGORY_ID
                          ? "text-primary-foreground hover:!bg-primary/90 hover:!text-primary-foreground border-primary bg-primary"
                          : "border-border bg-background text-muted-foreground hover:!border-foreground/20 hover:!bg-muted/70 hover:!text-foreground dark:bg-transparent dark:hover:!border-white/20 dark:hover:!bg-white/10 dark:hover:!text-white"
                      )}
                      onClick={() =>
                        setScienceCategoryId(ALL_SCIENCE_CATEGORY_ID)
                      }
                      role="tab"
                      aria-selected={
                        scienceCategoryId === ALL_SCIENCE_CATEGORY_ID
                      }
                    >
                      全部
                      <span className="ml-1 text-[11px] opacity-75">
                        {availableScienceSkills.length}
                      </span>
                    </Button>
                    {SCIENCE_SKILL_CATEGORIES.map((category) => (
                      <Button
                        key={category.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-[13px] shadow-none transition-colors",
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
                          {availableScienceCategoryCounts.get(category.id) ??
                            0}
                        </span>
                      </Button>
                    ))}
                  </div>
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
                  <EmptyState>
                    {availableScienceSkills.length === 0
                      ? "科学技能库里的技能都已导入"
                      : "没有找到匹配的未导入科学技能"}
                  </EmptyState>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredScienceSkills.map((skill) => (
                      <ScienceSkillCard
                        key={skill.id}
                        enabled={enabledScienceSkillIds.has(skill.id)}
                        enableHref={withEnabledSkill(workbenchHref, skill.id)}
                        installDisabled={loading}
                        installedSkill={installedScienceSkillEntries.get(skill.id)}
                        installing={installingScienceSkillIds.has(skill.id)}
                        onInstall={installScienceSkill}
                        onToggleEnabled={toggleSkillEnabled}
                        skill={skill}
                        updating={
                          updatingSkillKey ===
                          installedScienceSkillEntries.get(skill.id)?.key
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </TabsContent>

          <TabsContent
            value={INSTALLED_SKILLS_TAB}
            className={cn(
              scrollableSkillContent &&
                "-mr-2 min-h-0 overflow-y-auto overscroll-contain pr-2"
            )}
          >
            <section className={embedded ? "space-y-5" : "space-y-8"}>
              <div>
                <div className="mb-4 flex items-center gap-2">
                  <PackageCheck className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-sm font-semibold">内置技能</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {featuredSkills.length}
                  </span>
                </div>

                {loading ? (
                  <SkillSkeleton />
                ) : featuredSkills.length === 0 ? (
                  <EmptyState>暂时没有默认通用技能</EmptyState>
                ) : filteredDefaultSkills.length === 0 ? (
                  <EmptyState>没有找到匹配的默认通用技能</EmptyState>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredDefaultSkills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.key}
                        enabled={selectedSkillKeys.has(skill.key)}
                        group="default"
                        onOpenDetails={setDetailSkill}
                        onToggleEnabled={toggleSkillEnabled}
                        skill={skill}
                        updating={updatingSkillKey === skill.key}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-4 flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-sm font-semibold">科学技能</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {installedScienceSkills.length}
                  </span>
                </div>

                {loading ? (
                  <SkillSkeleton />
                ) : installedScienceSkills.length === 0 ? (
                  <EmptyState compact>还没有导入科学技能</EmptyState>
                ) : filteredInstalledScienceSkills.length === 0 ? (
                  <EmptyState compact>没有找到匹配的科学技能</EmptyState>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredInstalledScienceSkills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.key}
                        enabled={selectedSkillKeys.has(skill.key)}
                        group="science"
                        onOpenDetails={setDetailSkill}
                        onToggleEnabled={toggleSkillEnabled}
                        skill={skill}
                        updating={updatingSkillKey === skill.key}
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
                  <EmptyState compact>还没有导入技能</EmptyState>
                ) : filteredImportedSkills.length === 0 ? (
                  <EmptyState compact>没有找到匹配的导入技能</EmptyState>
                ) : (
                  <div className="grid w-full max-w-full grid-cols-1 gap-3 overflow-x-hidden lg:grid-cols-2">
                    {filteredImportedSkills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.key}
                        enabled={selectedSkillKeys.has(skill.key)}
                        group="imported"
                        onOpenDetails={setDetailSkill}
                        onToggleEnabled={toggleSkillEnabled}
                        skill={skill}
                        updating={updatingSkillKey === skill.key}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </TabsContent>

          {!skillsOnly && (
          <TabsContent value={CONNECTIONS_TAB}>
            <section className={embedded ? "space-y-4" : "space-y-6"}>
              <div className="rounded-lg border border-border bg-card/40">
                <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">SCP Hub</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        科学技能库里的远程工具需要 SCP Hub API Key。
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-medium",
                      connections.scp.apiKeySet
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {connections.scp.apiKeySet ? "已配置" : "未配置"}
                  </span>
                </div>

                <div className="space-y-4 px-5 py-5">
                  <div className="grid gap-2">
                    <Label
                      htmlFor="scp-api-key"
                      className="text-xs text-muted-foreground"
                    >
                      SCP_HUB_API_KEY
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="scp-api-key"
                        type="password"
                        value={scpApiKey}
                        onChange={(event) => setScpApiKey(event.target.value)}
                        placeholder={
                          connections.scp.apiKeySet
                            ? `已保存 ${connections.scp.apiKeyPreview}`
                            : "粘贴 SCP Hub API Key"
                        }
                        disabled={actionBusy || connectionsLoading}
                        className="min-w-0 flex-1"
                      />
                      <Button
                        type="button"
                        onClick={() => void saveScpConfig()}
                        disabled={
                          actionBusy || connectionsLoading || !scpApiKey.trim()
                        }
                        className="h-10"
                      >
                        {connectionsSaving === "scp" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <KeyRound className="h-4 w-4" />
                        )}
                        保存 SCP
                      </Button>
                      {connections.scp.apiKeySet ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void saveScpConfig({ clear: true })}
                          disabled={actionBusy || connectionsLoading}
                          className="h-10"
                        >
                          清除
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                    Key 只写入本地 .env；保存后后台会重新加载环境变量和 MCP server。
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card/40">
                <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                      <Server className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">MCP Servers</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        配置本地可加载的 MCP server；SCP endpoint 也走这里。
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-medium",
                      connections.mcp.error
                        ? "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-200"
                        : connections.mcp.serverCount > 0
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {connections.mcp.error
                      ? "JSON 错误"
                      : `${connections.mcp.serverCount} servers`}
                  </span>
                </div>

                <div className="space-y-4 px-5 py-5">
                  <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 truncate">
                      本地文件：{connections.mcp.configPath}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-full sm:w-auto"
                      onClick={() => setMcpConfigText(`${SCP_EXAMPLE_MCP_CONFIG}\n`)}
                      disabled={actionBusy || connectionsLoading}
                    >
                      填入 SCP 示例
                    </Button>
                  </div>

                  {connections.mcp.error ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                      {connections.mcp.error}
                    </div>
                  ) : null}

                  <div className="grid gap-2">
                    <Label
                      htmlFor="mcp-config-json"
                      className="text-xs text-muted-foreground"
                    >
                      .mcp.json
                    </Label>
                    <Textarea
                      id="mcp-config-json"
                      value={mcpConfigText}
                      onChange={(event) => setMcpConfigText(event.target.value)}
                      disabled={actionBusy || connectionsLoading}
                      spellCheck={false}
                      className="min-h-[260px] resize-y font-mono text-xs leading-5"
                    />
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs leading-5 text-muted-foreground">
                      Header 支持 `${"{SCP_HUB_API_KEY}"}` 这类环境变量引用。
                    </div>
                    <Button
                      type="button"
                      onClick={() => void saveMcpConfig()}
                      disabled={actionBusy || connectionsLoading}
                      className="h-10 w-full sm:w-auto"
                    >
                      {connectionsSaving === "mcp" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plug className="h-4 w-4" />
                      )}
                      保存 MCP
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </TabsContent>
          )}
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
            <DialogTitle>
              {uploadSkillMode === UPLOAD_LOCAL_MODE
                ? "添加本地技能"
                : "从 GitHub 导入技能"}
            </DialogTitle>
            <DialogDescription>
              添加后会出现在技能管理列表里，你可以决定是否设为项目默认启用。
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
                本地目录
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
                GitHub 地址
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
                    选择目录并添加
                  </Button>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  适合已经下载到本机的技能。选择目录后会导入列表，并默认启用。
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
                      导入
                    </Button>
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                  支持 GitHub 仓库地址、tree 链接或 github:owner/repo/path 格式。
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
