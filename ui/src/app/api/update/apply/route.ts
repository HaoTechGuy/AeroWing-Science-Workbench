import { NextResponse } from "next/server";
import { applyUpdate } from "@/app/api/update/_lib/update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const status = await applyUpdate();

  return NextResponse.json(status, {
    status: status.state === "failed" ? 500 : 200,
  });
}
