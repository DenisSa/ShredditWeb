import { vi } from "vitest";
import { RedditAuthError, RedditConnectivityError } from "@/lib/server/shreddit-core";
import { processDueSchedules, type SchedulerDependencies } from "@/lib/server/shreddit-scheduler";
import { resetRunCoordinatorForTests } from "@/lib/server/shreddit-run-coordinator";
import { CleanupSettings, PreviewResult, RunReport } from "@/lib/shreddit-types";

const dueSchedule = {
  username: "alice",
  enabled: true,
  cadence: "daily" as const,
  minuteUtc: 15,
  hourUtc: 8,
  weekdayUtc: null,
  nextRunAt: Date.parse("2026-04-19T08:15:00Z"),
  lastRunAt: null,
  lastRunStatus: null,
  lastRunMessage: null,
  updatedAt: Date.parse("2026-04-18T08:15:00Z"),
};

const cleanupSettings = {
  minAgeDays: 7,
  maxScore: 100,
  storeDeletionHistory: true,
};

function createDependencies(overrides: Partial<SchedulerDependencies> = {}): any {
  return {
    listDueSchedules: vi.fn(() => [dueSchedule]),
    loadPersistedAccountAuth: vi.fn(() => ({
      username: "alice",
      grant: {
        accessToken: "token",
        refreshToken: "refresh",
        obtainedAt: 1,
        expiresAt: 2,
        scope: ["identity", "history", "edit"],
        username: "alice",
      },
      requiresReconnect: false,
      updatedAt: 1,
    })),
    ensureAccountSettings: vi.fn(() => ({
      username: "alice",
      updatedAt: 1,
      ...cleanupSettings,
    })),
    buildPreview: vi.fn(async (_context: unknown, settings: CleanupSettings) => ({
      username: "alice",
      generatedAt: 1,
      rules: {
        minAgeDays: settings.minAgeDays,
        maxScore: settings.maxScore,
        cutoffUnix: 1,
      },
      allItems: [],
      eligibleItems: [],
      counts: {
        commentsDiscovered: 0,
        postsDiscovered: 0,
        eligibleComments: 0,
        eligiblePosts: 0,
      },
    })),
    runShred: vi.fn(async (_context: unknown, preview: PreviewResult, settings: CleanupSettings) => ({
      status: "completed",
      stopReasonCode: undefined,
      stopReason: undefined,
      startedAt: Date.parse("2026-04-19T08:16:00Z"),
      finishedAt: Date.parse("2026-04-19T08:20:00Z"),
      dryRun: false,
      username: "alice",
      rules: preview.rules,
      totals: {
        discovered: 0,
        eligible: 0,
        processed: 0,
        edited: 0,
        deleted: 0,
        failed: 0,
      },
      failures: [],
    }) satisfies RunReport),
    insertScheduledRun: vi.fn(() => 1),
    updateAccountScheduleRunState: vi.fn(),
    disableAccountSchedule: vi.fn(),
    tryAcquireAccountRun: vi.fn(() => ({
      acquired: true,
      activeSource: "scheduled" as const,
    })),
    releaseAccountRun: vi.fn(),
    getDefaultCleanupSettings: vi.fn(() => cleanupSettings),
    ...overrides,
  };
}

describe("shreddit-scheduler", () => {
  beforeEach(() => {
    resetRunCoordinatorForTests();
  });

  it("executes due schedules once and uses the same settings for preview and execution", async () => {
    const dependencies = createDependencies();

    await processDueSchedules(Date.parse("2026-04-19T08:16:00Z"), dependencies);

    expect(dependencies.buildPreview).toHaveBeenCalledTimes(1);
    expect(dependencies.runShred).toHaveBeenCalledTimes(1);
    expect(dependencies.runShred.mock.calls[0][2]).toEqual(expect.objectContaining(cleanupSettings));
    expect(dependencies.updateAccountScheduleRunState).toHaveBeenCalledWith("alice", expect.objectContaining({
      enabled: true,
      lastRunStatus: "completed",
      nextRunAt: Date.parse("2026-04-20T08:15:00Z"),
    }));
  });

  it("records skipped runs when another cleanup is already active", async () => {
    const dependencies = createDependencies({
      tryAcquireAccountRun: vi.fn(() => ({
        acquired: false,
        activeSource: "manual" as const,
      })),
    });

    await processDueSchedules(Date.parse("2026-04-19T08:16:00Z"), dependencies);

    expect(dependencies.buildPreview).not.toHaveBeenCalled();
    expect(dependencies.insertScheduledRun).toHaveBeenCalledWith(expect.objectContaining({
      status: "skipped",
      reasonCode: "already-running",
    }));
    expect(dependencies.updateAccountScheduleRunState).toHaveBeenCalledWith("alice", expect.objectContaining({
      lastRunStatus: "skipped",
    }));
  });

  it("disables the schedule when Reddit auth fails", async () => {
    const dependencies = createDependencies({
      runShred: vi.fn(async () => {
        throw new RedditAuthError("Reconnect required.");
      }),
    });

    await processDueSchedules(Date.parse("2026-04-19T08:16:00Z"), dependencies);

    expect(dependencies.disableAccountSchedule).toHaveBeenCalledWith("alice", "Reconnect required.");
  });

  it("keeps the schedule enabled on connectivity or unexpected failures", async () => {
    const dependencies = createDependencies({
      buildPreview: vi.fn(async () => {
        throw new RedditConnectivityError("Network issue.");
      }),
    });

    await processDueSchedules(Date.parse("2026-04-19T08:16:00Z"), dependencies);

    expect(dependencies.disableAccountSchedule).not.toHaveBeenCalled();
    expect(dependencies.updateAccountScheduleRunState).toHaveBeenCalledWith("alice", expect.objectContaining({
      lastRunStatus: "stopped",
      lastRunMessage: "Network issue.",
    }));
  });
});
