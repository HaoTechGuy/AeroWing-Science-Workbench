import { NextResponse } from "next/server";
import { checkForUpdate } from "@/app/api/update/_lib/update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const status = await checkForUpdate();
  return NextResponse.json(status, {
    status: status.state === "failed" ? 502 : 200,
  });
}
