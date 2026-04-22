import "server-only";

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  ensureAccountPreferences,
  clearPersistedAccountGrant,
  ensureAccountSettings,
  insertDeletedItem,
  PersistedRedditGrant,
  upsertPersistedAccountGrant,
} from "@/lib/server/shreddit-db";
import {
  CleanupSettings,
  PreviewItem,
  PreviewProgress,
  PreviewResult,
  REQUIRED_SCOPES,
  RunFailure,
  RunProgress,
  RunReport,
  SessionSummary,
  ShredRules,
} from "@/lib/shreddit-types";
import { ServerSessionRecord, updateSession } from "@/lib/server/shreddit-store";

const COMMENT_EDIT_DELAY_MS = 1100;
const DELETE_DELAY_MS = 200;
const DRY_RUN_DELAY_MS = 25;
const ACCESS_TOKEN_LEEWAY_MS = 30_000;
const DEFAULT_REDDIT_USERNAME = "shredditweb";
const COMMENT_SNIPPET_WORDS = [
  "lorem",
  "ipsum",
  "quiet",
  "ember",
  "paper",
  "signal",
  "window",
  "river",
  "cedar",
  "marble",
  "linen",
  "harbor",
  "cinder",
  "saffron",
  "orbit",
  "parcel",
];

type ServerRuntimeConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  authConfigured: boolean;
  configurationError: string | null;
  minAgeDays: number;
  maxScore: number;
};

type ListingChild<T> = {
  kind: string;
  data: T;
};

type ListingResponse<T> = {
  data: {
    after: string | null;
    children: Array<ListingChild<T>>;
  };
};

type RedditMeResponse = {
  name: string;
};

type RedditComment = {
  id: string;
  name: string;
  body: string;
  score: number;
  created_utc: number;
  subreddit: string;
  permalink: string;
};

type RedditSubmission = {
  id: string;
  name: string;
  selftext: string;
  title: string;
  score: number;
  created_utc: number;
  subreddit: string;
  permalink: string;
  is_self: boolean;
};

type RedditTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type RequestErrorBody = unknown;

export type RedditRuntimeContext = {
  id: string;
  sessionId: string | null;
  usernameHint: string | null;
  reddit: PersistedRedditGrant | null;
  persistGrant: (grant: PersistedRedditGrant | null) => void;
};

export class RedditAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedditAuthError";
  }
}

export class RedditConnectivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedditConnectivityError";
  }
}

export class RedditRequestError extends Error {
  status: number;
  details: RequestErrorBody;

  constructor(message: string, status: number, details: RequestErrorBody) {
    super(message);
    this.name = "RedditRequestError";
    this.status = status;
    this.details = details;
  }
}

export class RunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunConflictError";
  }
}

function readNumberEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getServerRuntimeConfig(): ServerRuntimeConfig {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = process.env.REDDIT_REDIRECT_URI?.trim() ?? "";
  const sessionSecret = process.env.SESSION_SECRET?.trim() ?? "";
  const minAgeDays = readNumberEnv(process.env.NEXT_PUBLIC_MIN_AGE_DAYS, 7);
  const maxScore = readNumberEnv(process.env.NEXT_PUBLIC_MAX_SCORE, 100);

  const missing: string[] = [];

  if (!clientId) {
    missing.push("REDDIT_CLIENT_ID");
  }

  if (!clientSecret) {
    missing.push("REDDIT_CLIENT_SECRET");
  }

  if (!redirectUri) {
    missing.push("REDDIT_REDIRECT_URI");
  }

  if (!sessionSecret) {
    missing.push("SESSION_SECRET");
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    sessionSecret,
    authConfigured: missing.length === 0,
    configurationError:
      missing.length > 0
        ? `Missing required server env: ${missing.join(", ")}.`
        : null,
    minAgeDays,
    maxScore,
  };
}

function requireServerRuntimeConfig() {
  const config = getServerRuntimeConfig();

  if (!config.authConfigured) {
    throw new Error(config.configurationError ?? "Server auth configuration is incomplete.");
  }

  return config;
}

export function getDefaultCleanupSettings() {
  const config = getServerRuntimeConfig();

  return {
    minAgeDays: config.minAgeDays,
    maxScore: config.maxScore,
    storeDeletionHistory: true,
  } satisfies CleanupSettings;
}

export function createRulesFromCleanupSettings(settings: Pick<CleanupSettings, "minAgeDays" | "maxScore">, now = Date.now()) {
  return {
    minAgeDays: settings.minAgeDays,
    maxScore: settings.maxScore,
    cutoffUnix: Math.floor(now / 1000) - settings.minAgeDays * 24 * 60 * 60,
  } satisfies ShredRules;
}

export function getPublicSessionDefaults() {
  const config = getServerRuntimeConfig();

  return {
    authConfigured: config.authConfigured,
    configurationError: config.configurationError,
    redirectUri: config.redirectUri,
    minAgeDays: config.minAgeDays,
    maxScore: config.maxScore,
  } satisfies Pick<
    SessionSummary,
    "authConfigured" | "configurationError" | "redirectUri" | "minAgeDays" | "maxScore"
  >;
}

export function createOauthState() {
  return randomUUID();
}

function normalizeScopes(scopeValue: string | null | undefined) {
  if (!scopeValue) {
    return [];
  }

  return scopeValue
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function buildUserAgent(username = DEFAULT_REDDIT_USERNAME) {
  return `linux:shredditweb:1.0.0 (by /u/${username})`;
}

export function buildOauthAuthorizeUrl(state: string) {
  const config = requireServerRuntimeConfig();
  const url = new URL("https://www.reddit.com/api/v1/authorize");

  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("duration", "permanent");
  url.searchParams.set("scope", REQUIRED_SCOPES.join(" "));

  return url.toString();
}

function buildOAuthHeaders() {
  const config = requireServerRuntimeConfig();
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  return {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": buildUserAgent(),
  };
}

function buildRedditHeaders(accessToken?: string, contentType?: string, username?: string) {
  return {
    Accept: "application/json",
    "User-Agent": buildUserAgent(username),
    ...(accessToken ? { Authorization: `bearer ${accessToken}` } : {}),
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

async function readErrorBody(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function getErrorMessage(response: Response, details: RequestErrorBody) {
  if (typeof details === "string" && details.trim()) {
    return `Reddit returned ${response.status} ${response.statusText}. ${details}`.trim();
  }

  return `Reddit returned ${response.status} ${response.statusText}.`;
}

async function fetchIdentity(accessToken: string) {
  const response = await fetch("https://oauth.reddit.com/api/v1/me", {
    cache: "no-store",
    headers: buildRedditHeaders(accessToken),
  });

  if (!response.ok) {
    const details = await readErrorBody(response);
    throw new RedditRequestError(getErrorMessage(response, details), response.status, details);
  }

  return (await response.json()) as RedditMeResponse;
}

async function requestToken(formData: URLSearchParams) {
  let response: Response;

  try {
    response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      cache: "no-store",
      headers: buildOAuthHeaders(),
      body: formData.toString(),
    });
  } catch {
    throw new RedditConnectivityError("The server could not reach Reddit while requesting an OAuth token.");
  }

  const details = response.ok ? null : await readErrorBody(response);

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new RedditAuthError("Reddit rejected the app credentials or token refresh request.");
    }

    throw new RedditRequestError(getErrorMessage(response, details), response.status, details);
  }

  return (await response.json()) as RedditTokenResponse;
}

export async function exchangeAuthorizationCode(code: string) {
  const config = requireServerRuntimeConfig();
  const tokenData = await requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  );

  if (!tokenData.access_token || !tokenData.refresh_token || !tokenData.expires_in) {
    throw new RedditAuthError("Reddit returned an incomplete authorization-code response.");
  }

  const me = await fetchIdentity(tokenData.access_token);
  const now = Date.now();

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    obtainedAt: now,
    expiresAt: now + tokenData.expires_in * 1000,
    scope: normalizeScopes(tokenData.scope),
    username: me.name,
  } satisfies PersistedRedditGrant;
}

export function createSessionRedditContext(session: ServerSessionRecord): RedditRuntimeContext {
  return {
    id: `session:${session.id}`,
    sessionId: session.id,
    usernameHint: session.reddit?.username ?? null,
    reddit: session.reddit,
    persistGrant(grant) {
      const previousUsername = session.reddit?.username ?? this.usernameHint;

      updateSession(session, { reddit: grant as ServerSessionRecord["reddit"] });

      if (grant) {
        upsertPersistedAccountGrant(grant);
      } else if (previousUsername) {
        clearPersistedAccountGrant(previousUsername, true);
      }

      this.reddit = grant;
      this.usernameHint = grant?.username ?? previousUsername ?? this.usernameHint;
    },
  };
}

export function createAccountRedditContext(auth: {
  username: string;
  grant: PersistedRedditGrant | null;
}): RedditRuntimeContext {
  return {
    id: `account:${auth.username}`,
    sessionId: null,
    usernameHint: auth.username,
    reddit: auth.grant,
    persistGrant(grant) {
      if (grant) {
        upsertPersistedAccountGrant(grant);
      } else {
        clearPersistedAccountGrant(auth.username, true);
      }

      this.reddit = grant;
      this.usernameHint = grant?.username ?? auth.username;
    },
  };
}

export function initializeAuthenticatedAccount(grant: PersistedRedditGrant) {
  upsertPersistedAccountGrant(grant);
  ensureAccountSettings(grant.username, getDefaultCleanupSettings());
  ensureAccountPreferences(grant.username);
}

async function refreshRedditGrant(context: RedditRuntimeContext, force = false) {
  if (!context.reddit) {
    throw new RedditAuthError("Sign in with Reddit before previewing or shredding content.");
  }

  if (!force && Date.now() < context.reddit.expiresAt - ACCESS_TOKEN_LEEWAY_MS) {
    return context.reddit;
  }

  try {
    const tokenData = await requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: context.reddit.refreshToken,
      }),
    );

    if (!tokenData.access_token || !tokenData.expires_in) {
      context.persistGrant(null);
      throw new RedditAuthError("Reddit returned an incomplete refresh-token response.");
    }

    const redditGrant = {
      ...context.reddit,
      accessToken: tokenData.access_token,
      obtainedAt: Date.now(),
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      scope: tokenData.scope ? normalizeScopes(tokenData.scope) : context.reddit.scope,
    } satisfies PersistedRedditGrant;

    context.persistGrant(redditGrant);

    return redditGrant;
  } catch (error) {
    if (error instanceof RedditAuthError) {
      context.persistGrant(null);
    }

    throw error;
  }
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRetry(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const reset = response.headers.get("x-ratelimit-reset");
  const seconds = Number(retryAfter ?? reset);

  if (Number.isFinite(seconds) && seconds > 0) {
    await delay(seconds * 1000);
    return;
  }

  await delay((attempt + 1) * 1500);
}

async function waitForRateLimit(response: Response) {
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));

  if (Number.isFinite(remaining) && remaining <= 1 && Number.isFinite(reset) && reset > 0) {
    await delay(reset * 1000);
  }
}

async function fetchReddit(
  context: RedditRuntimeContext,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  let attempt = 0;
  let forcedRefresh = false;

  while (attempt < 3) {
    const reddit = await refreshRedditGrant(context, attempt > 0);

    try {
      const response = await fetch(input, {
        ...init,
        cache: "no-store",
        headers: {
          ...buildRedditHeaders(reddit.accessToken, undefined, reddit.username),
          ...(init?.headers ?? {}),
        },
      });

      if (response.ok) {
        await waitForRateLimit(response);
        return response;
      }

      if (response.status === 401 && !forcedRefresh) {
        forcedRefresh = true;
        await refreshRedditGrant(context, true);
        attempt += 1;
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        attempt += 1;

        if (attempt < 3) {
          await waitForRetry(response, attempt);
          continue;
        }
      }

      const details = await readErrorBody(response);

      if (response.status === 401 || response.status === 403) {
        throw new RedditAuthError("Reddit rejected the current session. Sign in again to continue.");
      }

      throw new RedditRequestError(getErrorMessage(response, details), response.status, details);
    } catch (error) {
      if (
        error instanceof RedditAuthError ||
        error instanceof RedditRequestError ||
        error instanceof RedditConnectivityError
      ) {
        throw error;
      }

      if (error instanceof TypeError) {
        throw new RedditConnectivityError("The server could not reach Reddit.");
      }

      throw error;
    }
  }

  throw new RedditConnectivityError("Reddit did not respond successfully after multiple attempts.");
}

async function fetchListingPage<T>(
  context: RedditRuntimeContext,
  pathname: string,
  after: string | null,
): Promise<ListingResponse<T>> {
  const url = new URL(pathname, "https://oauth.reddit.com");

  url.searchParams.set("limit", "100");

  if (after) {
    url.searchParams.set("after", after);
  }

  const response = await fetchReddit(context, url.toString());
  return response.json() as Promise<ListingResponse<T>>;
}

function buildPublicPermalink(permalink: string) {
  return `https://www.reddit.com${permalink}`;
}

function mapComment(comment: ListingChild<RedditComment>, rules: ShredRules): PreviewItem {
  const eligible = comment.data.score < rules.maxScore && comment.data.created_utc < rules.cutoffUnix;

  return {
    id: comment.data.id,
    name: comment.data.name,
    thingKind: comment.kind,
    contentKind: "comment",
    title: "",
    body: comment.data.body ?? "",
    score: comment.data.score,
    createdUtc: comment.data.created_utc,
    subreddit: comment.data.subreddit,
    permalink: buildPublicPermalink(comment.data.permalink),
    eligible,
    reason: eligible
      ? "Matches the active score and age rules."
      : "Skipped because it is too recent or above the score cutoff.",
  };
}

function mapSubmission(post: ListingChild<RedditSubmission>, rules: ShredRules): PreviewItem {
  const eligible = post.data.score < rules.maxScore && post.data.created_utc < rules.cutoffUnix;

  return {
    id: post.data.id,
    name: post.data.name,
    thingKind: post.kind,
    contentKind: post.data.is_self ? "selfPost" : "linkPost",
    title: post.data.title ?? "",
    body: post.data.selftext ?? "",
    score: post.data.score,
    createdUtc: post.data.created_utc,
    subreddit: post.data.subreddit,
    permalink: buildPublicPermalink(post.data.permalink),
    eligible,
    reason: eligible
      ? "Matches the active score and age rules."
      : "Skipped because it is too recent or above the score cutoff.",
  };
}

function itemNeedsOverwrite(item: PreviewItem) {
  return item.body.trim().length > 0;
}

function createOverwriteText() {
  const words = [];

  for (let index = 0; index < 5; index += 1) {
    const choice = COMMENT_SNIPPET_WORDS[Math.floor(Math.random() * COMMENT_SNIPPET_WORDS.length)];
    words.push(choice);
  }

  return words.join(" ");
}

function trimSnippet(value: string, maxLength = 88) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}...`;
}

function summarizeItem(item: PreviewItem) {
  if (item.contentKind === "comment") {
    return trimSnippet(item.body, 92) || `Comment in r/${item.subreddit}`;
  }

  return trimSnippet(item.title, 92) || `Post in r/${item.subreddit}`;
}

export async function buildPreview(
  context: RedditRuntimeContext,
  settings: CleanupSettings,
  onProgress?: (progress: PreviewProgress) => void,
) {
  const reddit = await refreshRedditGrant(context);

  if (!reddit.username) {
    throw new RedditAuthError("Reddit did not return a username for the current session.");
  }

  const rules = createRulesFromCleanupSettings(settings);
  let commentsAfter: string | null = null;
  let postsAfter: string | null = null;
  const comments: PreviewItem[] = [];
  const posts: PreviewItem[] = [];

  onProgress?.({
    stage: "identity",
    commentsDiscovered: 0,
    postsDiscovered: 0,
  });

  do {
    const page: ListingResponse<RedditComment> = await fetchListingPage<RedditComment>(
      context,
      `/user/${encodeURIComponent(reddit.username)}/comments.json`,
      commentsAfter,
    );

    comments.push(
      ...page.data.children.map((comment: ListingChild<RedditComment>) => mapComment(comment, rules)),
    );
    commentsAfter = page.data.after;

    onProgress?.({
      stage: "comments",
      commentsDiscovered: comments.length,
      postsDiscovered: posts.length,
    });
  } while (commentsAfter);

  do {
    const page: ListingResponse<RedditSubmission> = await fetchListingPage<RedditSubmission>(
      context,
      `/user/${encodeURIComponent(reddit.username)}/submitted.json`,
      postsAfter,
    );

    posts.push(
      ...page.data.children.map((post: ListingChild<RedditSubmission>) => mapSubmission(post, rules)),
    );
    postsAfter = page.data.after;

    onProgress?.({
      stage: "posts",
      commentsDiscovered: comments.length,
      postsDiscovered: posts.length,
    });
  } while (postsAfter);

  const allItems = [...comments, ...posts];
  const eligibleItems = allItems.filter((item) => item.eligible);
  const eligibleComments = eligibleItems.filter((item) => item.contentKind === "comment").length;
  const eligiblePosts = eligibleItems.length - eligibleComments;

  onProgress?.({
    stage: "done",
    commentsDiscovered: comments.length,
    postsDiscovered: posts.length,
  });

  return {
    username: reddit.username,
    generatedAt: Date.now(),
    rules,
    allItems,
    eligibleItems,
    counts: {
      commentsDiscovered: comments.length,
      postsDiscovered: posts.length,
      eligibleComments,
      eligiblePosts,
    },
  } satisfies PreviewResult;
}

async function editThing(context: RedditRuntimeContext, item: PreviewItem) {
  const payload = new URLSearchParams({
    thing_id: item.name,
    text: createOverwriteText(),
  }).toString();

  await fetchReddit(context, "https://oauth.reddit.com/api/editusertext", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });
}

async function deleteThing(context: RedditRuntimeContext, item: PreviewItem) {
  const payload = new URLSearchParams({
    id: item.name,
  }).toString();

  await fetchReddit(context, "https://oauth.reddit.com/api/del", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: payload,
  });
}

export async function runShred(
  context: RedditRuntimeContext,
  preview: PreviewResult,
  settings: CleanupSettings,
  dryRun: boolean,
  options: {
    runId?: string;
    jobId?: string;
    onProgress?: (progress: RunProgress) => void;
  } = {},
) {
  const reddit = await refreshRedditGrant(context);
  const failures: RunFailure[] = [];
  const rules = preview.rules;
  const historySessionId = context.sessionId ?? `scheduled:${reddit.username}`;
  const runId = options.runId ?? options.jobId ?? randomUUID();

  let processed = 0;
  let deleted = 0;
  let edited = 0;
  let stopReasonCode: RunReport["stopReasonCode"];
  let stopReason: string | undefined;

  options.onProgress?.({
    phase: "starting",
    processed,
    edited,
    deleted,
    failed: failures.length,
    total: preview.eligibleItems.length,
    currentLabel: "Preparing run",
    currentStep: dryRun ? "Checking candidates" : "Starting destructive run",
  });

  const startedAt = Date.now();

  for (const item of preview.eligibleItems) {
    const label = summarizeItem(item);
    const shouldOverwrite = itemNeedsOverwrite(item);
    let editedBeforeDelete = false;

    try {
      if (dryRun) {
        options.onProgress?.({
          phase: "dry-run",
          processed,
          edited,
          deleted,
          failed: failures.length,
          total: preview.eligibleItems.length,
          currentLabel: label,
          currentStep: "Simulating overwrite and delete",
        });

        await delay(DRY_RUN_DELAY_MS);
      } else {
        if (shouldOverwrite) {
          options.onProgress?.({
            phase: "editing",
            processed,
            edited,
            deleted,
            failed: failures.length,
            total: preview.eligibleItems.length,
            currentLabel: label,
            currentStep: "Overwriting original text",
          });

          await editThing(context, item);
          edited += 1;
          editedBeforeDelete = true;
          await delay(COMMENT_EDIT_DELAY_MS);
        }

        options.onProgress?.({
          phase: "deleting",
          processed,
          edited,
          deleted,
          failed: failures.length,
          total: preview.eligibleItems.length,
          currentLabel: label,
          currentStep: "Deleting item from Reddit",
        });

        await deleteThing(context, item);
        deleted += 1;
        if (settings.storeDeletionHistory) {
          insertDeletedItem({
            deletedAt: Date.now(),
            runId,
            sessionId: historySessionId,
            jobId: options.jobId ?? null,
            username: reddit.username,
            item,
            editedBeforeDelete,
            rules,
          });
        }
        await delay(DELETE_DELAY_MS);
      }
    } catch (error) {
      failures.push({
        id: item.id,
        label,
        step: dryRun ? "dry-run" : shouldOverwrite ? "edit/delete" : "delete",
        message: toUserMessage(error),
        permalink: item.permalink,
      });

      if (error instanceof RedditAuthError) {
        stopReasonCode = "auth-expired";
        stopReason = error.message;
      } else if (error instanceof RedditConnectivityError) {
        stopReasonCode = "connectivity";
        stopReason = error.message;
      } else if (!(error instanceof RedditRequestError)) {
        stopReasonCode = "unexpected";
        stopReason = toUserMessage(error);
      }

      if (stopReasonCode) {
        processed += 1;
        break;
      }
    }

    processed += 1;
  }

  const report = {
    runId,
    status: stopReasonCode ? "stopped" : "completed",
    stopReasonCode,
    stopReason,
    startedAt,
    finishedAt: Date.now(),
    dryRun,
    storedDeletionHistory: settings.storeDeletionHistory,
    username: reddit.username,
    rules,
    totals: {
      discovered: preview.allItems.length,
      eligible: preview.eligibleItems.length,
      processed,
      edited,
      deleted: dryRun ? processed - failures.length : deleted,
      failed: failures.length,
    },
    failures,
  } satisfies RunReport;

  options.onProgress?.({
    phase: "done",
    processed: report.totals.processed,
    edited: report.totals.edited,
    deleted: report.totals.deleted,
    failed: report.totals.failed,
    total: preview.eligibleItems.length,
    currentLabel: stopReasonCode ? "Run stopped early" : "Run complete",
    currentStep: stopReason ?? "Finished",
  });

  return report;
}

export function toUserMessage(error: unknown) {
  if (error instanceof RedditRequestError) {
    if (typeof error.details === "string" && error.details.trim()) {
      return `${error.message} ${error.details}`.trim();
    }

    return error.message;
  }

  if (
    error instanceof RedditAuthError ||
    error instanceof RedditConnectivityError ||
    error instanceof RunConflictError ||
    error instanceof Error
  ) {
    return error.message;
  }

  return "Something unexpected went wrong.";
}
