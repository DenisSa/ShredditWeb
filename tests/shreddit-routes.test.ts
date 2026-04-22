import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { vi } from "vitest";

vi.mock("@/lib/server/shreddit-store", () => ({
  getSessionFromRequest: vi.fn(),
  getActiveJobForSession: vi.fn(() => null),
  serializeJob: vi.fn((job: unknown) => job),
}));

import { GET as getSessionRoute } from "@/app/api/session/route";
import { POST as postThemeRoute } from "@/app/api/settings/theme/route";
import {
  insertDeletedItem,
  insertManualRun,
  insertScheduledRun,
  resetDatabaseForTests,
  upsertAccountSettings,
  upsertAccountThemePreference,
  upsertPersistedAccountGrant,
  loadAccountPreferences,
} from "@/lib/server/shreddit-db";
import {
  getSessionFromRequest,
} from "@/lib/server/shreddit-store";

describe("shreddit route payloads", () => {
  let sandboxDir: string;

  beforeEach(() => {
    sandboxDir = mkdtempSync(join(tmpdir(), "shreddit-route-test-"));
    process.env.SQLITE_PATH = join(sandboxDir, "shreddit.sqlite");
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.REDDIT_CLIENT_ID = "client-id";
    process.env.REDDIT_CLIENT_SECRET = "client-secret";
    process.env.REDDIT_REDIRECT_URI = "http://localhost:3000/api/auth/reddit/callback";
    resetDatabaseForTests();
    vi.mocked(getSessionFromRequest).mockReset();
  });

  afterEach(() => {
    resetDatabaseForTests();
    rmSync(sandboxDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("returns theme, latest run, and deleted snippets from the session payload", async () => {
    const redditGrant = {
      accessToken: "token",
      refreshToken: "refresh",
      obtainedAt: 1,
      expiresAt: 2,
      scope: ["identity", "history", "edit"],
      username: "alice",
    };
    const manualReport = {
      runId: "manual-run-1",
      status: "completed" as const,
      startedAt: Date.parse("2026-04-20T08:00:00Z"),
      finishedAt: Date.parse("2026-04-20T08:05:00Z"),
      dryRun: false,
      storedDeletionHistory: true,
      username: "alice",
      rules: {
        minAgeDays: 7,
        maxScore: 100,
        cutoffUnix: 1,
      },
      totals: {
        discovered: 1,
        eligible: 1,
        processed: 1,
        edited: 1,
        deleted: 1,
        failed: 0,
      },
      failures: [],
    };
    const scheduledReport = {
      ...manualReport,
      runId: "scheduled-run-1",
      finishedAt: Date.parse("2026-04-20T09:05:00Z"),
    };

    upsertPersistedAccountGrant(redditGrant);
    upsertAccountSettings("alice", {
      minAgeDays: 7,
      maxScore: 100,
      storeDeletionHistory: true,
    });
    upsertAccountThemePreference("alice", "light");
    insertManualRun({
      username: "alice",
      report: manualReport,
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
      deletedAt: Date.parse("2026-04-20T09:04:00Z"),
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
        body: "Stored deleted comment",
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

    vi.mocked(getSessionFromRequest).mockReturnValue({
      id: "session-1",
      createdAt: 1,
      lastSeenAt: 1,
      oauthState: null,
      reddit: redditGrant,
      preview: null,
      activeJobId: null,
    });

    const response = await getSessionRoute(new NextRequest("http://localhost:3000/api/session"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preferences.theme).toBe("light");
    expect(payload.lastRun).toMatchObject({
      source: "scheduled",
      report: {
        runId: "scheduled-run-1",
      },
    });
    expect(payload.lastRunDeletedSnippets).toEqual([
      expect.objectContaining({
        subreddit: "typescript",
        body: "Stored deleted comment",
      }),
    ]);
  });

  it("rejects signed-out theme changes", async () => {
    vi.mocked(getSessionFromRequest).mockReturnValue(null);

    const response = await postThemeRoute(
      new NextRequest("http://localhost:3000/api/settings/theme", {
        method: "POST",
        body: JSON.stringify({ theme: "light" }),
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("persists authenticated theme changes and sets a theme cookie", async () => {
    vi.mocked(getSessionFromRequest).mockReturnValue({
      id: "session-1",
      createdAt: 1,
      lastSeenAt: 1,
      oauthState: null,
      reddit: {
        accessToken: "token",
        refreshToken: "refresh",
        obtainedAt: 1,
        expiresAt: 2,
        scope: ["identity", "history", "edit"],
        username: "alice",
      },
      preview: null,
      activeJobId: null,
    });

    const response = await postThemeRoute(
      new NextRequest("http://localhost:3000/api/settings/theme", {
        method: "POST",
        body: JSON.stringify({ theme: "light" }),
        headers: {
          "Content-Type": "application/json",
        },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.theme).toBe("light");
    expect(loadAccountPreferences("alice")?.theme).toBe("light");
    expect(response.headers.get("set-cookie")).toContain("shreddit.theme=light");
  });
});
