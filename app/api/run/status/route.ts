import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/server/shreddit-responses";
import { getJob, getSessionFromRequest, serializeJob } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return jsonNoStore(
      {
        error: "Sign in again before checking shred job status.",
      },
      { status: 401 },
    );
  }

  const jobId = request.nextUrl.searchParams.get("jobId");

  if (!jobId) {
    return jsonNoStore(
      {
        error: "Missing jobId query parameter.",
      },
      { status: 400 },
    );
  }

  const job = getJob(jobId);

  if (!job || job.sessionId !== session.id) {
    return jsonNoStore(
      {
        error: "That shred job could not be found for the current session.",
      },
      { status: 404 },
    );
  }

  return jsonNoStore(serializeJob(job));
}
