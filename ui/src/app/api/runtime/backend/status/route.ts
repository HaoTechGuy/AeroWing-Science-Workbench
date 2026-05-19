import { NextResponse } from "next/server";
import { getBackendStatus } from "@/app/api/runtime/_lib/backend";

export const runtime = "nodejs";

export async function GET() {
  const result = await getBackendStatus();
  return NextResponse.json(result, {
    status: result.status === "unavailable" ? 503 : 200,
  });
}
