import { NextRequest, NextResponse } from "next/server";
import { rollbackUpdate } from "@/app/api/update/_lib/update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RollbackUpdateRequest {
  restartLocalBackend?: unknown;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as RollbackUpdateRequest;
  const status = await rollbackUpdate({
    restartLocalBackend: body.restartLocalBackend !== false,
  });

  return NextResponse.json(status, {
    status: status.state === "failed" ? 500 : 200,
  });
}
