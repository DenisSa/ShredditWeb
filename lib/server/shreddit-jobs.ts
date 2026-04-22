import "server-only";

import {
  CleanupSettings,
  PreviewResult,
  RunProgress,
  RunReport,
} from "@/lib/shreddit-types";
import {
  createSessionRedditContext,
  RedditAuthError,
  RedditConnectivityError,
  RunConflictError,
  runShred,
  toUserMessage,
} from "@/lib/server/shreddit-core";
import {
  createJob,
  finalizeJob,
  ServerJobRecord,
  ServerSessionRecord,
  setJobProgress,
} from "@/lib/server/shreddit-store";
import { tryAcquireAccountRun, releaseAccountRun } from "@/lib/server/shreddit-run-coordinator";

function buildUnexpectedReport(
  session: ServerSessionRecord,
  preview: PreviewResult,
  settings: CleanupSettings,
  dryRun: boolean,
  runId: string,
  error: unknown,
  lastProgress: RunProgress | null,
) {
  const stopReasonCode =
    error instanceof RedditAuthError
      ? "auth-expired"
      : error instanceof RedditConnectivityError
      ? "connectivity"
      : "unexpected";

  return {
    runId,
    status: "stopped",
    stopReasonCode,
    stopReason: toUserMessage(error),
    startedAt: Date.now(),
    finishedAt: Date.now(),
    dryRun,
    storedDeletionHistory: settings.storeDeletionHistory,
    username: session.reddit?.username ?? preview.username,
    rules: preview.rules,
    totals: {
      discovered: preview.allItems.length,
      eligible: preview.eligibleItems.length,
      processed: lastProgress?.processed ?? 0,
      edited: lastProgress?.edited ?? 0,
      deleted: lastProgress?.deleted ?? 0,
      failed: lastProgress?.failed ?? 1,
    },
    failures: [],
  } satisfies RunReport;
}

function launchJob(
  job: ServerJobRecord,
  session: ServerSessionRecord,
  preview: PreviewResult,
  settings: CleanupSettings,
  dryRun: boolean,
) {
  void (async () => {
    try {
      const report = await runShred(
        createSessionRedditContext(session),
        preview,
        settings,
        dryRun,
        {
          runId: job.jobId,
          jobId: job.jobId,
          onProgress: (progress) => {
            setJobProgress(job, progress);
          },
        },
      );

      finalizeJob(job, report);
    } catch (error) {
      finalizeJob(job, buildUnexpectedReport(session, preview, settings, dryRun, job.jobId, error, job.progress));
    }
  })();
}

export function startSessionJob(session: ServerSessionRecord, settings: CleanupSettings, dryRun: boolean) {
  if (!session.preview) {
    throw new Error("Run a preview before starting a shred job.");
  }

  if (!session.reddit?.username) {
    throw new Error("Sign in with Reddit before starting a shred job.");
  }

  const lockAttempt = tryAcquireAccountRun(session.reddit.username, "manual");

  if (!lockAttempt.acquired) {
    throw new RunConflictError("A cleanup run is already active for this Reddit account.");
  }

  try {
    const job = createJob(session, session.reddit.username, dryRun);
    launchJob(job, session, session.preview, settings, dryRun);
    return job;
  } catch (error) {
    releaseAccountRun(session.reddit.username);
    throw error;
  }
}
