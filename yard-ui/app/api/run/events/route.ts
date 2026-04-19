import { NextRequest, NextResponse } from "next/server";
import { getJob, getSessionFromRequest, serializeJob, subscribeToJob } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json(
      {
        error: "Sign in again before listening for shred job events.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const jobId = request.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json(
      {
        error: "Missing jobId query parameter.",
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const job = getJob(jobId);

  if (!job || job.sessionId !== session.id) {
    return NextResponse.json(
      {
        error: "That shred job could not be found for the current session.",
      },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      };

      const currentSnapshot = serializeJob(job);

      if (job.status === "completed") {
        send("complete", currentSnapshot);
        controller.close();
        return;
      }

      if (job.status === "stopped") {
        send("error", currentSnapshot);
        controller.close();
        return;
      }

      send("progress", currentSnapshot);
      unsubscribe = subscribeToJob(jobId, (event, snapshot) => {
        send(event, snapshot);

        if (event !== "progress") {
          if (keepAlive) {
            clearInterval(keepAlive);
          }

          unsubscribe?.();
          controller.close();
        }
      });

      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
      }, 15_000);
    },
    cancel() {
      if (keepAlive) {
        clearInterval(keepAlive);
      }

      unsubscribe?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}
