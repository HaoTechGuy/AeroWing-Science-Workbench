import { NextRequest, NextResponse } from "next/server";
import { applyUpdate } from "@/app/api/update/_lib/update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApplyUpdateRequest {
  restartLocalBackend?: unknown;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ApplyUpdateRequest;
  const status = await applyUpdate({
    restartLocalBackend: body.restartLocalBackend !== false,
  });

  return NextResponse.json(status, {
    status: status.state === "failed" ? 500 : 200,
  });
}
