import { NextResponse } from "next/server";
import { restartBackend } from "@/app/api/runtime/_lib/backend";

export const runtime = "nodejs";

export async function POST() {
  const result = await restartBackend();
  return NextResponse.json(result, {
    status: result.status === "restarted" ? 200 : 500,
  });
}
