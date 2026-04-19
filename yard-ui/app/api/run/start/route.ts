import { NextRequest } from "next/server";
import { startSessionJob } from "@/lib/server/shreddit-jobs";
import { jsonError, jsonNoStore } from "@/lib/server/shreddit-responses";
import { getActiveJobForSession, getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return jsonNoStore(
      {
        error: "Sign in with Reddit before starting a shred job.",
      },
      { status: 401 },
    );
  }

  const activeJob = getActiveJobForSession(session);

  if (activeJob?.status === "running") {
    return jsonNoStore(
      {
        error: "A shred job is already running for this session.",
      },
      { status: 409 },
    );
  }

  try {
    const body = (await request.json()) as { dryRun?: boolean };
    const dryRun = body?.dryRun !== false;
    const job = startSessionJob(session, dryRun);

    return jsonNoStore({
      jobId: job.jobId,
    });
  } catch (error) {
    return jsonError(error);
  }
}
