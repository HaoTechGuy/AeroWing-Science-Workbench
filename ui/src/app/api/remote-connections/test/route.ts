import { NextRequest, NextResponse } from "next/server";
import { testSshConnection } from "@/app/api/remote-connections/_lib/remote-connections";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { host?: unknown };
    const host = typeof body.host === "string" ? body.host : "";
    const result = await testSshConnection(host);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : "SSH 测试失败。",
      },
      { status: 400 }
    );
  }
}
