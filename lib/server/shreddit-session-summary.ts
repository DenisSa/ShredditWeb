import "server-only";

import {
  DEFAULT_STORE_DELETION_HISTORY,
  type ScheduledRunSummary,
  type SessionSummary,
} from "@/lib/shreddit-types";
import {
  ensureAccountPreferences,
  ensureAccountSettings,
  getLatestRunForUsername,
  getLatestScheduledRunForUsername,
  listDeletedItemSnippetsForRunId,
  listScheduledRunsForUsername,
  loadAccountSchedule,
  loadPersistedAccountAuth,
  upsertPersistedAccountGrant,
} from "@/lib/server/shreddit-db";
import {
  getDefaultCleanupSettings,
  getPublicSessionDefaults,
} from "@/lib/server/shreddit-core";
import { DEFAULT_THEME_PREFERENCE } from "@/lib/server/shreddit-theme";
import {
  getActiveJobForSession,
  serializeJob,
  type ServerSessionRecord,
} from "@/lib/server/shreddit-store";

export function buildSessionSummary(session: ServerSessionRecord | null): SessionSummary {
  const defaults = getPublicSessionDefaults();
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

  return {
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
  };
}

export function listRecentScheduledRunsForSession(
  session: ServerSessionRecord | null,
  limit = 8,
): ScheduledRunSummary[] {
  if (!session?.reddit) {
    return [];
  }

  return listScheduledRunsForUsername(session.reddit.username, limit);
}
