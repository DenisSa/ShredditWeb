"use client";

import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Logo } from "@/components/icons";
import {
  DEFAULT_STORE_DELETION_HISTORY,
  type JobSnapshot,
  type PreviewProgress,
  type PreviewResult,
  type RunReport,
  type SessionSummary,
  createReportDownload,
  fetchRunStatus,
  fetchSessionSummary,
  formatAgeInDays,
  formatExpiry,
  formatTimestamp,
  getBrowserTimezone,
  getItemSummary,
  logoutRedditSession,
  requestPreview,
  startOauthRedirect,
  startRun,
  subscribeToRunEvents,
  toUserMessage,
  validateScopes,
} from "@/lib/shreddit";

type StepKey = "connect" | "review" | "run";
type StepState = "complete" | "current" | "upcoming" | "attention";
type PreviewFilter = "eligible" | "comments" | "posts" | "excluded";

type StatusMessage = {
  key: string;
  tone: "info" | "warning" | "danger" | "success";
  content: ReactNode;
};

const DEFAULT_SESSION_SUMMARY: SessionSummary = {
  authConfigured: false,
  configurationError: null,
  redirectUri: "",
  minAgeDays: 7,
  maxScore: 100,
  authenticated: false,
  username: null,
  scope: [],
  expiresAt: null,
  activeJob: null,
  settings: {
    minAgeDays: 7,
    maxScore: 100,
    storeDeletionHistory: DEFAULT_STORE_DELETION_HISTORY,
  },
  preferences: {
    storeDeletionHistory: DEFAULT_STORE_DELETION_HISTORY,
  },
  schedule: null,
  requiresReconnect: false,
  lastScheduledRun: null,
};

function surfaceClassName(extra = "") {
  return `rounded-[24px] border border-[color:var(--page-border)] bg-[color:var(--page-surface)] shadow-[0_20px_48px_rgba(15,23,42,0.06)] ${extra}`.trim();
}

function subtlePanelClassName(extra = "") {
  return `rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] ${extra}`.trim();
}

function sectionLabelClassName() {
  return "text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--page-muted)]";
}

function previewMatchesRules(preview: PreviewResult | null, rules: { minAgeDays: number; maxScore: number }) {
  return Boolean(
    preview &&
      preview.rules.minAgeDays === rules.minAgeDays &&
      preview.rules.maxScore === rules.maxScore,
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warning" | "danger" | "success";
  children: ReactNode;
}) {
  const toneClassName =
    tone === "danger"
      ? "border-[rgba(166,54,54,0.18)] bg-[rgba(166,54,54,0.06)] text-[color:var(--page-danger)]"
      : tone === "warning"
        ? "border-[rgba(165,106,22,0.18)] bg-[rgba(165,106,22,0.06)] text-[color:var(--page-warning)]"
        : tone === "success"
          ? "border-[rgba(45,106,79,0.18)] bg-[rgba(45,106,79,0.06)] text-[color:var(--page-success)]"
          : "border-[rgba(199,81,46,0.16)] bg-[rgba(199,81,46,0.06)] text-[color:var(--page-accent)]";

  return <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${toneClassName}`}>{children}</div>;
}

function StatusStack({ messages }: { messages: StatusMessage[] }) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <Notice key={message.key} tone={message.tone}>
          {message.content}
        </Notice>
      ))}
    </div>
  );
}

function Stepper({
  steps,
}: {
  steps: Array<{
    key: StepKey;
    label: string;
    detail: string;
    state: StepState;
  }>;
}) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {steps.map((step, index) => {
        const stateClassName =
          step.state === "attention"
            ? "border-[rgba(166,54,54,0.22)] bg-[rgba(166,54,54,0.06)]"
            : step.state === "current"
              ? "border-[rgba(199,81,46,0.24)] bg-[rgba(199,81,46,0.07)]"
              : step.state === "complete"
                ? "border-[rgba(45,106,79,0.20)] bg-[rgba(45,106,79,0.06)]"
                : "border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)]";

        const badgeClassName =
          step.state === "attention"
            ? "bg-[color:var(--page-danger)] text-white"
            : step.state === "current"
              ? "bg-[color:var(--page-accent)] text-white"
              : step.state === "complete"
                ? "bg-[color:var(--page-success)] text-white"
                : "bg-[rgba(91,103,118,0.12)] text-[color:var(--page-muted-strong)]";

        const stateLabel =
          step.state === "attention"
            ? "Needs attention"
            : step.state === "current"
              ? "Current"
              : step.state === "complete"
                ? "Complete"
                : "Next";

        return (
          <li className={`rounded-2xl border px-4 py-4 ${stateClassName}`} key={step.key}>
            <div className="flex items-start gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${badgeClassName}`}
              >
                {step.state === "complete" ? "✓" : index + 1}
              </div>
              <div className="min-w-0">
                <p className={sectionLabelClassName()}>{stateLabel}</p>
                <h2 className="mt-1 text-base font-semibold text-[color:var(--page-ink)]">{step.label}</h2>
                <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">{step.detail}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function CompactMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <p className={sectionLabelClassName()}>{label}</p>
      <p className="text-2xl font-semibold tracking-tight text-[color:var(--page-ink)]">{value}</p>
      {hint ? <p className="text-sm leading-6 text-[color:var(--page-muted)]">{hint}</p> : null}
    </div>
  );
}

function SummaryCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={surfaceClassName("p-5")}>
      <p className={sectionLabelClassName()}>{title}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SummaryRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[color:var(--page-muted-strong)]">{label}</p>
        {hint ? <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">{hint}</p> : null}
      </div>
      <div className="shrink-0 text-right text-sm font-semibold text-[color:var(--page-ink)]">{value}</div>
    </div>
  );
}

function ProgressMeter({ value }: { value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-[rgba(91,103,118,0.10)]">
      <div
        className="h-full rounded-full bg-[linear-gradient(90deg,var(--page-accent),#dd7555)] transition-[width] duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function PreviewList({
  preview,
  filter,
  onFilterChange,
}: {
  preview: PreviewResult | null;
  filter: PreviewFilter;
  onFilterChange: (filter: PreviewFilter) => void;
}) {
  const filterOptions = useMemo(() => {
    if (!preview) {
      return [
        { id: "eligible" as const, label: "All eligible", count: 0 },
        { id: "comments" as const, label: "Comments", count: 0 },
        { id: "posts" as const, label: "Posts", count: 0 },
        { id: "excluded" as const, label: "Excluded", count: 0 },
      ];
    }

    const eligibleComments = preview.eligibleItems.filter((item) => item.contentKind === "comment").length;
    const eligiblePosts = preview.eligibleItems.filter((item) => item.contentKind !== "comment").length;
    const excluded = preview.allItems.filter((item) => !item.eligible).length;

    return [
      { id: "eligible" as const, label: "All eligible", count: preview.eligibleItems.length },
      { id: "comments" as const, label: "Comments", count: eligibleComments },
      { id: "posts" as const, label: "Posts", count: eligiblePosts },
      { id: "excluded" as const, label: "Excluded", count: excluded },
    ];
  }, [preview]);

  const items = useMemo(() => {
    if (!preview) {
      return [];
    }

    if (filter === "comments") {
      return preview.eligibleItems.filter((item) => item.contentKind === "comment");
    }

    if (filter === "posts") {
      return preview.eligibleItems.filter((item) => item.contentKind !== "comment");
    }

    if (filter === "excluded") {
      return preview.allItems.filter((item) => !item.eligible);
    }

    return preview.eligibleItems;
  }, [filter, preview]);

  const visibleItems = items.slice(0, 24);

  return (
    <section className={surfaceClassName("overflow-hidden p-5 sm:p-6")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-[color:var(--page-ink)]">Result detail</h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-[color:var(--page-muted)]">
            Review the matching content before you launch a run. Excluded items help explain why some history was skipped.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => {
            const isActive = option.id === filter;

            return (
              <button
                aria-pressed={isActive}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-[color:var(--page-ink)] text-white"
                    : "border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] text-[color:var(--page-muted-strong)] hover:border-[color:var(--page-border-strong)]"
                }`}
                key={option.id}
                onClick={() => onFilterChange(option.id)}
                type="button"
              >
                <span>{option.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? "bg-white/15" : "bg-[rgba(91,103,118,0.12)]"}`}>
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {!preview ? (
        <div className={`${subtlePanelClassName("mt-6 px-4 py-5")} text-sm leading-7 text-[color:var(--page-muted)]`}>
          Run a scan to load preview results here.
        </div>
      ) : items.length === 0 ? (
        <div className={`${subtlePanelClassName("mt-6 px-4 py-5")} text-sm leading-7 text-[color:var(--page-muted)]`}>
          No items are available in this view.
        </div>
      ) : (
        <div className={`${subtlePanelClassName("mt-6 overflow-hidden")}`}>
          <div className="divide-y divide-[color:var(--page-border)]">
            {visibleItems.map((item) => (
              <div className="px-4 py-4" key={item.id}>
                <div className="grid gap-3 lg:grid-cols-[auto_auto_auto_auto_minmax(0,1fr)_auto] lg:items-start lg:gap-4">
                  <span className="inline-flex w-fit rounded-full bg-[rgba(16,32,51,0.06)] px-2.5 py-1 text-xs font-medium text-[color:var(--page-muted-strong)]">
                    {item.contentKind === "comment" ? "Comment" : "Post"}
                  </span>
                  <span className="text-sm font-medium text-[color:var(--page-ink)]">r/{item.subreddit}</span>
                  <span className="text-sm text-[color:var(--page-muted)]">{formatAgeInDays(item.createdUtc)}</span>
                  <span className="text-sm text-[color:var(--page-muted)]">Score {item.score}</span>
                  <div className="min-w-0">
                    <p className="text-sm leading-6 text-[color:var(--page-ink)]">{getItemSummary(item)}</p>
                    {!item.eligible ? (
                      <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">{item.reason || "Excluded by the active rules."}</p>
                    ) : null}
                  </div>
                  <a
                    className="text-sm font-medium text-[color:var(--page-accent)] underline-offset-4 hover:underline"
                    href={item.permalink}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length > visibleItems.length ? (
        <p className="mt-4 text-sm leading-6 text-[color:var(--page-muted)]">
          Showing the first {visibleItems.length} items in this view.
        </p>
      ) : null}
    </section>
  );
}

function FailureList({ report }: { report: RunReport }) {
  if (report.failures.length === 0) {
    return (
      <div className={`${subtlePanelClassName("px-4 py-5")} text-sm leading-7 text-[color:var(--page-success)]`}>
        No item-level failures were recorded for this run.
      </div>
    );
  }

  return (
    <div className={`${subtlePanelClassName("overflow-hidden")}`}>
      <div className="divide-y divide-[color:var(--page-border)]">
        {report.failures.slice(0, 12).map((failure) => (
          <div className="px-4 py-4" key={`${failure.id}-${failure.step}`}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[color:var(--page-ink)]">{failure.label}</p>
                <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">{failure.message}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className="rounded-full bg-[rgba(166,54,54,0.08)] px-2.5 py-1 text-xs font-medium text-[color:var(--page-danger)]">
                  {failure.step}
                </span>
                <a
                  className="text-sm font-medium text-[color:var(--page-accent)] underline-offset-4 hover:underline"
                  href={failure.permalink}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {report.failures.length > 12 ? (
        <p className="border-t border-[color:var(--page-border)] px-4 py-4 text-sm leading-6 text-[color:var(--page-muted)]">
          Showing the first 12 failures. Download the report for the full list.
        </p>
      ) : null}
    </div>
  );
}

function subscribeToMountState() {
  return () => {};
}

function HydrationShell() {
  return (
    <div className="pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface)]">
            <Logo className="text-[color:var(--page-accent)]" size={22} />
          </div>
          <div>
            <p className={sectionLabelClassName()}>ShredditWeb</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)] sm:text-3xl">
              Cleanup workflow
            </h1>
          </div>
        </div>
        <div className="h-10 w-44 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className={surfaceClassName("p-5 sm:p-6")}>
            <div className="grid gap-3 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div className="rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-4 py-4" key={index}>
                  <div className="h-5 w-16 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
                  <div className="mt-3 h-5 w-24 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
                  <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
                </div>
              ))}
            </div>
          </section>

          <section className={surfaceClassName("p-5 sm:p-6")}>
            <div className="h-5 w-28 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-4 h-10 w-56 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-4 h-4 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
            <div className="mt-3 h-4 w-4/5 animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
            <div className="mt-6 flex gap-3">
              <div className="h-11 w-36 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
              <div className="h-11 w-28 animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
            </div>
          </section>

          <section className={surfaceClassName("p-5 sm:p-6")}>
            <div className="h-5 w-36 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="h-16 animate-pulse rounded-2xl bg-[rgba(91,103,118,0.08)]" key={index} />
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <section className={surfaceClassName("p-5")} key={index}>
              <div className="h-4 w-24 animate-pulse rounded-full bg-[rgba(91,103,118,0.12)]" />
              <div className="mt-4 space-y-3">
                <div className="h-5 w-full animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
                <div className="h-5 w-4/5 animate-pulse rounded-full bg-[rgba(91,103,118,0.08)]" />
              </div>
            </section>
          ))}
        </aside>
      </div>
    </div>
  );
}

export function ShredditApp() {
  const hasMounted = useSyncExternalStore(subscribeToMountState, () => true, () => false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary>(DEFAULT_SESSION_SUMMARY);
  const [jobSnapshot, setJobSnapshot] = useState<JobSnapshot | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewProgress, setPreviewProgress] = useState<PreviewProgress | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [previewFilter, setPreviewFilter] = useState<PreviewFilter>("eligible");
  const [showReportDetails, setShowReportDetails] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const runtimeConfig = sessionSummary;
  const session = sessionSummary.authenticated ? sessionSummary : null;
  const sessionWarnings = useMemo(() => (session ? validateScopes(session) : []), [session]);
  const runProgress = jobSnapshot?.progress ?? null;
  const runReport = jobSnapshot?.report ?? null;
  const isRunning = jobSnapshot?.status === "running";
  const activeRunDryRun = isRunning ? jobSnapshot?.dryRun ?? dryRun : dryRun;
  const timezone = hasMounted ? getBrowserTimezone() : "UTC";
  const previewIsCurrent = previewMatchesRules(preview, sessionSummary.settings);

  const progressPercent = useMemo(() => {
    if (!runProgress) {
      return runReport ? 100 : 0;
    }

    if (runProgress.total === 0) {
      return 0;
    }

    return Math.min(100, Math.round((runProgress.processed / runProgress.total) * 100));
  }, [runProgress, runReport]);

  const activeStep = useMemo<StepKey>(() => {
    if (isRunning || runReport) {
      return "run";
    }

    if (!runtimeConfig.authConfigured || !session || sessionWarnings.length > 0) {
      return "connect";
    }

    if (!preview) {
      return "review";
    }

    return "run";
  }, [isRunning, preview, runReport, runtimeConfig.authConfigured, session, sessionWarnings.length]);

  const statusMessages = useMemo<StatusMessage[]>(() => {
    const messages: StatusMessage[] = [];

    if (!runtimeConfig.authConfigured) {
      messages.push({
        key: "config",
        tone: "warning",
        content: runtimeConfig.configurationError || "Server auth configuration is incomplete.",
      });
    }

    if (authError) {
      messages.push({
        key: "auth-error",
        tone: "danger",
        content: authError,
      });
    }

    if (notice) {
      messages.push({
        key: "notice",
        tone: "info",
        content: notice,
      });
    }

    if (preview && !previewIsCurrent) {
      messages.push({
        key: "preview-stale",
        tone: "warning",
        content: "Preview results are out of date for the current cleanup settings. Scan again before running or enabling automation.",
      });
    }

    if (sessionWarnings.length > 0) {
      messages.push({
        key: "scope-warning",
        tone: "warning",
        content: (
          <>
            The current Reddit session is missing{" "}
            <code className="font-mono text-[0.95em]">{sessionWarnings.join(", ")}</code>. Sign in again and approve
            the full scope set.
          </>
        ),
      });
    }

    if (sessionSummary.requiresReconnect) {
      messages.push({
        key: "reconnect-required",
        tone: "warning",
        content: "Stored Reddit automation needs a fresh sign-in before scheduled cleanup can be enabled again.",
      });
    }

    return messages;
  }, [
    authError,
    notice,
    preview,
    previewIsCurrent,
    runtimeConfig.authConfigured,
    runtimeConfig.configurationError,
    sessionSummary.requiresReconnect,
    sessionWarnings,
  ]);

  const stepItems = useMemo(
    () => [
      {
        key: "connect" as const,
        label: "Connect account",
        detail: session ? `Signed in as ${session.username}` : "Server-backed Reddit sign-in",
        state: (!runtimeConfig.authConfigured || sessionWarnings.length > 0 ? "attention" : session ? "complete" : "current") as StepState,
      },
      {
        key: "review" as const,
        label: "Review matches",
        detail: preview ? `${preview.eligibleItems.length} eligible items loaded` : "Scan comments and posts",
        state: (preview ? "complete" : activeStep === "review" ? "current" : session ? "upcoming" : "upcoming") as StepState,
      },
      {
        key: "run" as const,
        label: "Run cleanup",
        detail: runReport ? `Last run ${runReport.status}` : isRunning ? "Cleanup in progress" : "Dry run or live deletion",
        state: (
          runReport?.status === "stopped"
            ? "attention"
            : isRunning
              ? "current"
              : runReport?.status === "completed"
                ? "complete"
                : activeStep === "run"
                  ? "current"
                  : "upcoming"
        ) as StepState,
      },
    ],
    [
      activeStep,
      isRunning,
      preview,
      runReport,
      runtimeConfig.authConfigured,
      session,
      sessionWarnings.length,
    ],
  );

  const closeRunStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const refreshSessionSummary = useCallback(async () => {
    const summary = await fetchSessionSummary();
    setSessionSummary(summary);
    setJobSnapshot(summary.activeJob);
    if (summary.activeJob) {
      setDryRun(summary.activeJob.dryRun);
    }
    return summary;
  }, []);

  const hydrateActiveJob = useCallback(async (jobId: string) => {
    const snapshot = await fetchRunStatus(jobId);
    setJobSnapshot(snapshot);
    setDryRun(snapshot.dryRun);
    return snapshot;
  }, []);

  const connectToJob = useCallback(
    (jobId: string) => {
      closeRunStream();

      const source = subscribeToRunEvents(jobId, {
        onProgress: (job) => {
          setJobSnapshot(job);
        },
        onComplete: (job) => {
          setJobSnapshot(job);
          setNotice(job.report?.dryRun ? "Dry run complete. Nothing was deleted." : "Run complete. Review the report below.");
          setShowReportDetails((job.report?.failures.length ?? 0) > 0);
          closeRunStream();
          void refreshSessionSummary().catch(() => {});
        },
        onError: (job) => {
          setJobSnapshot(job);
          setNotice(job.report?.stopReason || "Run stopped before completion.");
          setShowReportDetails(true);
          closeRunStream();
          void refreshSessionSummary().catch(() => {});
        },
      });

      source.onerror = () => {
        if (!eventSourceRef.current) {
          return;
        }
      };

      eventSourceRef.current = source;
    },
    [closeRunStream, refreshSessionSummary],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsBootstrapping(true);

      try {
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          const callbackError = url.searchParams.get("authError");

          if (callbackError) {
            setAuthError(callbackError);
            url.searchParams.delete("authError");
            const nextUrl = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}`;
            window.history.replaceState(null, "", nextUrl);
          }
        }

        const summary = await refreshSessionSummary();

        if (cancelled) {
          return;
        }

        if (summary.activeJob?.jobId) {
          const snapshot = await hydrateActiveJob(summary.activeJob.jobId);

          if (cancelled) {
            return;
          }

          if (snapshot.status === "running") {
            setNotice("Reconnected to an active server-side shred job.");
            connectToJob(snapshot.jobId);
          } else if (snapshot.report) {
            setShowReportDetails((snapshot.report.failures.length ?? 0) > 0);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setAuthError(toUserMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      closeRunStream();
    };
  }, [closeRunStream, connectToJob, hydrateActiveJob, refreshSessionSummary]);

  useEffect(() => {
    if (!session?.username) {
      return;
    }

    const interval = setInterval(() => {
      void refreshSessionSummary().catch(() => {});
    }, 30_000);

    return () => clearInterval(interval);
  }, [refreshSessionSummary, session?.username]);

  function resetWorkflowState() {
    setPreview(null);
    setPreviewProgress(null);
    setJobSnapshot(null);
    setConfirmChecked(false);
    setPreviewFilter("eligible");
    setShowReportDetails(false);
  }

  function handleSignIn() {
    setAuthError(null);
    setNotice(null);

    if (!runtimeConfig.authConfigured) {
      setAuthError(runtimeConfig.configurationError || "Server auth configuration is incomplete.");
      return;
    }

    try {
      startOauthRedirect(window.location);
    } catch (error) {
      setAuthError(toUserMessage(error));
    }
  }

  async function handleLogout() {
    closeRunStream();

    try {
      await logoutRedditSession();
      await refreshSessionSummary();
      resetWorkflowState();
      setNotice("Stored Reddit session cleared for this device.");
      setAuthError(null);
    } catch (error) {
      setAuthError(toUserMessage(error));
    }
  }

  async function handlePreview() {
    if (!session) {
      return;
    }

    setAuthError(null);
    setNotice(null);
    setIsPreviewing(true);
    setPreview(null);
    setJobSnapshot(null);
    setConfirmChecked(false);
    setPreviewFilter("eligible");
    setShowReportDetails(false);
    setPreviewProgress({
      stage: "identity",
      commentsDiscovered: 0,
      postsDiscovered: 0,
    });

    try {
      const nextPreview = await requestPreview();
      setPreview(nextPreview);
      setPreviewProgress({
        stage: "done",
        commentsDiscovered: nextPreview.counts.commentsDiscovered,
        postsDiscovered: nextPreview.counts.postsDiscovered,
      });

      if (nextPreview.eligibleItems.length === 0) {
        setNotice("Scan complete. Nothing matched the active age and score rules.");
      }
    } catch (error) {
      setAuthError(toUserMessage(error));
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleRun() {
    if (!session || !preview) {
      return;
    }

    setAuthError(null);
    setNotice(null);
    closeRunStream();
    setShowReportDetails(false);

    try {
      const { jobId } = await startRun(dryRun);
      const snapshot = await hydrateActiveJob(jobId);
      setSessionSummary((current) => ({
        ...current,
        activeJob: snapshot,
      }));

      if (snapshot.status === "running") {
        connectToJob(jobId);
      } else if (snapshot.status === "completed") {
        setNotice(snapshot.report?.dryRun ? "Dry run complete. Nothing was deleted." : "Run complete. Review the report below.");
        setShowReportDetails((snapshot.report?.failures.length ?? 0) > 0);
      } else {
        setNotice(snapshot.report?.stopReason || "Run stopped before completion.");
        setShowReportDetails(true);
      }
    } catch (error) {
      setAuthError(toUserMessage(error));
    }
  }

  function handleDownloadReport() {
    if (!runReport) {
      return;
    }

    const blob = createReportDownload(runReport);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `shreddit-run-${new Date(runReport.finishedAt).toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!hasMounted) {
    return <HydrationShell />;
  }

  const previewDiscoveredCount = (preview?.counts.commentsDiscovered ?? 0) + (preview?.counts.postsDiscovered ?? 0);
  const previewEligibleCount = preview?.eligibleItems.length ?? 0;
  const canRun = Boolean(
    preview &&
      previewIsCurrent &&
      preview.eligibleItems.length > 0 &&
      confirmChecked &&
      !isRunning &&
      !isPreviewing,
  );

  return (
    <div className="pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface)] shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <Logo className="text-[color:var(--page-accent)]" size={22} />
          </div>
          <div>
            <p className={sectionLabelClassName()}>ShredditWeb</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)] sm:text-3xl">
              Cleanup workflow
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[color:var(--page-border-strong)]"
            href="/settings"
          >
            Open settings
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface)] px-3 py-2 text-sm text-[color:var(--page-muted-strong)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--page-success)]" />
            <span>{session ? session.username : isBootstrapping ? "Checking session" : "Signed out"}</span>
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section className={surfaceClassName("p-5 sm:p-6")}>
            <Stepper steps={stepItems} />
          </section>

          <section className={surfaceClassName("p-5 sm:p-6")}>
            {activeStep === "connect" ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className={sectionLabelClassName()}>Step 1</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)]">
                      Connect Reddit
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-[color:var(--page-muted)]">
                      Authenticate once through the server so you can scan your history and launch runs without exposing Reddit tokens in the browser.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!runtimeConfig.authConfigured || isBootstrapping || isRunning || isPreviewing}
                      onClick={handleSignIn}
                    >
                      {sessionWarnings.length > 0 ? "Reconnect Reddit" : "Connect Reddit"}
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-5 py-3 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[color:var(--page-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!session || isPreviewing || isRunning}
                      onClick={handleLogout}
                    >
                      Clear device session
                    </button>
                  </div>
                </div>

                <StatusStack messages={statusMessages} />

                <div className="grid gap-6 sm:grid-cols-2">
                  <CompactMetric
                    hint={runtimeConfig.configurationError || "Client ID, secret, redirect URI, and session secret are configured."}
                    label="Server auth"
                    value={runtimeConfig.authConfigured ? "Ready" : "Missing"}
                  />
                  <CompactMetric
                    hint={
                      session
                        ? `Access token ${formatExpiry(session.expiresAt)}`
                        : "A persistent local session cookie is used while Reddit tokens stay on the server."
                    }
                    label="Session"
                    value={session?.username || (isBootstrapping ? "Checking" : "Signed out")}
                  />
                </div>
              </div>
            ) : null}

            {activeStep === "review" ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className={sectionLabelClassName()}>Step 2</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)]">
                      Review matches
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-[color:var(--page-muted)]">
                      Scan your history with the current rules and confirm that the eligible set looks right before moving on.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#0d1826] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!session || isPreviewing || isRunning}
                      onClick={handlePreview}
                    >
                      {isPreviewing ? "Scanning Reddit history..." : preview ? "Scan again" : "Scan account"}
                    </button>
                  </div>
                </div>

                <StatusStack messages={statusMessages} />

                {preview ? (
                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <div>
                      <p className={sectionLabelClassName()}>Eligible now</p>
                      <p className="mt-2 text-5xl font-semibold tracking-[-0.04em] text-[color:var(--page-ink)]">
                        {previewEligibleCount}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-[color:var(--page-muted)]">
                        From {previewDiscoveredCount} items scanned. Preview generated {formatTimestamp(preview.generatedAt)}.
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                      <CompactMetric label="Comments scanned" value={preview.counts.commentsDiscovered} />
                      <CompactMetric label="Posts scanned" value={preview.counts.postsDiscovered} />
                      <CompactMetric label="Excluded" value={Math.max(0, preview.allItems.length - previewEligibleCount)} />
                    </div>
                  </div>
                ) : (
                  <div className={`${subtlePanelClassName("px-4 py-5")} text-sm leading-7 text-[color:var(--page-muted)]`}>
                    Preview results will appear here after the scan completes.
                  </div>
                )}

                {previewProgress && isPreviewing ? (
                  <div className={subtlePanelClassName("px-4 py-4")}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className={sectionLabelClassName()}>Scanning</p>
                        <p className="mt-1 text-base font-semibold text-[color:var(--page-ink)]">
                          Stage: {previewProgress.stage}
                        </p>
                      </div>
                      <p className="text-sm text-[color:var(--page-muted)]">
                        {previewProgress.commentsDiscovered} comments, {previewProgress.postsDiscovered} posts
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeStep === "run" ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className={sectionLabelClassName()}>Step 3</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)]">
                      Run cleanup
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm leading-7 text-[color:var(--page-muted)]">
                      Choose a mode, confirm the active rules, and let the server finish the run even if the page refreshes.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {preview ? (
                      <button
                        className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-5 py-3 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[color:var(--page-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isRunning || isPreviewing}
                        onClick={handlePreview}
                      >
                        Refresh preview
                      </button>
                    ) : null}
                  </div>
                </div>

                <StatusStack messages={statusMessages} />

                {preview ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        aria-pressed={dryRun}
                        className={`rounded-2xl border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          dryRun
                            ? "border-[rgba(199,81,46,0.24)] bg-[rgba(199,81,46,0.07)]"
                            : "border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] hover:border-[color:var(--page-border-strong)]"
                        }`}
                        disabled={isRunning}
                        onClick={() => setDryRun(true)}
                        type="button"
                      >
                        <p className="text-base font-semibold text-[color:var(--page-ink)]">Dry run</p>
                        <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">
                          Simulate the workflow and generate a report without deleting anything.
                        </p>
                      </button>
                      <button
                        aria-pressed={!dryRun}
                        className={`rounded-2xl border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          !dryRun
                            ? "border-[rgba(166,54,54,0.24)] bg-[rgba(166,54,54,0.06)]"
                            : "border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] hover:border-[color:var(--page-border-strong)]"
                        }`}
                        disabled={isRunning}
                        onClick={() => setDryRun(false)}
                        type="button"
                      >
                        <p className="text-base font-semibold text-[color:var(--page-ink)]">Live deletion</p>
                        <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">
                          Edit then delete the matched Reddit content using the current server session.
                        </p>
                      </button>
                    </div>

                    <div className={subtlePanelClassName("px-4 py-4")}>
                      <label className="flex items-start gap-3 text-sm leading-7 text-[color:var(--page-ink)]">
                        <input
                          checked={confirmChecked}
                          className="mt-1 h-4 w-4 accent-[color:var(--page-accent)]"
                          disabled={!preview || preview.eligibleItems.length === 0 || isRunning}
                          onChange={(event) => setConfirmChecked(event.target.checked)}
                          type="checkbox"
                        />
                        <span>
                          I understand that this run will target content older than {preview?.rules.minAgeDays ?? sessionSummary.settings.minAgeDays} days
                          with score below {preview?.rules.maxScore ?? sessionSummary.settings.maxScore}.
                        </span>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canRun}
                        onClick={handleRun}
                      >
                        {isRunning
                          ? activeRunDryRun
                            ? "Simulating..."
                            : "Shredding..."
                          : dryRun
                            ? "Run dry simulation"
                            : "Begin shredding"}
                      </button>
                      <p className="text-sm leading-6 text-[color:var(--page-muted)]">
                        {previewEligibleCount > 0
                          ? `${previewEligibleCount} eligible items ready for the current mode.`
                          : "No eligible items are available for a run right now."}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className={`${subtlePanelClassName("px-4 py-5")} text-sm leading-7 text-[color:var(--page-muted)]`}>
                    No preview is loaded. Run another scan before starting a new cleanup pass.
                  </div>
                )}

                {runReport ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <CompactMetric label="Processed" value={runReport.totals.processed} />
                    <CompactMetric label="Deleted" value={runReport.totals.deleted} />
                    <CompactMetric label="Failed" value={runReport.totals.failed} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {activeStep === "connect" ? (
            <section className={surfaceClassName("p-5 sm:p-6")}>
              <h2 className="text-xl font-semibold tracking-tight text-[color:var(--page-ink)]">Connection detail</h2>
              <div className="mt-4 divide-y divide-[color:var(--page-border)]">
                <SummaryRow
                  hint="The callback URI Reddit expects for this deployment."
                  label="OAuth callback"
                  value={runtimeConfig.redirectUri ? "Configured" : "Missing"}
                />
                <SummaryRow
                  hint={runtimeConfig.redirectUri || "Set REDDIT_REDIRECT_URI to the exact callback URL for this server."}
                  label="Callback value"
                  value={<code className="font-mono text-[0.95em]">{runtimeConfig.redirectUri || "Not set"}</code>}
                />
                <SummaryRow
                  hint="Scopes must include identity, history, and edit."
                  label="Required scopes"
                  value={<code className="font-mono text-[0.95em]">identity, history, edit</code>}
                />
              </div>
            </section>
          ) : null}

          {activeStep === "review" ? (
            <PreviewList filter={previewFilter} onFilterChange={setPreviewFilter} preview={preview} />
          ) : null}

          {activeStep === "run" ? (
            <section className={surfaceClassName("p-5 sm:p-6")}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-[color:var(--page-ink)]">
                    {runReport ? "Report detail" : "Target detail"}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-[color:var(--page-muted)]">
                    {runReport
                      ? "Expand the report when you need item-level failures or an audit trail."
                      : "These are the items currently queued by the last preview."}
                  </p>
                </div>

                {runReport ? (
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[color:var(--page-border-strong)]"
                      onClick={() => setShowReportDetails((current) => !current)}
                      type="button"
                    >
                      {showReportDetails ? "Hide report detail" : "View report detail"}
                    </button>
                    <button
                      className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-ink)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0d1826] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!runReport}
                      onClick={handleDownloadReport}
                    >
                      Download report
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-6">
                {runReport && showReportDetails ? (
                  <FailureList report={runReport} />
                ) : (
                  <PreviewList filter={previewFilter} onFilterChange={setPreviewFilter} preview={preview} />
                )}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <SummaryCard title="Saved rules">
            <div className="divide-y divide-[color:var(--page-border)]">
              <SummaryRow
                hint="Items must be older than this age to be eligible."
                label="Minimum age"
                value={`${sessionSummary.settings.minAgeDays} days`}
              />
              <SummaryRow
                hint="Items at or above this score stay untouched."
                label="Maximum score"
                value={sessionSummary.settings.maxScore}
              />
              <SummaryRow
                hint="Live deletions can optionally keep original content in SQLite."
                label="Deleted history"
                value={sessionSummary.settings.storeDeletionHistory ? "Stored" : "Not stored"}
              />
            </div>

            <p className="mt-4 text-sm leading-6 text-[color:var(--page-muted)]">
              {previewIsCurrent
                ? "The current preview matches the saved rules."
                : "The current preview is out of date for the saved rules."}
            </p>
          </SummaryCard>

          <SummaryCard title="Session">
            <div className="divide-y divide-[color:var(--page-border)]">
              <SummaryRow
                hint={session ? "Current Reddit account for this device-local session." : "Sign in to start scanning your history."}
                label="Account"
                value={session?.username || "Signed out"}
              />
              <SummaryRow
                hint="Reddit access token status for the active browser session."
                label="Token"
                value={session ? formatExpiry(session.expiresAt) : "Not connected"}
              />
              <SummaryRow
                hint="Scope checks for the connected account."
                label="Scopes"
                value={sessionWarnings.length > 0 ? "Missing scopes" : session ? "Ready" : "Waiting"}
              />
              <SummaryRow
                hint="Scheduler executes in UTC, but the UI renders times in your browser timezone."
                label="Timezone"
                value={timezone}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              {!session ? (
                <button
                  className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!runtimeConfig.authConfigured || isBootstrapping || isRunning || isPreviewing}
                  onClick={handleSignIn}
                >
                  Connect
                </button>
              ) : (
                <button
                  className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[color:var(--page-border-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isPreviewing || isRunning}
                  onClick={handleLogout}
                >
                  Clear device session
                </button>
              )}
            </div>
          </SummaryCard>

          <SummaryCard title="Automation">
            <div className="divide-y divide-[color:var(--page-border)]">
              <SummaryRow
                hint="Scheduled cleanup uses your saved rules from the settings page."
                label="Status"
                value={sessionSummary.schedule?.enabled ? "Enabled" : "Disabled"}
              />
              <SummaryRow
                hint="Preset cadence stored in UTC and shown here in browser time."
                label="Cadence"
                value={sessionSummary.schedule ? sessionSummary.schedule.cadence : "Not configured"}
              />
              <SummaryRow
                hint={`Rendered in ${timezone}.`}
                label="Next run"
                value={
                  sessionSummary.schedule?.enabled && sessionSummary.schedule.nextRunAt
                    ? formatTimestamp(sessionSummary.schedule.nextRunAt)
                    : "Disabled"
                }
              />
              <SummaryRow
                hint={sessionSummary.lastScheduledRun?.message || "Most recent scheduled attempt for this Reddit account."}
                label="Last scheduled run"
                value={sessionSummary.lastScheduledRun ? sessionSummary.lastScheduledRun.status : "None yet"}
              />
            </div>

            <div className={subtlePanelClassName("mt-4 px-4 py-4 text-sm leading-6 text-[color:var(--page-muted)]")}>
              {sessionSummary.requiresReconnect
                ? "Automation is paused until you reconnect Reddit from the settings page."
                : sessionSummary.schedule?.enabled
                  ? "Automation is live and waiting for its next scheduled run."
                  : "Automation is off."}
            </div>
          </SummaryCard>

          <SummaryCard title="Run progress">
            <div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-base font-semibold text-[color:var(--page-ink)]">
                    {runProgress?.currentLabel || runReport?.status || "Idle"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">
                    {runProgress?.currentStep ||
                      runReport?.stopReason ||
                      "Runs execute on the server and the UI can reconnect if the page refreshes."}
                  </p>
                </div>
                <p className="text-sm font-semibold text-[color:var(--page-muted-strong)]">{progressPercent}%</p>
              </div>

              <div className="mt-4">
                <ProgressMeter value={progressPercent} />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className={subtlePanelClassName("px-3 py-3")}>
                  <p className={sectionLabelClassName()}>Processed</p>
                  <p className="mt-1 text-lg font-semibold text-[color:var(--page-ink)]">
                    {runProgress?.processed ?? runReport?.totals.processed ?? 0}
                  </p>
                </div>
                <div className={subtlePanelClassName("px-3 py-3")}>
                  <p className={sectionLabelClassName()}>Deleted</p>
                  <p className="mt-1 text-lg font-semibold text-[color:var(--page-ink)]">
                    {runProgress?.deleted ?? runReport?.totals.deleted ?? 0}
                  </p>
                </div>
                <div className={subtlePanelClassName("px-3 py-3")}>
                  <p className={sectionLabelClassName()}>Failed</p>
                  <p className="mt-1 text-lg font-semibold text-[color:var(--page-ink)]">
                    {runProgress?.failed ?? runReport?.totals.failed ?? 0}
                  </p>
                </div>
              </div>
            </div>
          </SummaryCard>

          <SummaryCard title={runReport ? "Latest result" : "Preview"}>
            {runReport ? (
              <div>
                <div className="divide-y divide-[color:var(--page-border)]">
                  <SummaryRow label="Finished" value={formatTimestamp(runReport.finishedAt)} />
                  <SummaryRow label="Mode" value={runReport.dryRun ? "Dry run" : "Live deletion"} />
                  <SummaryRow label="Status" value={runReport.status} />
                  <SummaryRow label="Eligible" value={runReport.totals.eligible} />
                  <SummaryRow label="Failures" value={runReport.failures.length} />
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-4 py-2 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[color:var(--page-border-strong)]"
                    onClick={() => setShowReportDetails((current) => !current)}
                    type="button"
                  >
                    {showReportDetails ? "Hide detail" : "Show detail"}
                  </button>
                  <button
                    className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-ink)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0d1826] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!runReport}
                    onClick={handleDownloadReport}
                  >
                    Download
                  </button>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[color:var(--page-border)]">
                <SummaryRow
                  hint={preview ? `Generated ${formatTimestamp(preview.generatedAt)}` : "Run a preview scan to populate this summary."}
                  label="Eligible"
                  value={previewEligibleCount}
                />
                <SummaryRow label="Scanned" value={previewDiscoveredCount} />
                <SummaryRow
                  label="Comments"
                  value={preview?.counts.eligibleComments ?? previewProgress?.commentsDiscovered ?? 0}
                />
                <SummaryRow label="Posts" value={preview?.counts.eligiblePosts ?? previewProgress?.postsDiscovered ?? 0} />
              </div>
            )}
          </SummaryCard>
        </aside>
      </div>
    </div>
  );
}
