import { NextRequest } from "next/server";
import { DEFAULT_STORE_DELETION_HISTORY } from "@/lib/shreddit-types";
import { getStoreDeletionHistoryPreference } from "@/lib/server/shreddit-db";
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
  const storeDeletionHistory = session?.reddit
    ? getStoreDeletionHistoryPreference(session.reddit.username)
    : DEFAULT_STORE_DELETION_HISTORY;

  return jsonNoStore({
    ...defaults,
    authenticated: Boolean(session?.reddit),
    username: session?.reddit?.username ?? null,
    scope: session?.reddit?.scope ?? [],
    expiresAt: session?.reddit?.expiresAt ?? null,
    activeJob: activeJob ? serializeJob(activeJob) : null,
    preferences: {
      storeDeletionHistory,
    },
  });
}
