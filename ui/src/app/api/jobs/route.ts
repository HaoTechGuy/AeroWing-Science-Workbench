import { NextRequest, NextResponse } from "next/server";
import { createJob } from "./_lib/jobs";

export const runtime = "nodejs";

const SUPPORTED_JOB_TYPES = new Set([
  "geometry_audit",
  "nastran_review",
  "flight_condition",
]);

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      type?: unknown;
      payload?: unknown;
    };
    if (typeof body.type !== "string" || !SUPPORTED_JOB_TYPES.has(body.type)) {
      return NextResponse.json({ error: "Unsupported job type." }, { status: 400 });
    }
    const payload =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : {};
    const job = await createJob(body.type, payload);
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create job." },
      { status: 500 }
    );
  }
}
