import {
  PreviewItem,
  PreviewResult,
  REQUIRED_SCOPES,
  RunReport,
  SessionSummary,
  JobSnapshot,
} from "@/lib/shreddit-types";

export type {
  JobSnapshot,
  PreviewProgress,
  PreviewResult,
  RunProgress,
  RunReport,
  SessionSummary,
} from "@/lib/shreddit-types";

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim()
  ) {
    return payload.error;
  }

  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  return fallback;
}

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function fetchJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `${response.status} ${response.statusText}`));
  }

  return payload as T;
}

export async function fetchSessionSummary() {
  return fetchJson<SessionSummary>("/api/session");
}

export async function requestPreview() {
  return fetchJson<PreviewResult>("/api/preview", {
    method: "POST",
  });
}

export async function startRun(dryRun: boolean) {
  return fetchJson<{ jobId: string }>("/api/run/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dryRun }),
  });
}

export async function fetchRunStatus(jobId: string) {
  return fetchJson<JobSnapshot>(`/api/run/status?jobId=${encodeURIComponent(jobId)}`);
}

export async function logoutRedditSession() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await readResponsePayload(response);
    throw new Error(getErrorMessage(payload, "Unable to clear the current Reddit session."));
  }
}

type RunEventHandlers = {
  onProgress?: (job: JobSnapshot) => void;
  onComplete?: (job: JobSnapshot) => void;
  onError?: (job: JobSnapshot) => void;
};

function parseEventPayload(event: MessageEvent) {
  return JSON.parse(event.data) as JobSnapshot;
}

export function subscribeToRunEvents(jobId: string, handlers: RunEventHandlers) {
  const eventSource = new EventSource(`/api/run/events?jobId=${encodeURIComponent(jobId)}`);

  eventSource.addEventListener("progress", (event) => {
    handlers.onProgress?.(parseEventPayload(event as MessageEvent));
  });

  eventSource.addEventListener("complete", (event) => {
    handlers.onComplete?.(parseEventPayload(event as MessageEvent));
  });

  eventSource.addEventListener("error", (event) => {
    if (event instanceof MessageEvent) {
      handlers.onError?.(parseEventPayload(event));
    }
  });

  return eventSource;
}

function requiredScopeSet(scopes: string[]) {
  return REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
}

function trimSnippet(value: string, maxLength = 88) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function getItemSummary(item: PreviewItem) {
  if (item.contentKind === "comment") {
    return trimSnippet(item.body, 92) || `Comment in r/${item.subreddit}`;
  }

  return trimSnippet(item.title, 92) || `Post in r/${item.subreddit}`;
}

export function createReportDownload(report: RunReport) {
  return new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json",
  });
}

export function formatAgeInDays(createdUtc: number) {
  const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - createdUtc);
  const days = ageSeconds / (24 * 60 * 60);

  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours}h old`;
  }

  return `${Math.floor(days)}d old`;
}

export function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
}

export function formatExpiry(expiresAt: number | null) {
  if (!expiresAt) {
    return "not connected";
  }

  const msLeft = expiresAt - Date.now();

  if (msLeft <= 0) {
    return "expired";
  }

  const minutes = Math.floor(msLeft / 60_000);
  const seconds = Math.floor((msLeft % 60_000) / 1000);

  return `${minutes}m ${seconds.toString().padStart(2, "0")}s left`;
}

export function validateScopes(summary: Pick<SessionSummary, "scope">) {
  return requiredScopeSet(summary.scope);
}

export function startOauthRedirect(location: Location) {
  location.assign("/api/auth/reddit/start");
}

export function toUserMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something unexpected went wrong.";
}
