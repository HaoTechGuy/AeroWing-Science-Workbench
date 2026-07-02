import { NextResponse } from "next/server";
import { gatewayModelsUrl } from "@/app/api/gateway/_lib/gateway";

export const runtime = "nodejs";

const DEFAULT_IMAGE_MODELS = [
  {
    id: "cogview-3-flash",
    title: "CogView-3-Flash",
    provider: "Zhipu AI",
    description:
      "Free image generation model routed through the InternAgents gateway.",
    upstreamModel: "cogview-3-flash",
    upstreamProvider: "bigmodel",
    size: "1024x1024",
    isDefault: true,
  },
];

function withImageModels(payload: unknown) {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const imageModels =
    Array.isArray(record.imageModels) && record.imageModels.length > 0
      ? record.imageModels
      : Array.isArray(record.image_models) && record.image_models.length > 0
        ? record.image_models
        : DEFAULT_IMAGE_MODELS;
  return {
    ...record,
    imageModels,
  };
}

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
    return NextResponse.json(withImageModels(payload));
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
