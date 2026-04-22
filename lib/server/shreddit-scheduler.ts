import "server-only";

import { randomUUID } from "node:crypto";
import {
  createAccountRedditContext,
  buildPreview as buildPreviewFromReddit,
  getDefaultCleanupSettings,
  RedditAuthError,
  RedditConnectivityError,
  runShred as runShredFromReddit,
  toUserMessage,
} from "@/lib/server/shreddit-core";
import {
  disableAccountSchedule,
  ensureAccountSettings,
  insertScheduledRun,
  listDueSchedules,
  loadPersistedAccountAuth,
  updateAccountScheduleRunState,
} from "@/lib/server/shreddit-db";
import {
  createScheduledRunMessage,
  advanceSchedule,
} from "@/lib/shreddit-schedule";
import { tryAcquireAccountRun, releaseAccountRun } from "@/lib/server/shreddit-run-coordinator";
import { ScheduledRunReasonCode, ScheduledRunStatus } from "@/lib/shreddit-types";

export type SchedulerDependencies = {
  listDueSchedules: typeof listDueSchedules;
  loadPersistedAccountAuth: typeof loadPersistedAccountAuth;
  ensureAccountSettings: typeof ensureAccountSettings;
  buildPreview: typeof buildPreviewFromReddit;
  runShred: typeof runShredFromReddit;
  insertScheduledRun: typeof insertScheduledRun;
  updateAccountScheduleRunState: typeof updateAccountScheduleRunState;
  disableAccountSchedule: typeof disableAccountSchedule;
  tryAcquireAccountRun: typeof tryAcquireAccountRun;
  releaseAccountRun: typeof releaseAccountRun;
  getDefaultCleanupSettings: typeof getDefaultCleanupSettings;
};

type GlobalWithScheduler = typeof globalThis & {
  __shredditSchedulerStarted?: boolean;
  __shredditSchedulerTickInFlight?: boolean;
};

const defaultDependencies: SchedulerDependencies = {
  listDueSchedules,
  loadPersistedAccountAuth,
  ensureAccountSettings,
  buildPreview: buildPreviewFromReddit,
  runShred: runShredFromReddit,
  insertScheduledRun,
  updateAccountScheduleRunState,
  disableAccountSchedule,
  tryAcquireAccountRun,
  releaseAccountRun,
  getDefaultCleanupSettings,
};

function getPollIntervalMs() {
  const configured = Number(process.env.SCHEDULER_POLL_INTERVAL_MS);

  if (Number.isFinite(configured) && configured >= 10_000) {
    return configured;
  }

  return 60_000;
}

function mapThrownError(error: unknown) {
  if (error instanceof RedditAuthError) {
    return {
      status: "stopped" as ScheduledRunStatus,
      reasonCode: "auth-expired" as ScheduledRunReasonCode,
      message: error.message,
    };
  }

  if (error instanceof RedditConnectivityError) {
    return {
      status: "stopped" as ScheduledRunStatus,
      reasonCode: "connectivity" as ScheduledRunReasonCode,
      message: error.message,
    };
  }

  return {
    status: "stopped" as ScheduledRunStatus,
    reasonCode: "unexpected" as ScheduledRunReasonCode,
    message: toUserMessage(error),
  };
}

async function processSchedule(
  schedule: ReturnType<typeof listDueSchedules>[number],
  now: number,
  dependencies: SchedulerDependencies,
) {
  const nextRunAt = advanceSchedule(schedule, now);
  const startedAt = now;
  const runId = randomUUID();
  const auth = dependencies.loadPersistedAccountAuth(schedule.username);

  if (!auth?.grant) {
    const message = "Reconnect Reddit to resume scheduled cleanup.";

    dependencies.insertScheduledRun({
      username: schedule.username,
      runId: null,
      status: "stopped",
      startedAt,
      finishedAt: now,
      message,
      reasonCode: "auth-expired",
      report: null,
    });
    dependencies.disableAccountSchedule(schedule.username, message);
    return;
  }

  const lockAttempt = dependencies.tryAcquireAccountRun(schedule.username, "scheduled");

  if (!lockAttempt.acquired) {
    const message = "Another cleanup run is already active for this Reddit account.";

    dependencies.insertScheduledRun({
      username: schedule.username,
      runId: null,
      status: "skipped",
      startedAt,
      finishedAt: now,
      message,
      reasonCode: "already-running",
      report: null,
    });
    dependencies.updateAccountScheduleRunState(schedule.username, {
      enabled: schedule.enabled,
      nextRunAt,
      lastRunAt: now,
      lastRunStatus: "skipped",
      lastRunMessage: message,
    });
    return;
  }

  try {
    const settings = dependencies.ensureAccountSettings(
      schedule.username,
      dependencies.getDefaultCleanupSettings(),
    );
    const context = createAccountRedditContext(auth);
    const preview = await dependencies.buildPreview(context, settings);
    const report = await dependencies.runShred(context, preview, settings, false, { runId });
    const runMessage = createScheduledRunMessage(report.status, report.stopReason ?? null);

    dependencies.insertScheduledRun({
      username: schedule.username,
      runId: report.runId,
      status: report.status,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      message: runMessage,
      reasonCode: report.stopReasonCode ?? null,
      report,
    });

    if (report.stopReasonCode === "auth-expired") {
      dependencies.disableAccountSchedule(schedule.username, runMessage);
      return;
    }

    dependencies.updateAccountScheduleRunState(schedule.username, {
      enabled: schedule.enabled,
      nextRunAt: advanceSchedule(schedule, report.finishedAt),
      lastRunAt: report.finishedAt,
      lastRunStatus: report.status,
      lastRunMessage: runMessage,
    });
  } catch (error) {
    const result = mapThrownError(error);
    const finishedAt = Date.now();

    dependencies.insertScheduledRun({
      username: schedule.username,
      runId: null,
      status: result.status,
      startedAt,
      finishedAt,
      message: result.message,
      reasonCode: result.reasonCode,
      report: null,
    });

    if (result.reasonCode === "auth-expired") {
      dependencies.disableAccountSchedule(schedule.username, result.message);
      return;
    }

    dependencies.updateAccountScheduleRunState(schedule.username, {
      enabled: schedule.enabled,
      nextRunAt: advanceSchedule(schedule, finishedAt),
      lastRunAt: finishedAt,
      lastRunStatus: result.status,
      lastRunMessage: result.message,
    });
  } finally {
    dependencies.releaseAccountRun(schedule.username);
  }
}

export async function processDueSchedules(now = Date.now(), dependencies: SchedulerDependencies = defaultDependencies) {
  const globalWithScheduler = globalThis as GlobalWithScheduler;

  if (globalWithScheduler.__shredditSchedulerTickInFlight) {
    return;
  }

  globalWithScheduler.__shredditSchedulerTickInFlight = true;

  try {
    const schedules = dependencies.listDueSchedules(now);

    for (const schedule of schedules) {
      // Process each due schedule serially so SQLite writes and Reddit API traffic stay predictable.
      await processSchedule(schedule, now, dependencies);
    }
  } finally {
    globalWithScheduler.__shredditSchedulerTickInFlight = false;
  }
}

export function startSchedulerLoop() {
  const globalWithScheduler = globalThis as GlobalWithScheduler;

  if (globalWithScheduler.__shredditSchedulerStarted) {
    return;
  }

  globalWithScheduler.__shredditSchedulerStarted = true;

  setInterval(() => {
    void processDueSchedules();
  }, getPollIntervalMs()).unref?.();

  void processDueSchedules();
}
