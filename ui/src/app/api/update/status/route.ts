import { NextResponse } from "next/server";
import { getUpdateStatus } from "@/app/api/update/_lib/update";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getUpdateStatus();
  return NextResponse.json(status);
}
