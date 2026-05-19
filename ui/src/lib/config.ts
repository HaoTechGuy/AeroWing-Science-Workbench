import uiConfig from "../../deepagent-ui.config.json";
import type { StreamMode } from "@langchain/langgraph-sdk";

export interface StreamConfig {
  modes: StreamMode[];
  subgraphs: boolean;
}

export interface ResourceConfig {
  id: string;
  label: string;
  assistantId: string;
}

export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
  defaultResourceId: string;
  resources: ResourceConfig[];
  stream: StreamConfig;
}

export type ConnectionConfig = Pick<
  StandaloneConfig,
  "deploymentUrl" | "assistantId" | "langsmithApiKey"
>;

const DEFAULT_STREAM_CONFIG: StreamConfig = {
  modes: ["messages-tuple", "updates", "values"],
  subgraphs: true,
};

const rawConfig = uiConfig as Partial<StandaloneConfig>;
const CONNECTION_STORAGE_KEY = "internagents.connection";

const configuredResources = (
  rawConfig.resources?.length
    ? rawConfig.resources
    : [
        {
          id: "local",
          label: "Current Machine",
          assistantId: rawConfig.assistantId || "agent",
        },
      ]
) as ResourceConfig[];

const defaultResourceId =
  process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCE_ID ||
  rawConfig.defaultResourceId ||
  configuredResources[0]?.id ||
  "local";

const selectedDefaultResource =
  configuredResources.find((resource) => resource.id === defaultResourceId) ||
  configuredResources[0];

function normalizeStreamConfig(stream?: Partial<StreamConfig>): StreamConfig {
  return {
    modes:
      Array.isArray(stream?.modes) && stream.modes.length > 0
        ? stream.modes
        : DEFAULT_STREAM_CONFIG.modes,
    subgraphs:
      typeof stream?.subgraphs === "boolean"
        ? stream.subgraphs
        : DEFAULT_STREAM_CONFIG.subgraphs,
  };
}

const DEFAULT_CONFIG: StandaloneConfig = {
  deploymentUrl:
    process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL ||
    rawConfig.deploymentUrl ||
    "http://127.0.0.1:2024",
  assistantId:
    process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID ||
    selectedDefaultResource?.assistantId ||
    rawConfig.assistantId ||
    "agent",
  langsmithApiKey:
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    rawConfig.langsmithApiKey ||
    undefined,
  defaultResourceId,
  resources: configuredResources,
  stream: normalizeStreamConfig(rawConfig.stream),
};

function readStoredConnectionConfig(): Partial<ConnectionConfig> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(CONNECTION_STORAGE_KEY);
    if (!stored) {
      return {};
    }

    const parsed = JSON.parse(stored) as Partial<ConnectionConfig>;
    return {
      deploymentUrl:
        typeof parsed.deploymentUrl === "string" && parsed.deploymentUrl.trim()
          ? parsed.deploymentUrl.trim()
          : undefined,
      assistantId:
        typeof parsed.assistantId === "string" && parsed.assistantId.trim()
          ? parsed.assistantId.trim()
          : undefined,
      langsmithApiKey:
        typeof parsed.langsmithApiKey === "string"
          ? parsed.langsmithApiKey.trim()
          : undefined,
    };
  } catch {
    return {};
  }
}

export function getDefaultConfig(): StandaloneConfig {
  return DEFAULT_CONFIG;
}

export function getConfig(): StandaloneConfig {
  const stored = readStoredConnectionConfig();
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    defaultResourceId: DEFAULT_CONFIG.defaultResourceId,
    resources: DEFAULT_CONFIG.resources,
    stream: DEFAULT_CONFIG.stream,
  };
}

export function getResource(
  config: StandaloneConfig,
  resourceId?: string | null
) {
  return (
    config.resources.find((resource) => resource.id === resourceId) ||
    config.resources.find(
      (resource) => resource.id === config.defaultResourceId
    ) ||
    config.resources[0]
  );
}

export function saveConnectionConfig(config: ConnectionConfig): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    CONNECTION_STORAGE_KEY,
    JSON.stringify({
      deploymentUrl: config.deploymentUrl.trim(),
      assistantId: config.assistantId.trim(),
      langsmithApiKey: config.langsmithApiKey?.trim() || "",
    })
  );
}

export function clearConnectionConfig(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(CONNECTION_STORAGE_KEY);
}
