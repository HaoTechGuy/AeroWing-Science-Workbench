import { NextRequest, NextResponse } from "next/server";
import {
  pushRemoteBackendCli,
  type RemoteBackendCliPushRequest,
} from "@/app/api/remote-connections/_lib/remote-connections";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid request body.",
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
        send({ type: "log", message: "Starting backend CLI push..." });
        const result = await pushRemoteBackendCli(
          body as RemoteBackendCliPushRequest,
          (message) => {
            send({ type: "log", message });
          }
        );
        send({ type: "done", result });
      } catch (error) {
        send({
          type: "error",
          error:
            error instanceof Error ? error.message : "Backend CLI push failed.",
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
