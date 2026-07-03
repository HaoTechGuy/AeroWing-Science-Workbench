import { NextRequest, NextResponse } from "next/server";
import {
  listRemoteJobs,
  submitLinuxSshJob,
} from "@/app/api/compute/_lib/ssh-remote-jobs";
import { assertComputePostAllowed } from "@/app/api/compute/_lib/compute-auth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ jobs: await listRemoteJobs() });
}

export async function POST(request: NextRequest) {
  try {
    assertComputePostAllowed(request);
    const body = await request.json();
    const job = await submitLinuxSshJob(body);
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remote job submit failed." },
      { status: 400 }
    );
  }
}
