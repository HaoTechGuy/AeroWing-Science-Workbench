import { NextRequest, NextResponse } from "next/server";
import { importSkills } from "@/app/api/skills/_lib/skills";
import type { ImportSkillsRequest } from "@/app/skills/types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<ImportSkillsRequest>;
    const type = body.type;
    const source = typeof body.source === "string" ? body.source.trim() : "";

    if (type !== "local" && type !== "cloud") {
      return NextResponse.json(
        { error: "请选择本地技能或云端技能。" },
        { status: 400 }
      );
    }

    if (!source) {
      return NextResponse.json(
        { error: "请输入技能来源。" },
        { status: 400 }
      );
    }

    return NextResponse.json(await importSkills(type, source));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "技能添加失败，请检查来源。",
      },
      { status: 500 }
    );
  }
}
