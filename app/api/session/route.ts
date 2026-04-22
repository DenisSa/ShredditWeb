import { NextRequest } from "next/server";
import {
  DEFAULT_STORE_DELETION_HISTORY,
} from "@/lib/shreddit-types";
import {
  ensureAccountSettings,
  ensureAccountPreferences,
  getLatestRunForUsername,
  getLatestScheduledRunForUsername,
  listDeletedItemSnippetsForRunId,
  loadAccountSchedule,
  loadPersistedAccountAuth,
  upsertPersistedAccountGrant,
} from "@/lib/server/shreddit-db";
import {
  getDefaultCleanupSettings,
  getPublicSessionDefaults,
} from "@/lib/server/shreddit-core";
import { jsonNoStore } from "@/lib/server/shreddit-responses";
import { DEFAULT_THEME_PREFERENCE } from "@/lib/server/shreddit-theme";
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
  const accountSettings = session?.reddit
    ? ensureAccountSettings(session.reddit.username, getDefaultCleanupSettings())
    : {
        ...getDefaultCleanupSettings(),
        storeDeletionHistory: DEFAULT_STORE_DELETION_HISTORY,
      };
  const accountPreferences = session?.reddit
    ? ensureAccountPreferences(session.reddit.username)
    : {
        theme: DEFAULT_THEME_PREFERENCE,
      };
  const accountAuth =
    session?.reddit
      ? (() => {
          const persisted = loadPersistedAccountAuth(session.reddit.username);

          if (!persisted) {
            return upsertPersistedAccountGrant(session.reddit);
          }

          return persisted;
        })()
      : null;
  const schedule = session?.reddit ? loadAccountSchedule(session.reddit.username) : null;
  const lastScheduledRun = session?.reddit ? getLatestScheduledRunForUsername(session.reddit.username) : null;
  const lastRun = session?.reddit ? getLatestRunForUsername(session.reddit.username) : null;
  const lastRunDeletedSnippets =
    lastRun && !lastRun.report.dryRun && lastRun.report.storedDeletionHistory
      ? listDeletedItemSnippetsForRunId(lastRun.report.runId, 3)
      : [];

  return jsonNoStore({
    ...defaults,
    minAgeDays: accountSettings.minAgeDays,
    maxScore: accountSettings.maxScore,
    authenticated: Boolean(session?.reddit),
    username: session?.reddit?.username ?? null,
    scope: session?.reddit?.scope ?? [],
    expiresAt: session?.reddit?.expiresAt ?? null,
    activeJob: activeJob ? serializeJob(activeJob) : null,
    settings: accountSettings,
    preferences: {
      storeDeletionHistory: accountSettings.storeDeletionHistory,
      theme: accountPreferences.theme,
    },
    schedule,
    requiresReconnect: accountAuth?.requiresReconnect ?? false,
    lastScheduledRun,
    lastRun,
    lastRunDeletedSnippets,
  });
}
