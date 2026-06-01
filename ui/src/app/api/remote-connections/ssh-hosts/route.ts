import { NextResponse } from "next/server";
import { listSshHosts } from "@/app/api/remote-connections/_lib/remote-connections";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ hosts: await listSshHosts() });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "无法读取 SSH config。",
      },
      { status: 500 }
    );
  }
}
