import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  clearPersistedAccountGrant,
  disableAccountSchedule,
  ensureAccountPreferences,
  ensureAccountSettings,
  getLatestRunForUsername,
  listDeletedItemSnippetsForRunId,
  loadAccountSchedule,
  loadAccountPreferences,
  loadPersistedAccountAuth,
  insertDeletedItem,
  insertManualRun,
  insertScheduledRun,
  resetDatabaseForTests,
  upsertAccountSchedule,
  upsertAccountThemePreference,
  upsertPersistedAccountGrant,
  upsertPersistedSession,
  upsertAccountSettings,
} from "@/lib/server/shreddit-db";
import { destroySession } from "@/lib/server/shreddit-store";

describe("shreddit-db account lifecycle", () => {
  let sandboxDir: string;

  beforeEach(() => {
    sandboxDir = mkdtempSync(join(tmpdir(), "shreddit-ui-test-"));
    process.env.SQLITE_PATH = join(sandboxDir, "shreddit.sqlite");
    process.env.SESSION_SECRET = "test-session-secret";
    resetDatabaseForTests();
  });

  afterEach(() => {
    resetDatabaseForTests();
    rmSync(sandboxDir, { recursive: true, force: true });
  });

  it("seeds account settings from defaults on first sign-in and keeps saved settings afterward", () => {
    const seeded = ensureAccountSettings("alice", {
      minAgeDays: 7,
      maxScore: 100,
      storeDeletionHistory: true,
    });

    expect(seeded).toMatchObject({
      username: "alice",
      minAgeDays: 7,
      maxScore: 100,
      storeDeletionHistory: true,
    });

    upsertAccountSettings("alice", {
      minAgeDays: 30,
      maxScore: 10,
      storeDeletionHistory: false,
    });

    const resolved = ensureAccountSettings("alice", {
      minAgeDays: 1,
      maxScore: 2,
      storeDeletionHistory: true,
    });

    expect(resolved).toMatchObject({
      minAgeDays: 30,
      maxScore: 10,
      storeDeletionHistory: false,
    });
  });

  it("full disconnect clears durable auth and disables scheduling", () => {
    upsertPersistedAccountGrant({
      accessToken: "token",
      refreshToken: "refresh",
      obtainedAt: 1,
      expiresAt: 2,
      scope: ["identity", "history", "edit"],
      username: "alice",
    });
    upsertAccountSchedule("alice", {
      enabled: true,
      cadence: "daily",
      minuteUtc: 15,
      hourUtc: 8,
      weekdayUtc: null,
      nextRunAt: 123,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null,
    });

    clearPersistedAccountGrant("alice", true);
    disableAccountSchedule("alice", "Reconnect Reddit to resume scheduled cleanup.");

    expect(loadPersistedAccountAuth("alice")).toMatchObject({
      grant: null,
      requiresReconnect: true,
    });
    expect(loadAccountSchedule("alice")).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
  });

  it("device logout removes only the local session and leaves scheduling enabled", () => {
    upsertPersistedAccountGrant({
      accessToken: "token",
      refreshToken: "refresh",
      obtainedAt: 1,
      expiresAt: 2,
      scope: ["identity", "history", "edit"],
      username: "alice",
    });
    upsertAccountSchedule("alice", {
      enabled: true,
      cadence: "weekly",
      minuteUtc: 15,
      hourUtc: 8,
      weekdayUtc: 1,
      nextRunAt: 456,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null,
    });
    upsertPersistedSession({
      id: "session-1",
      createdAt: 1,
      lastSeenAt: 2,
      oauthState: null,
      reddit: {
        accessToken: "token",
        refreshToken: "refresh",
        obtainedAt: 1,
        expiresAt: 2,
        scope: ["identity", "history", "edit"],
        username: "alice",
      },
      activeJobId: null,
    });

    destroySession("session-1");

    expect(loadPersistedAccountAuth("alice")?.grant?.username).toBe("alice");
    expect(loadAccountSchedule("alice")?.enabled).toBe(true);
  });

  it("upgrades legacy account preferences rows with a default dark theme", () => {
    const database = new DatabaseSync(join(sandboxDir, "shreddit.sqlite"));
    database.exec(`
      CREATE TABLE account_preferences (
        username TEXT PRIMARY KEY COLLATE NOCASE,
        store_deletion_history INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO account_preferences (username, store_deletion_history, updated_at)
      VALUES ('alice', 1, 123);
    `);
    database.close();
    resetDatabaseForTests();

    expect(loadAccountPreferences("alice")).toMatchObject({
      username: "alice",
      theme: "dark",
    });
    expect(ensureAccountPreferences("alice").theme).toBe("dark");
  });

  it("persists theme preference per account", () => {
    expect(ensureAccountPreferences("alice").theme).toBe("dark");

    upsertAccountThemePreference("alice", "light");

    expect(loadAccountPreferences("alice")).toMatchObject({
      username: "alice",
      theme: "light",
    });
  });

  it("selects the latest executed run and returns deleted snippets by run id", () => {
    const manualReport = {
      runId: "manual-run-1",
      status: "completed" as const,
      startedAt: Date.parse("2026-04-20T09:00:00Z"),
      finishedAt: Date.parse("2026-04-20T09:05:00Z"),
      dryRun: false,
      storedDeletionHistory: true,
      username: "alice",
      rules: {
        minAgeDays: 7,
        maxScore: 100,
        cutoffUnix: 1,
      },
      totals: {
        discovered: 2,
        eligible: 2,
        processed: 2,
        edited: 1,
        deleted: 2,
        failed: 0,
      },
      failures: [],
    };
    const scheduledReport = {
      ...manualReport,
      runId: "scheduled-run-1",
      finishedAt: Date.parse("2026-04-20T10:05:00Z"),
    };

    insertManualRun({
      username: "alice",
      report: manualReport,
    });
    insertScheduledRun({
      username: "alice",
      runId: null,
      status: "skipped",
      startedAt: Date.parse("2026-04-20T10:30:00Z"),
      finishedAt: Date.parse("2026-04-20T10:30:00Z"),
      message: "Already running.",
      reasonCode: "already-running",
      report: null,
    });
    insertScheduledRun({
      username: "alice",
      runId: scheduledReport.runId,
      status: scheduledReport.status,
      startedAt: scheduledReport.startedAt,
      finishedAt: scheduledReport.finishedAt,
      message: "Completed",
      reasonCode: null,
      report: scheduledReport,
    });
    insertDeletedItem({
      deletedAt: Date.parse("2026-04-20T10:04:00Z"),
      runId: scheduledReport.runId,
      sessionId: "scheduled:alice",
      jobId: null,
      username: "alice",
      item: {
        id: "t1_1",
        name: "t1_1",
        thingKind: "t1",
        contentKind: "comment",
        title: "",
        body: "First deleted comment",
        score: 1,
        createdUtc: 1,
        subreddit: "typescript",
        permalink: "https://reddit.example/1",
        eligible: true,
        reason: "",
      },
      editedBeforeDelete: true,
      rules: scheduledReport.rules,
    });
    insertDeletedItem({
      deletedAt: Date.parse("2026-04-20T10:03:00Z"),
      runId: scheduledReport.runId,
      sessionId: "scheduled:alice",
      jobId: null,
      username: "alice",
      item: {
        id: "t3_1",
        name: "t3_1",
        thingKind: "t3",
        contentKind: "selfPost",
        title: "Deleted post title",
        body: "Deleted post body",
        score: 1,
        createdUtc: 1,
        subreddit: "nextjs",
        permalink: "https://reddit.example/2",
        eligible: true,
        reason: "",
      },
      editedBeforeDelete: false,
      rules: scheduledReport.rules,
    });

    expect(getLatestRunForUsername("alice")).toMatchObject({
      source: "scheduled",
      report: {
        runId: "scheduled-run-1",
      },
    });
    expect(listDeletedItemSnippetsForRunId("scheduled-run-1", 3)).toEqual([
      expect.objectContaining({
        subreddit: "typescript",
        body: "First deleted comment",
      }),
      expect.objectContaining({
        subreddit: "nextjs",
        title: "Deleted post title",
      }),
    ]);
  });
});
