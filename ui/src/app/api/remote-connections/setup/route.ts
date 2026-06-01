import { NextRequest, NextResponse } from "next/server";
import {
  setupRemoteConnection,
  type RemoteConnectionSetupRequest,
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: "log", message: "开始配置远程 runtime..." });
        const result = await setupRemoteConnection(
          body as RemoteConnectionSetupRequest,
          (message) => {
            send({ type: "log", message });
          }
        );
        send({ type: "done", result });
      } catch (error) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : "远程机器配置失败。",
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
