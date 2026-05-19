import uiConfig from "../../deepagent-ui.config.json";

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
}

const configuredResources = (uiConfig.resources?.length
  ? uiConfig.resources
  : [
      {
        id: "local",
        label: "Current Machine",
        assistantId: uiConfig.assistantId || "agent",
      },
    ]) as ResourceConfig[];

const defaultResourceId =
  process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCE_ID ||
  uiConfig.defaultResourceId ||
  configuredResources[0]?.id ||
  "local";

const selectedDefaultResource =
  configuredResources.find((resource) => resource.id === defaultResourceId) ||
  configuredResources[0];

const DEFAULT_CONFIG: StandaloneConfig = {
  deploymentUrl:
    process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL ||
    uiConfig.deploymentUrl ||
    "http://127.0.0.1:2024",
  assistantId:
    process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID ||
    selectedDefaultResource?.assistantId ||
    uiConfig.assistantId ||
    "agent",
  langsmithApiKey:
    process.env.NEXT_PUBLIC_LANGSMITH_API_KEY ||
    uiConfig.langsmithApiKey ||
    undefined,
  defaultResourceId,
  resources: configuredResources,
};

export function getConfig(): StandaloneConfig {
  return DEFAULT_CONFIG;
}

export function getResource(config: StandaloneConfig, resourceId?: string | null) {
  return (
    config.resources.find((resource) => resource.id === resourceId) ||
    config.resources.find((resource) => resource.id === config.defaultResourceId) ||
    config.resources[0]
  );
}
