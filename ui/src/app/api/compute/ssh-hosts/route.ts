import { NextRequest, NextResponse } from "next/server";
import {
  listSshComputeHosts,
  upsertSshComputeHost,
} from "@/app/api/compute/_lib/ssh-remote-jobs";
import { assertComputePostAllowed } from "@/app/api/compute/_lib/compute-auth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ hosts: await listSshComputeHosts() });
}

export async function POST(request: NextRequest) {
  try {
    assertComputePostAllowed(request);
    const body = await request.json();
    const host = await upsertSshComputeHost(body);
    return NextResponse.json({ host });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SSH host setup failed." },
      { status: 400 }
    );
  }
}
