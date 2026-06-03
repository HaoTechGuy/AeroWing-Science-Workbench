import { NextResponse } from "next/server";
import { gatewayModelsUrl } from "@/app/api/gateway/_lib/gateway";

export const runtime = "nodejs";

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(gatewayModelsUrl(), {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            typeof payload.error === "string"
              ? payload.error
              : "集思模型列表读取失败。",
        },
        { status: response.status }
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof DOMException && error.name === "AbortError"
            ? "集思模型列表读取超时。"
            : "集思模型列表读取失败。",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeout);
  }
}
