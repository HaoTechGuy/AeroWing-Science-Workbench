import { NextRequest, NextResponse } from "next/server";
import {
  ensureRemoteResourceRuntime,
  type RemoteConnectionEnsureResult,
} from "@/app/api/remote-connections/_lib/remote-connections";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "请求格式不正确。",
      },
      { status: 400 }
    );
  }

  const resourceId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).resourceId
      : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: "log", message: "检查远程 backend runtime 版本..." });
        const result: RemoteConnectionEnsureResult =
          await ensureRemoteResourceRuntime(
            typeof resourceId === "string" ? resourceId : "",
            (message) => {
              send({ type: "log", message });
            }
          );
        send({ type: "done", result });
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "远程 backend runtime 同步失败。",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
