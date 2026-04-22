import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  JobSnapshot,
  PreviewResult,
  RunProgress,
  RunReport,
} from "@/lib/shreddit-types";
import {
  insertManualRun,
  deleteExpiredPersistedSessions,
  deletePersistedSession,
  loadPersistedSession,
  PersistedSessionRecord,
  upsertPersistedSession,
} from "@/lib/server/shreddit-db";
import { releaseAccountRun } from "@/lib/server/shreddit-run-coordinator";

const SESSION_COOKIE_NAME = "shreddit.sid";
const SESSION_MAX_AGE_DAYS = 30;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const FINISHED_JOB_TTL_MS = 30 * 60 * 1000;

export type ServerRedditGrant = {
  accessToken: string;
  refreshToken: string;
  obtainedAt: number;
  expiresAt: number;
  scope: string[];
  username: string;
};

export type ServerSessionRecord = {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  oauthState: string | null;
  reddit: ServerRedditGrant | null;
  preview: PreviewResult | null;
  activeJobId: string | null;
};

type JobListener = (event: "progress" | "complete" | "error", snapshot: JobSnapshot) => void;

export type ServerJobRecord = {
  jobId: string;
  sessionId: string;
  username: string;
  dryRun: boolean;
  status: JobSnapshot["status"];
  progress: RunProgress | null;
  report: RunReport | null;
  updatedAt: number;
  listeners: Set<JobListener>;
};

type ShredditStore = {
  previews: Map<string, PreviewResult>;
  jobs: Map<string, ServerJobRecord>;
  maintenanceStarted: boolean;
};

type GlobalWithStore = typeof globalThis & {
  __shredditStore?: ShredditStore;
};

function getStore() {
  const globalWithStore = globalThis as GlobalWithStore;

  if (!globalWithStore.__shredditStore) {
    globalWithStore.__shredditStore = {
      previews: new Map<string, PreviewResult>(),
      jobs: new Map<string, ServerJobRecord>(),
      maintenanceStarted: false,
    };
  }

  return globalWithStore.__shredditStore;
}

export function startStoreMaintenance() {
  const store = getStore();

  if (store.maintenanceStarted) {
    return;
  }

  store.maintenanceStarted = true;

  setInterval(() => {
    const now = Date.now();
    const expiredSessionIds = deleteExpiredPersistedSessions(now - getSessionMaxAgeMs());

    for (const sessionId of expiredSessionIds) {
      store.previews.delete(sessionId);
    }

    for (const [jobId, job] of store.jobs.entries()) {
      if (job.status !== "running" && now - job.updatedAt > FINISHED_JOB_TTL_MS) {
        store.jobs.delete(jobId);
      }
    }
  }, 60_000).unref?.();
}

function getSessionSecret() {
  return process.env.SESSION_SECRET?.trim() ?? null;
}

function getSessionMaxAgeMs() {
  const configuredDays = Number(process.env.SESSION_MAX_AGE_DAYS);

  if (Number.isFinite(configuredDays) && configuredDays > 0) {
    return configuredDays * 24 * 60 * 60 * 1000;
  }

  return SESSION_MAX_AGE_MS;
}

function signSessionId(sessionId: string, secret: string) {
  return createHmac("sha256", secret).update(sessionId).digest("base64url");
}

function encodeCookieValue(sessionId: string, secret: string) {
  return `${sessionId}.${signSessionId(sessionId, secret)}`;
}

function decodeCookieValue(value: string, secret: string) {
  const [sessionId, signature] = value.split(".", 2);

  if (!sessionId || !signature) {
    return null;
  }

  const expected = signSessionId(sessionId, secret);
  const encoder = new TextEncoder();
  const signatureBuffer = encoder.encode(signature);
  const expectedBuffer = encoder.encode(expected);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  return sessionId;
}

function toPersistedSession(session: ServerSessionRecord): PersistedSessionRecord {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    oauthState: session.oauthState,
    reddit: session.reddit,
    activeJobId: session.activeJobId,
  };
}

function hydrateSession(session: PersistedSessionRecord): ServerSessionRecord {
  return {
    ...session,
    preview: getStore().previews.get(session.id) ?? null,
  };
}

function saveSession(session: ServerSessionRecord) {
  upsertPersistedSession(toPersistedSession(session));
}

export function updateSession(
  session: ServerSessionRecord,
  updates: Partial<Pick<ServerSessionRecord, "lastSeenAt" | "oauthState" | "reddit" | "preview" | "activeJobId">>,
) {
  if ("lastSeenAt" in updates && updates.lastSeenAt !== undefined) {
    session.lastSeenAt = updates.lastSeenAt;
  }

  if ("oauthState" in updates) {
    session.oauthState = updates.oauthState ?? null;
  }

  if ("reddit" in updates) {
    session.reddit = updates.reddit ?? null;
  }

  if ("activeJobId" in updates) {
    session.activeJobId = updates.activeJobId ?? null;
  }

  if ("preview" in updates) {
    session.preview = updates.preview ?? null;

    if (updates.preview) {
      getStore().previews.set(session.id, updates.preview);
    } else {
      getStore().previews.delete(session.id);
    }
  }

  saveSession(session);
  return session;
}

export function setSessionCookie(response: NextResponse, sessionId: string) {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error("Missing SESSION_SECRET.");
  }

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: encodeCookieValue(sessionId, secret),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(getSessionMaxAgeMs() / 1000),
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function getSessionFromRequest(request: NextRequest) {
  startStoreMaintenance();

  const secret = getSessionSecret();

  if (!secret) {
    return null;
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!cookie) {
    return null;
  }

  const sessionId = decodeCookieValue(cookie, secret);

  if (!sessionId) {
    return null;
  }

  const persistedSession = loadPersistedSession(sessionId);

  if (!persistedSession) {
    return null;
  }

  const session = hydrateSession(persistedSession);
  updateSession(session, { lastSeenAt: Date.now() });

  return session;
}

export function getOrCreateSession(request: NextRequest) {
  const existing = getSessionFromRequest(request);

  if (existing) {
    return { session: existing, created: false };
  }

  const now = Date.now();
  const session: ServerSessionRecord = {
    id: randomUUID(),
    createdAt: now,
    lastSeenAt: now,
    oauthState: null,
    reddit: null,
    preview: null,
    activeJobId: null,
  };

  saveSession(session);
  return { session, created: true };
}

export function destroySession(sessionId: string | null | undefined) {
  if (!sessionId) {
    return;
  }

  getStore().previews.delete(sessionId);
  deletePersistedSession(sessionId);
}

export function getActiveJobForSession(session: ServerSessionRecord) {
  if (!session.activeJobId) {
    return null;
  }

  const job = getStore().jobs.get(session.activeJobId) ?? null;

  if (!job) {
    updateSession(session, { activeJobId: null });
  }

  return job;
}

export function serializeJob(job: ServerJobRecord): JobSnapshot {
  return {
    jobId: job.jobId,
    dryRun: job.dryRun,
    status: job.status,
    progress: job.progress,
    report: job.report,
    updatedAt: job.updatedAt,
  };
}

export function createJob(session: ServerSessionRecord, username: string, dryRun: boolean) {
  const now = Date.now();
  const job: ServerJobRecord = {
    jobId: randomUUID(),
    sessionId: session.id,
    username,
    dryRun,
    status: "running",
    progress: null,
    report: null,
    updatedAt: now,
    listeners: new Set<JobListener>(),
  };

  const store = getStore();
  store.jobs.set(job.jobId, job);
  updateSession(session, { activeJobId: job.jobId });
  return job;
}

export function getJob(jobId: string) {
  return getStore().jobs.get(jobId) ?? null;
}

function publishJobEvent(job: ServerJobRecord, event: "progress" | "complete" | "error") {
  const snapshot = serializeJob(job);

  for (const listener of job.listeners) {
    listener(event, snapshot);
  }
}

export function subscribeToJob(jobId: string, listener: JobListener) {
  const job = getJob(jobId);

  if (!job) {
    return null;
  }

  job.listeners.add(listener);

  return () => {
    job.listeners.delete(listener);
  };
}

export function setJobProgress(job: ServerJobRecord, progress: RunProgress) {
  job.progress = progress;
  job.updatedAt = Date.now();
  publishJobEvent(job, "progress");
}

export function finalizeJob(job: ServerJobRecord, report: RunReport) {
  job.report = report;
  job.status = report.status;
  job.updatedAt = Date.now();
  insertManualRun({
    username: job.username,
    report,
  });
  releaseAccountRun(job.username);
  publishJobEvent(job, report.status === "completed" ? "complete" : "error");
}
