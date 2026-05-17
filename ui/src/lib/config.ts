import uiConfig from "../../deepagent-ui.config.json";
import type { StreamMode } from "@langchain/langgraph-sdk";

export interface StreamConfig {
  modes: StreamMode[];
  subgraphs: boolean;
}

export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
  stream: StreamConfig;
}

const DEFAULT_STREAM_CONFIG: StreamConfig = {
  modes: ["messages-tuple", "updates", "values"],
  subgraphs: true,
};

const rawConfig = uiConfig as Partial<StandaloneConfig>;

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
    rawConfig.assistantId ||
    "agent",
  langsmithApiKey:
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    rawConfig.langsmithApiKey ||
    undefined,
  stream: normalizeStreamConfig(rawConfig.stream),
};

export function getConfig(): StandaloneConfig {
  return DEFAULT_CONFIG;
}
