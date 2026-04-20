export const REQUIRED_SCOPES = ["identity", "history", "edit"] as const;
export const DEFAULT_STORE_DELETION_HISTORY = true;

export type RequiredScope = (typeof REQUIRED_SCOPES)[number];

export type ShredRules = {
  minAgeDays: number;
  maxScore: number;
  cutoffUnix: number;
};

export type ContentKind = "comment" | "selfPost" | "linkPost";

export type PreviewItem = {
  id: string;
  name: string;
  thingKind: string;
  contentKind: ContentKind;
  title: string;
  body: string;
  score: number;
  createdUtc: number;
  subreddit: string;
  permalink: string;
  eligible: boolean;
  reason: string;
};

export type PreviewProgress = {
  stage: "identity" | "comments" | "posts" | "done";
  commentsDiscovered: number;
  postsDiscovered: number;
};

export type PreviewResult = {
  username: string;
  generatedAt: number;
  rules: ShredRules;
  allItems: PreviewItem[];
  eligibleItems: PreviewItem[];
  counts: {
    commentsDiscovered: number;
    postsDiscovered: number;
    eligibleComments: number;
    eligiblePosts: number;
  };
};

export type RunProgress = {
  phase: "starting" | "editing" | "deleting" | "dry-run" | "done";
  processed: number;
  deleted: number;
  failed: number;
  total: number;
  currentLabel: string;
  currentStep: string;
};

export type RunFailure = {
  id: string;
  label: string;
  step: string;
  message: string;
  permalink: string;
};

export type RunReport = {
  status: "completed" | "stopped";
  stopReasonCode?: "auth-expired" | "connectivity" | "unexpected";
  stopReason?: string;
  startedAt: number;
  finishedAt: number;
  dryRun: boolean;
  username: string;
  rules: ShredRules;
  totals: {
    discovered: number;
    eligible: number;
    processed: number;
    edited: number;
    deleted: number;
    failed: number;
  };
  failures: RunFailure[];
};

export type JobSnapshot = {
  jobId: string;
  dryRun: boolean;
  status: "running" | "completed" | "stopped";
  progress: RunProgress | null;
  report: RunReport | null;
  updatedAt: number;
};

export type AccountPreferences = {
  storeDeletionHistory: boolean;
};

export type SessionSummary = {
  authConfigured: boolean;
  configurationError: string | null;
  redirectUri: string;
  minAgeDays: number;
  maxScore: number;
  authenticated: boolean;
  username: string | null;
  scope: string[];
  expiresAt: number | null;
  activeJob: JobSnapshot | null;
  preferences: AccountPreferences;
};

export type RunStartResponse = {
  jobId: string;
};
