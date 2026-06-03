import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  getResourcesConfigPath,
  getWorkspaceResource,
  getWorkspaceRoot,
  resolveWorkspacePath,
  updateLocalResourceWorkspace,
} from "@/app/api/workspace/_lib/workspace";
import {
  fixedGatewayUrl,
  gatewayApiBaseUrl,
  gatewayBootstrapUrl,
  normalizeGatewayUrl,
} from "@/app/api/gateway/_lib/gateway";

export const runtime = "nodejs";

type AuthorizationMode = "auto" | "write" | "all";
type ModelSelectionMode = "auto" | "manual";
type ModelProvider = "gateway";
type OnboardingMissing = "gatewayEmail" | "workspacePath";

interface AgentConfig {
  interrupt_on?: Record<string, unknown>;
  authorization_mode?: AuthorizationMode;
  model_provider?: ModelProvider;
  model_selection_mode?: ModelSelectionMode;
  manual_model?: string;
  openrouter_direct_enabled?: boolean;
  openrouter_model?: string;
  gateway_base_url?: string;
  gateway_model?: string;
  [key: string]: unknown;
}

interface UpdateConfigRequest {
  modelProvider?: unknown;
  model?: unknown;
  modelSelectionMode?: unknown;
  gatewayEmail?: unknown;
  gatewayUsername?: unknown;
  gatewayInviteCode?: unknown;
  authorizationMode?: unknown;
  workspacePath?: unknown;
}

const AUTO_MODEL = "jisi/auto";
const DEFAULT_MANUAL_MODEL = "qwen3.5-397b-a17b";

const WRITE_TOOLS = ["write_file", "edit_file"];
const COMMON_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "execute",
  "task",
  "write_todos",
  "compact_conversation",
  "web_search",
  "fetch_url",
  "start_async_task",
  "update_async_task",
  "cancel_async_task",
];

function configPath() {
  return path.join(getWorkspaceRoot(), "deepagent.config.json");
}

function envPath() {
  return path.join(getWorkspaceRoot(), ".env");
}

function isDesktopMode() {
  return process.env.INTERNAGENTS_DESKTOP === "1";
}

async function readConfig(): Promise<AgentConfig> {
  try {
    const content = await fs.readFile(configPath(), "utf8");
    return JSON.parse(content) as AgentConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeConfig(config: AgentConfig) {
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

function parseEnvValue(rawValue: string) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function readEnvValues(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(envPath(), "utf8");
    const values: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) {
        continue;
      }
      values[match[1]] = parseEnvValue(match[2]);
    }
    return values;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeEnvValues(updates: Record<string, string | null>) {
  let content = "";
  try {
    content = await fs.readFile(envPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const lines = content ? content.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const nextLines = lines.flatMap((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match || line.trim().startsWith("#")) {
      return [line];
    }

    const key = match[2];
    if (!(key in updates)) {
      return [line];
    }

    seen.add(key);
    const value = updates[key];
    if (value === null) {
      return [];
    }
    return [`${match[1]}${key}${match[3]}${JSON.stringify(value)}`];
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key) && value !== null) {
      nextLines.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  const nextContent = `${nextLines.filter((_, index) => {
    return index < nextLines.length - 1 || nextLines[index] !== "";
  }).join("\n")}\n`;

  await fs.writeFile(envPath(), nextContent);
}

function stripModelProviderPrefix(model: string | undefined) {
  if (!model) {
    return DEFAULT_MANUAL_MODEL;
  }
  for (const prefix of ["openrouter:", "openai:"]) {
    if (model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }
  return model;
}

function normalizeModel(model: unknown) {
  if (typeof model !== "string") {
    return DEFAULT_MANUAL_MODEL;
  }

  const trimmed = stripModelProviderPrefix(model.trim());
  if (!trimmed) {
    throw new Error("请选择或填写模型。");
  }
  return trimmed;
}

function isAuthorizationMode(value: unknown): value is AuthorizationMode {
  return value === "auto" || value === "write" || value === "all";
}

function isModelSelectionMode(value: unknown): value is ModelSelectionMode {
  return value === "auto" || value === "manual";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeInviteCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function inferModelSelectionMode(config: AgentConfig): ModelSelectionMode {
  return isModelSelectionMode(config.model_selection_mode)
    ? config.model_selection_mode
    : "auto";
}

function inferModelProvider(): ModelProvider {
  return "gateway";
}

function selectedGatewayModel(config: AgentConfig) {
  return inferModelSelectionMode(config) === "auto"
    ? AUTO_MODEL
    : normalizeModel(config.manual_model || DEFAULT_MANUAL_MODEL);
}

function inferAuthorizationMode(config: AgentConfig): AuthorizationMode {
  if (isAuthorizationMode(config.authorization_mode)) {
    return config.authorization_mode;
  }

  const interruptOn =
    config.interrupt_on && typeof config.interrupt_on === "object"
      ? config.interrupt_on
      : {};
  const tools = Object.keys(interruptOn);
  if (tools.length === 0) {
    return "auto";
  }

  if (tools.every((tool) => WRITE_TOOLS.includes(tool))) {
    return "write";
  }

  return "all";
}

function approvalConfig(description: string) {
  return {
    allowed_decisions: ["approve", "reject"],
    description,
  };
}

function buildInterruptOn(mode: AuthorizationMode) {
  if (mode === "auto") {
    return undefined;
  }

  const tools = mode === "write" ? WRITE_TOOLS : COMMON_TOOLS;
  return Object.fromEntries(
    tools.map((tool) => [
      tool,
      approvalConfig(
        mode === "write"
          ? "写入或修改本地文件前需要确认。"
          : "执行此工具调用前需要确认。"
      ),
    ])
  );
}

async function normalizedResponse(config: AgentConfig) {
  const env = await readEnvValues();
  const envModel = normalizeModel(
    env.DEEPAGENT_MODEL || env.LLM_MODEL || AUTO_MODEL
  );
  const modelProvider = inferModelProvider();
  const modelSelectionMode = inferModelSelectionMode(config);
  const manualModel = normalizeModel(
    config.manual_model ||
      (envModel === AUTO_MODEL ? DEFAULT_MANUAL_MODEL : envModel)
  );
  const effectiveModel =
    modelSelectionMode === "auto" ? AUTO_MODEL : manualModel;
  const gatewayKey = env.INTERNAGENTS_GATEWAY_KEY || env.OPENAI_API_KEY;
  const gatewayEmail = env.INTERNAGENTS_USER_EMAIL || "";
  const gatewayUsername = env.INTERNAGENTS_USER_NAME || "";
  const gatewayInviteCode =
    env.INTERNAGENTS_INVITE_CODE || env.INTERNAGENTS_GATEWAY_INVITE_CODE || "";
  const gatewayModel = effectiveModel;
  let workspacePath = ".";
  let workspaceResolvedPath = "";
  let workspaceError: string | undefined;
  try {
    const workspaceResource = getWorkspaceResource("local");
    const workspaceResolved = await resolveWorkspacePath("", "local");
    workspacePath = workspaceResource.workspace || ".";
    workspaceResolvedPath = workspaceResolved.root;
  } catch (error) {
    workspaceError =
      error instanceof Error ? error.message : "工作区配置读取失败。";
  }

  const missing: OnboardingMissing[] = [];
  if (
    modelProvider === "gateway" &&
    (!gatewayKey?.trim() ||
      !gatewayEmail.trim() ||
      !gatewayUsername.trim() ||
      !gatewayInviteCode.trim())
  ) {
    missing.push("gatewayEmail");
  }
  if (workspaceError) {
    missing.push("workspacePath");
  }
  const desktopMode = isDesktopMode();

  return {
    configPath: configPath(),
    envPath: envPath(),
    resourcesPath: getResourcesConfigPath(),
    workspacePath,
    workspaceResolvedPath,
    workspaceError,
    modelProvider,
    model: manualModel,
    modelSelectionMode,
    effectiveModel,
    autoModel: AUTO_MODEL,
    gatewayEmail,
    gatewayUsername,
    gatewayInviteCode,
    gatewayModel,
    gatewayApiKeySet: Boolean(gatewayKey),
    gatewayApiKeyPreview: "",
    gatewayCreditRmb: env.INTERNAGENTS_GATEWAY_CREDIT_RMB || "",
    gatewayRemainingRmb: env.INTERNAGENTS_GATEWAY_REMAINING_RMB || "",
    authorizationMode: inferAuthorizationMode(config),
    desktopMode,
    needsOnboarding: missing.length > 0,
    missing,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await normalizedResponse(await readConfig()));
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "配置读取失败。",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as UpdateConfigRequest;
    const currentConfig = await readConfig();
    const currentEnv = await readEnvValues();
    const modelProvider: ModelProvider = "gateway";
    const modelSelectionMode = isModelSelectionMode(body.modelSelectionMode)
      ? body.modelSelectionMode
      : "auto";
    const model =
      modelSelectionMode === "manual"
        ? normalizeModel(body.model)
        : normalizeModel(
            typeof body.model === "string" && body.model.trim()
              ? body.model
              : DEFAULT_MANUAL_MODEL
          );
    const authorizationMode = isAuthorizationMode(body.authorizationMode)
      ? body.authorizationMode
      : "auto";
    const workspacePath =
      typeof body.workspacePath === "string"
        ? body.workspacePath.trim()
        : undefined;
    if (workspacePath === "") {
      throw new Error("工作区路径不能为空。");
    }
    const currentWorkspacePath = getWorkspaceResource("local").workspace || ".";
    const shouldUpdateWorkspace =
      workspacePath !== undefined && workspacePath !== currentWorkspacePath;

    const nextConfig: AgentConfig = {
      ...currentConfig,
      authorization_mode: authorizationMode,
      model_provider: modelProvider,
      model_selection_mode: modelSelectionMode,
      manual_model: model,
    };
    delete nextConfig.openrouter_direct_enabled;
    delete nextConfig.openrouter_model;
    const interruptOn = buildInterruptOn(authorizationMode);
    if (interruptOn) {
      nextConfig.interrupt_on = interruptOn;
    } else {
      delete nextConfig.interrupt_on;
    }

    const envUpdates = await buildGatewayEnvUpdates({
      body,
      config: nextConfig,
      env: currentEnv,
    });
    await writeConfig(nextConfig);
    await writeEnvValues(envUpdates);
    if (shouldUpdateWorkspace) {
      await updateLocalResourceWorkspace(workspacePath);
    }

    return NextResponse.json({
      ...(await normalizedResponse(nextConfig)),
      message: "配置已保存，重启后台后生效。",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "配置保存失败。",
      },
      { status: 500 }
    );
  }
}

interface GatewayBootstrapResponse {
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  creditRmb?: unknown;
  remainingRmb?: unknown;
  username?: unknown;
  inviteCode?: unknown;
  error?: unknown;
}

async function buildGatewayEnvUpdates({
  body,
  config,
  env,
}: {
  body: UpdateConfigRequest;
  config: AgentConfig;
  env: Record<string, string>;
}) {
  const gatewayEmail =
    normalizeEmail(body.gatewayEmail) ||
    normalizeEmail(env.INTERNAGENTS_USER_EMAIL);
  if (!gatewayEmail || !isValidEmail(gatewayEmail)) {
    throw new Error("请填写有效的邮箱，用于领取集思 key。");
  }
  const gatewayUsername =
    normalizeUsername(body.gatewayUsername) ||
    normalizeUsername(env.INTERNAGENTS_USER_NAME);
  if (!gatewayUsername) {
    throw new Error("请填写用户名，用于绑定集思账号。");
  }
  if (gatewayUsername.length > 64) {
    throw new Error("用户名不能超过 64 个字符。");
  }
  const gatewayInviteCode =
    normalizeInviteCode(body.gatewayInviteCode) ||
    normalizeInviteCode(
      env.INTERNAGENTS_INVITE_CODE || env.INTERNAGENTS_GATEWAY_INVITE_CODE
    );
  if (!gatewayInviteCode) {
    throw new Error("请填写邀请码，用于领取集思 key。");
  }

  const gatewayUrl = fixedGatewayUrl();
  const fixedApiBaseUrl = gatewayApiBaseUrl(gatewayUrl);
  const installId = env.INTERNAGENTS_INSTALL_ID || randomUUID();
  const existingGatewayKey = env.INTERNAGENTS_GATEWAY_KEY || env.OPENAI_API_KEY;
  const storedApiBaseUrl = normalizeGatewayUrl(
    env.INTERNAGENTS_GATEWAY_BASE_URL ||
      env.OPENAI_BASE_URL ||
      env.OPENAI_API_BASE ||
      ""
  );
  const shouldBootstrap =
    !existingGatewayKey ||
    gatewayEmail !== normalizeEmail(env.INTERNAGENTS_USER_EMAIL) ||
    gatewayUsername !== normalizeUsername(env.INTERNAGENTS_USER_NAME) ||
    gatewayInviteCode !==
      normalizeInviteCode(
        env.INTERNAGENTS_INVITE_CODE || env.INTERNAGENTS_GATEWAY_INVITE_CODE
      ) ||
    storedApiBaseUrl !== fixedApiBaseUrl;

  let apiKey = existingGatewayKey;
  const apiBaseUrl = fixedApiBaseUrl;
  let creditRmb = env.INTERNAGENTS_GATEWAY_CREDIT_RMB || "";
  let remainingRmb = env.INTERNAGENTS_GATEWAY_REMAINING_RMB || "";

  if (shouldBootstrap) {
    const bootstrap = await requestGatewayBootstrap({
      gatewayUrl,
      email: gatewayEmail,
      installId,
      username: gatewayUsername,
      inviteCode: gatewayInviteCode,
    });
    apiKey = bootstrap.apiKey;
    creditRmb =
      typeof bootstrap.creditRmb === "number"
        ? String(bootstrap.creditRmb)
        : "";
    remainingRmb =
      typeof bootstrap.remainingRmb === "number"
        ? String(bootstrap.remainingRmb)
        : "";
  }

  if (!apiKey) {
    throw new Error("集思 key 不存在，请重新绑定集思账号。");
  }

  const model = selectedGatewayModel(config);

  delete config.gateway_base_url;
  config.gateway_model = model;

  return {
    INTERNAGENTS_MODEL_PROVIDER: "gateway",
    INTERNAGENTS_INSTALL_ID: installId,
    INTERNAGENTS_USER_EMAIL: gatewayEmail,
    INTERNAGENTS_USER_NAME: gatewayUsername,
    INTERNAGENTS_INVITE_CODE: gatewayInviteCode,
    INTERNAGENTS_GATEWAY_INVITE_CODE: null,
    INTERNAGENTS_GATEWAY_URL: null,
    INTERNAGENTS_GATEWAY_BASE_URL: apiBaseUrl,
    INTERNAGENTS_GATEWAY_MODEL: model,
    INTERNAGENTS_GATEWAY_KEY: apiKey,
    INTERNAGENTS_GATEWAY_CREDIT_RMB: creditRmb,
    INTERNAGENTS_GATEWAY_REMAINING_RMB: remainingRmb,
    LLM_PROVIDER: "openrouter",
    LLM_MODEL: model,
    DEEPAGENT_MODEL: `openrouter:${model}`,
    OPENROUTER_API_KEY: apiKey,
    OPENROUTER_API_BASE: apiBaseUrl,
    OPENROUTER_BASE_URL: apiBaseUrl,
    OPENAI_API_KEY: apiKey,
    OPENAI_BASE_URL: apiBaseUrl,
    OPENAI_API_BASE: apiBaseUrl,
  };
}

async function requestGatewayBootstrap({
  gatewayUrl,
  email,
  installId,
  username,
  inviteCode,
}: {
  gatewayUrl: string;
  email: string;
  installId: string;
  username: string;
  inviteCode: string;
}): Promise<{
  apiKey: string;
  baseUrl: string;
  model: string;
  creditRmb?: number;
  remainingRmb?: number;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(gatewayBootstrapUrl(gatewayUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, installId, username, inviteCode }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as
      GatewayBootstrapResponse;
    if (!response.ok) {
      throw new Error(
        typeof payload.error === "string"
          ? payload.error
          : "集思绑定失败，请稍后重试。"
      );
    }
    if (
      typeof payload.apiKey !== "string" ||
      typeof payload.baseUrl !== "string" ||
      typeof payload.model !== "string"
    ) {
      throw new Error("集思返回格式不完整。");
    }
    return {
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      model: payload.model,
      creditRmb:
        typeof payload.creditRmb === "number" ? payload.creditRmb : undefined,
      remainingRmb:
        typeof payload.remainingRmb === "number"
          ? payload.remainingRmb
          : undefined,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("集思绑定超时，请稍后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
