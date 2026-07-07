import { NextRequest, NextResponse } from "next/server";
import { readJob, readJobResult, writeJob } from "../_lib/jobs";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const job = await readJob(jobId);
    const result = await readJobResult(jobId);
    return NextResponse.json({ job, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read job." },
      { status: 404 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const job = await readJob(jobId);
    const now = new Date().toISOString();
    if (job.runnerPid && job.status === "running") {
      try {
        process.kill(job.runnerPid);
      } catch {
        // The runner may already have exited.
      }
    }
    const nextJob = { ...job, status: "cancelled" as const, updatedAt: now, finishedAt: now };
    await writeJob(nextJob);
    return NextResponse.json({ job: nextJob });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to cancel job." },
      { status: 404 }
    );
  }
}
