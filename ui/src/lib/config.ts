import uiConfig from "../../deepagent-ui.config.json";

export interface StandaloneConfig {
  deploymentUrl: string;
  assistantId: string;
  langsmithApiKey?: string;
}

const DEFAULT_CONFIG: StandaloneConfig = {
  deploymentUrl:
    process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL ||
    uiConfig.deploymentUrl ||
    "http://127.0.0.1:2024",
  assistantId:
    process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID ||
    uiConfig.assistantId ||
    "agent",
  langsmithApiKey:
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    uiConfig.langsmithApiKey ||
    undefined,
};

export function getConfig(): StandaloneConfig {
  return DEFAULT_CONFIG;
}
