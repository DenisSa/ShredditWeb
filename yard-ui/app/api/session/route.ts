import { NextRequest } from "next/server";
import { getPublicSessionDefaults } from "@/lib/server/shreddit-core";
import { jsonNoStore } from "@/lib/server/shreddit-responses";
import {
  getActiveJobForSession,
  getSessionFromRequest,
  serializeJob,
} from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const defaults = getPublicSessionDefaults();
  const session = getSessionFromRequest(request);
  const activeJob = session ? getActiveJobForSession(session) : null;

  return jsonNoStore({
    ...defaults,
    authenticated: Boolean(session?.reddit),
    username: session?.reddit?.username ?? null,
    scope: session?.reddit?.scope ?? [],
    expiresAt: session?.reddit?.expiresAt ?? null,
    activeJob: activeJob ? serializeJob(activeJob) : null,
  });
}
