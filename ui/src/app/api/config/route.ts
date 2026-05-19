import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceRoot } from "@/app/api/workspace/_lib/workspace";

export const runtime = "nodejs";

type AuthorizationMode = "auto" | "write" | "all";

interface AgentConfig {
  interrupt_on?: Record<string, unknown>;
  authorization_mode?: AuthorizationMode;
  [key: string]: unknown;
}

interface UpdateConfigRequest {
  model?: unknown;
  openrouterApiKey?: unknown;
  authorizationMode?: unknown;
}

const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

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

async function writeEnvValues(updates: Record<string, string>) {
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
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match || line.trim().startsWith("#")) {
      return line;
    }

    const key = match[2];
    if (!(key in updates)) {
      return line;
    }

    seen.add(key);
    return `${match[1]}${key}${match[3]}${JSON.stringify(updates[key])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  const nextContent = `${nextLines.filter((_, index) => {
    return index < nextLines.length - 1 || nextLines[index] !== "";
  }).join("\n")}\n`;

  await fs.writeFile(envPath(), nextContent);
}

function stripOpenRouterPrefix(model: string | undefined) {
  if (!model) {
    return DEFAULT_OPENROUTER_MODEL;
  }
  return model.startsWith("openrouter:") ? model.slice("openrouter:".length) : model;
}

function normalizeModel(model: unknown) {
  if (typeof model !== "string") {
    return DEFAULT_OPENROUTER_MODEL;
  }

  const trimmed = stripOpenRouterPrefix(model.trim());
  if (!trimmed) {
    throw new Error("请选择或填写模型。");
  }
  return trimmed;
}

function previewApiKey(apiKey: string | undefined) {
  if (!apiKey) {
    return "";
  }
  return `已保存，末尾 ${apiKey.slice(-4)}`;
}

function isAuthorizationMode(value: unknown): value is AuthorizationMode {
  return value === "auto" || value === "write" || value === "all";
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
  const model = normalizeModel(
    env.DEEPAGENT_MODEL || env.LLM_MODEL || DEFAULT_OPENROUTER_MODEL
  );
  const apiKey = env.OPENROUTER_API_KEY;

  return {
    configPath: configPath(),
    envPath: envPath(),
    model,
    openrouterApiKeySet: Boolean(apiKey),
    openrouterApiKeyPreview: previewApiKey(apiKey),
    authorizationMode: inferAuthorizationMode(config),
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
    const model = normalizeModel(body.model);
    const authorizationMode = isAuthorizationMode(body.authorizationMode)
      ? body.authorizationMode
      : "auto";
    const apiKey =
      typeof body.openrouterApiKey === "string"
        ? body.openrouterApiKey.trim()
        : "";

    const currentConfig = await readConfig();
    const nextConfig: AgentConfig = {
      ...currentConfig,
      authorization_mode: authorizationMode,
    };
    const interruptOn = buildInterruptOn(authorizationMode);
    if (interruptOn) {
      nextConfig.interrupt_on = interruptOn;
    } else {
      delete nextConfig.interrupt_on;
    }

    await writeConfig(nextConfig);

    const envUpdates: Record<string, string> = {
      OPENROUTER_BASE_URL,
      LLM_PROVIDER: "openrouter",
      LLM_MODEL: model,
      DEEPAGENT_MODEL: `openrouter:${model}`,
    };
    if (apiKey) {
      envUpdates.OPENROUTER_API_KEY = apiKey;
    }
    await writeEnvValues(envUpdates);

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
