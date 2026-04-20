import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearPersistedAccountGrant,
  disableAccountSchedule,
  ensureAccountSettings,
  loadAccountSchedule,
  loadPersistedAccountAuth,
  resetDatabaseForTests,
  upsertAccountSchedule,
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
});
