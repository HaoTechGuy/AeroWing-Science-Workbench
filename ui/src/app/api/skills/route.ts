import { NextRequest, NextResponse } from "next/server";
import {
  readSkillsConfig,
  updateSkillsConfig,
} from "@/app/api/skills/_lib/skills";
import type { UpdateSkillsRequest } from "@/app/skills/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await readSkillsConfig());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load skills configuration.",
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<UpdateSkillsRequest>;
    const selected = Array.isArray(body.selected) ? body.selected : [];
    const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
    const skillsConfig = await updateSkillsConfig(enabled, selected);

    return NextResponse.json(
      {
        ...skillsConfig,
        requiresRestart: true,
        message: "技能配置已保存，应用后生效。",
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save skills configuration.",
      },
      { status: 500 }
    );
  }
}
