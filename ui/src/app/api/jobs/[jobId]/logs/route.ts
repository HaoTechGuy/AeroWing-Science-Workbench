import { NextRequest, NextResponse } from "next/server";
import { readJob, readJobText } from "../../_lib/jobs";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await context.params;
    const job = await readJob(jobId);
    const [stdout, stderr] = await Promise.all([
      readJobText(jobId, "stdout.log"),
      readJobText(jobId, "stderr.log"),
    ]);
    return NextResponse.json({ job, stdout, stderr });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read job logs." },
      { status: 404 }
    );
  }
}
