import "server-only";

import {
  PreviewResult,
  RunProgress,
  RunReport,
} from "@/lib/shreddit-types";
import {
  RedditAuthError,
  RedditConnectivityError,
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

function buildUnexpectedReport(
  session: ServerSessionRecord,
  preview: PreviewResult,
  dryRun: boolean,
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
    status: "stopped",
    stopReasonCode,
    stopReason: toUserMessage(error),
    startedAt: Date.now(),
    finishedAt: Date.now(),
    dryRun,
    username: session.reddit?.username ?? preview.username,
    rules: preview.rules,
    totals: {
      discovered: preview.allItems.length,
      eligible: preview.eligibleItems.length,
      processed: lastProgress?.processed ?? 0,
      edited: 0,
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
  dryRun: boolean,
) {
  void (async () => {
    try {
      const report = await runShred(session, preview, dryRun, job.jobId, (progress) => {
        setJobProgress(job, progress);
      });

      finalizeJob(job, report);
    } catch (error) {
      finalizeJob(job, buildUnexpectedReport(session, preview, dryRun, error, job.progress));
    }
  })();
}

export function startSessionJob(session: ServerSessionRecord, dryRun: boolean) {
  if (!session.preview) {
    throw new Error("Run a preview before starting a shred job.");
  }

  const job = createJob(session, dryRun);
  launchJob(job, session, session.preview, dryRun);
  return job;
}
