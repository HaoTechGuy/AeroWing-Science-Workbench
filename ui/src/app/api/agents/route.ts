import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceRoot } from "@/app/api/workspace/_lib/workspace";

export const runtime = "nodejs";

interface ExpertAgentTemplate {
  name: string;
  description: string;
}

interface AgentConfig {
  subagents?: ExpertAgentTemplate[];
  [key: string]: unknown;
}

const TEMPLATES: ExpertAgentTemplate[] = [
  {
    name: "geometry-audit-agent",
    description:
      "Audit aircraft geometry and mesh quality for CFD, FEM, visualization, and 3D printing readiness.",
  },
  {
    name: "flight-physics-agent",
    description:
      "Compute preliminary flight conditions, atmosphere, Mach, dynamic pressure, Reynolds number, and load cases.",
  },
  {
    name: "structure-review-agent",
    description:
      "Review Nastran/Abaqus structural models, materials, properties, loads, constraints, and result summaries.",
  },
  {
    name: "cfd-prep-agent",
    description:
      "Prepare CFD case skeletons and check available CFD solvers without running heavy solvers automatically.",
  },
  {
    name: "engineering-report-agent",
    description:
      "Merge specialist outputs into traceable aviation engineering reports.",
  },
];

function configPath() {
  return path.join(getWorkspaceRoot(), "deepagent.config.json");
}

async function readConfig(): Promise<AgentConfig> {
  try {
    return JSON.parse(await fs.readFile(configPath(), "utf8")) as AgentConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeConfig(config: AgentConfig) {
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function enabledNames(config: AgentConfig): Set<string> {
  return new Set(
    (Array.isArray(config.subagents) ? config.subagents : [])
      .map((agent) => agent?.name)
      .filter((name): name is string => typeof name === "string")
  );
}

export async function GET() {
  try {
    const config = await readConfig();
    const enabled = enabledNames(config);
    return NextResponse.json({
      templates: TEMPLATES.map((template) => ({
        ...template,
        enabled: enabled.has(template.name),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read expert agents." },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { enabled?: unknown };
    const requestedEnabled = Array.isArray(body.enabled)
      ? new Set(body.enabled.filter((name): name is string => typeof name === "string"))
      : new Set<string>();
    const nextSubagents = TEMPLATES.filter((template) =>
      requestedEnabled.has(template.name)
    ).map(({ name, description }) => ({ name, description }));
    const config = await readConfig();
    const nextConfig = {
      ...config,
      subagents: nextSubagents,
    };
    await writeConfig(nextConfig);
    return NextResponse.json({
      templates: TEMPLATES.map((template) => ({
        ...template,
        enabled: requestedEnabled.has(template.name),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save expert agents." },
      { status: 500 }
    );
  }
}
