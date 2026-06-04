import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLocalBackendUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const deploymentUrl = request.nextUrl.searchParams.get("url")?.trim() || "";

  if (!isLocalBackendUrl(deploymentUrl)) {
    return NextResponse.json(
      { ready: false, error: "Only local backend URLs can be checked." },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(new URL("/ok", deploymentUrl), {
      cache: "no-store",
      signal: controller.signal,
    });
    return NextResponse.json({
      ready: response.ok,
      status: response.status,
    });
  } catch {
    return NextResponse.json({ ready: false });
  } finally {
    clearTimeout(timeout);
  }
}
