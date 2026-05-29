import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResourceConfig {
  id: string;
  label: string;
  assistantId: string;
  runtimeUrl?: string;
}

function parseResources(value: string | undefined): ResourceConfig[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const resources = parsed
      .map((item): ResourceConfig | null => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        if (
          typeof record.id !== "string" ||
          typeof record.label !== "string" ||
          typeof record.assistantId !== "string"
        ) {
          return null;
        }
        return {
          id: record.id,
          label: record.label,
          assistantId: record.assistantId,
          runtimeUrl:
            typeof record.runtimeUrl === "string"
              ? record.runtimeUrl
              : undefined,
        };
      })
      .filter((item): item is ResourceConfig => item !== null);
    return resources.length > 0 ? resources : undefined;
  } catch {
    return undefined;
  }
}

export function GET() {
  const desktopMode = process.env.INTERNAGENTS_DESKTOP === "1";
  const assistantId =
    process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID || "agent_local";
  const resources =
    parseResources(process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCES) || [
      {
        id: "local",
        label: "Current Machine",
        assistantId,
        runtimeUrl: process.env.INTERNAGENTS_LOCAL_RUNTIME_PORT
          ? `http://127.0.0.1:${process.env.INTERNAGENTS_LOCAL_RUNTIME_PORT}`
          : undefined,
      },
    ];
  const config = {
    desktopMode,
    deploymentUrl: process.env.NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL || "",
    assistantId,
    langsmithApiKey: process.env.NEXT_PUBLIC_LANGSMITH_API_KEY || "",
    defaultResourceId:
      process.env.NEXT_PUBLIC_INTERNAGENT_RESOURCE_ID || resources[0].id,
    resources,
  };

  return new NextResponse(
    `window.__INTERNAGENTS_RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`,
    {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
