"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "@/components/icons";
import {
  JobSnapshot,
  PreviewProgress,
  PreviewResult,
  RunReport,
  SessionSummary,
  createReportDownload,
  fetchRunStatus,
  fetchSessionSummary,
  formatAgeInDays,
  formatExpiry,
  formatTimestamp,
  getItemSummary,
  logoutRedditSession,
  requestPreview,
  startOauthRedirect,
  startRun,
  subscribeToRunEvents,
  toUserMessage,
  validateScopes,
} from "@/lib/shreddit";

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
};

function cardClassName(extra = "") {
  return `rounded-[30px] border border-[color:var(--page-border)] bg-[color:var(--page-panel)] p-6 shadow-[0_18px_60px_rgba(45,28,14,0.08)] backdrop-blur ${extra}`.trim();
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[color:var(--page-muted)]">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--page-ink)]">{value}</p>
      {hint ? (
        <p className="mt-2 text-sm leading-6 text-[color:var(--page-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--page-accent)]">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)]">{title}</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--page-muted)]">{description}</p>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warning" | "danger" | "success";
  children: React.ReactNode;
}) {
  const toneClassName =
    tone === "danger"
      ? "border-[rgba(154,47,32,0.24)] bg-[rgba(154,47,32,0.08)] text-[color:var(--page-danger)]"
      : tone === "warning"
      ? "border-[rgba(165,106,22,0.24)] bg-[rgba(165,106,22,0.08)] text-[color:var(--page-warning)]"
      : tone === "success"
      ? "border-[rgba(44,106,68,0.24)] bg-[rgba(44,106,68,0.08)] text-[color:var(--page-success)]"
      : "border-[rgba(182,59,24,0.18)] bg-[rgba(182,59,24,0.08)] text-[color:var(--page-accent)]";

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${toneClassName}`}>
      {children}
    </div>
  );
}

function PreviewSample({ preview }: { preview: PreviewResult | null }) {
  if (!preview) {
    return (
      <div className="rounded-3xl border border-dashed border-[color:var(--page-border)] px-4 py-5 text-sm leading-7 text-[color:var(--page-muted)]">
        Run a server-side preview scan to see which comments and posts match the current rules before you unlock the destructive action.
      </div>
    );
  }

  const items = preview.eligibleItems.slice(0, 6);

  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-[color:var(--page-border)] px-4 py-5 text-sm leading-7 text-[color:var(--page-muted)]">
        No items matched the current age and score rules.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          className="rounded-3xl border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] px-4 py-4"
          key={item.name}
        >
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--page-muted)]">
            <span>{item.contentKind === "comment" ? "Comment" : "Post"}</span>
            <span>r/{item.subreddit}</span>
            <span>{formatAgeInDays(item.createdUtc)}</span>
            <span>score {item.score}</span>
          </div>
          <p className="mt-2 text-sm leading-7 text-[color:var(--page-ink)]">{getItemSummary(item)}</p>
          <a
            className="mt-2 inline-flex text-xs font-semibold tracking-[0.16em] text-[color:var(--page-accent)] underline-offset-4 hover:underline"
            href={item.permalink}
            rel="noreferrer"
            target="_blank"
          >
            Open on reddit
          </a>
        </div>
      ))}
    </div>
  );
}

function FailureList({ report }: { report: RunReport }) {
  if (report.failures.length === 0) {
    return (
      <p className="text-sm leading-7 text-[color:var(--page-success)]">
        No item-level failures were recorded for this run.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {report.failures.slice(0, 12).map((failure) => (
        <div
          className="rounded-3xl border border-[rgba(154,47,32,0.18)] bg-[rgba(154,47,32,0.05)] px-4 py-4"
          key={`${failure.id}-${failure.step}`}
        >
          <p className="text-sm font-semibold text-[color:var(--page-ink)]">{failure.label}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--page-danger)]">
            {failure.step}
          </p>
          <p className="mt-2 text-sm leading-7 text-[color:var(--page-muted)]">{failure.message}</p>
          <a
            className="mt-2 inline-flex text-xs font-semibold tracking-[0.16em] text-[color:var(--page-accent)] underline-offset-4 hover:underline"
            href={failure.permalink}
            rel="noreferrer"
            target="_blank"
          >
            Open failed item
          </a>
        </div>
      ))}
      {report.failures.length > 12 ? (
        <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--page-muted)]">
          Showing the first 12 failures. Download the full report for everything else.
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
    <div className="pb-8">
      <section className={cardClassName("overflow-hidden px-6 py-7 sm:px-8 sm:py-9")}>
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-[color:var(--page-border)] bg-[rgba(255,255,255,0.55)] px-4 py-2">
              <Logo className="text-[color:var(--page-accent)]" size={26} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--page-muted)]">
                Server-backed shredder
              </span>
            </div>
            <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-[-0.04em] text-[color:var(--page-ink)] sm:text-6xl">
              Revoke the past, one old Reddit thread at a time.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[color:var(--page-muted)] sm:text-lg">
              Preparing the browser session, checking server configuration, and reconnecting any active shred job.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <StatCard label="Server auth" value="Loading" hint="Reading the current runtime configuration from the server." />
            <StatCard label="Session" value="Loading" hint="Checking whether this browser already has an active Reddit session." />
          </div>
        </div>
      </section>
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

  const eventSourceRef = useRef<EventSource | null>(null);
  const runtimeConfig = sessionSummary;
  const session = sessionSummary.authenticated ? sessionSummary : null;
  const sessionWarnings = session ? validateScopes(session) : [];
  const runProgress = jobSnapshot?.progress ?? null;
  const runReport = jobSnapshot?.report ?? null;
  const isRunning = jobSnapshot?.status === "running";

  const progressPercent = useMemo(() => {
    if (!runProgress) {
      return runReport ? 100 : 0;
    }

    if (runProgress.total === 0) {
      return 0;
    }

    return Math.min(100, Math.round((runProgress.processed / runProgress.total) * 100));
  }, [runProgress, runReport]);

  const closeRunStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const refreshSessionSummary = useCallback(async () => {
    const summary = await fetchSessionSummary();
    setSessionSummary(summary);
    setJobSnapshot(summary.activeJob);
    return summary;
  }, []);

  const hydrateActiveJob = useCallback(async (jobId: string) => {
    const snapshot = await fetchRunStatus(jobId);
    setJobSnapshot(snapshot);
    return snapshot;
  }, []);

  const connectToJob = useCallback((jobId: string) => {
    closeRunStream();

    const source = subscribeToRunEvents(jobId, {
      onProgress: (job) => {
        setJobSnapshot(job);
      },
      onComplete: (job) => {
        setJobSnapshot(job);
        setNotice(job.report?.dryRun ? "Dry run complete. Nothing was deleted." : "Run complete. Review the report below.");
        closeRunStream();
        void refreshSessionSummary().catch(() => {});
      },
      onError: (job) => {
        setJobSnapshot(job);
        setNotice(job.report?.stopReason || "Run stopped before completion.");
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
  }, [closeRunStream, refreshSessionSummary]);

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

        const summary = await fetchSessionSummary();

        if (cancelled) {
          return;
        }

        setSessionSummary(summary);
        setJobSnapshot(summary.activeJob);

        if (summary.activeJob?.jobId) {
          const snapshot = await hydrateActiveJob(summary.activeJob.jobId);

          if (cancelled) {
            return;
          }

          if (snapshot.status === "running") {
            setNotice("Reconnected to an active server-side shred job.");
            connectToJob(snapshot.jobId);
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
  }, [closeRunStream, connectToJob, hydrateActiveJob]);

  function resetWorkflowState() {
    setPreview(null);
    setPreviewProgress(null);
    setJobSnapshot(null);
    setConfirmChecked(false);
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
      const summary = await fetchSessionSummary();
      setSessionSummary(summary);
      resetWorkflowState();
      setNotice("Server-side Reddit session cleared for this browser session.");
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
    setPreviewProgress({
      stage: "identity",
      commentsDiscovered: 0,
      postsDiscovered: 0,
    });

    try {
      const nextPreview = await requestPreview();
      setPreview(nextPreview);
      setConfirmChecked(false);
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
      } else {
        setNotice(snapshot.report?.stopReason || "Run stopped before completion.");
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

  return (
    <div className="pb-8">
      <section className={cardClassName("overflow-hidden px-6 py-7 sm:px-8 sm:py-9")}>
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-[color:var(--page-border)] bg-[rgba(255,255,255,0.55)] px-4 py-2">
              <Logo className="text-[color:var(--page-accent)]" size={26} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-[color:var(--page-muted)]">
                Server-backed shredder
              </span>
            </div>
            <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-[-0.04em] text-[color:var(--page-ink)] sm:text-6xl">
              Revoke the past, one old Reddit trail at a time.
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-8 text-[color:var(--page-muted)] sm:text-lg">
              ShredditWeb now uses a single Reddit web app with server-side token exchange, HTTP-only browser-session
              cookies, and background jobs that can keep running while this server stays alive. Sign in once, preview
              what matches, then launch a dry run or destructive pass without exposing Reddit tokens to the browser.
            </p>
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <span className="rounded-full bg-[rgba(44,106,68,0.10)] px-4 py-2 font-semibold text-[color:var(--page-success)]">
                OAuth scopes: identity, history, edit
              </span>
              <span className="rounded-full bg-[rgba(165,106,22,0.10)] px-4 py-2 font-semibold text-[color:var(--page-warning)]">
                Session cookie only
              </span>
              <span className="rounded-full bg-[rgba(182,59,24,0.10)] px-4 py-2 font-semibold text-[color:var(--page-accent)]">
                Jobs keep running on the server
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <StatCard
              label="Active rules"
              value={`score < ${runtimeConfig.maxScore}`}
              hint={`Only content older than ${runtimeConfig.minAgeDays} days is eligible.`}
            />
            <StatCard
              label="OAuth callback"
              value={runtimeConfig.redirectUri ? "Configured" : "Missing"}
              hint={runtimeConfig.redirectUri || "Set REDDIT_REDIRECT_URI to the exact callback URL for this server."}
            />
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className={cardClassName()}>
          <SectionTitle
            eyebrow="Connection"
            title="Authenticate through the server"
            description="Register one Reddit Web App, point its callback URI at this server, and sign in here. The browser only receives a session cookie; Reddit tokens stay on the server."
          />

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <StatCard
              label="Server auth"
              value={runtimeConfig.authConfigured ? "Ready" : "Missing"}
              hint={runtimeConfig.configurationError || "Client ID, secret, redirect URI, and session secret are configured."}
            />
            <StatCard
              label="Session"
              value={session?.username || (isBootstrapping ? "Checking" : "Signed out")}
              hint={
                session
                  ? `Access token ${formatExpiry(session.expiresAt)}`
                  : "A session cookie is browser-only; Reddit tokens remain server-side."
              }
            />
          </div>

          <div className="mt-6 space-y-3">
            {!runtimeConfig.authConfigured ? (
              <Notice tone="warning">
                {runtimeConfig.configurationError || "Server auth configuration is incomplete."}
              </Notice>
            ) : null}
            {authError ? <Notice tone="danger">{authError}</Notice> : null}
            {notice ? <Notice tone="info">{notice}</Notice> : null}
            {sessionWarnings.length > 0 ? (
              <Notice tone="warning">
                The current Reddit session is missing: <code className="font-mono">{sessionWarnings.join(", ")}</code>. Sign in again and approve the full scope set.
              </Notice>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!runtimeConfig.authConfigured || isBootstrapping || isRunning || isPreviewing}
              onClick={handleSignIn}
            >
              Sign in with Reddit
            </button>
            <button
              className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] px-5 py-3 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[rgba(32,21,15,0.24)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!session || isPreviewing || isRunning}
              onClick={handleLogout}
            >
              Clear server session
            </button>
          </div>

          <div className="mt-6 rounded-3xl border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--page-muted)]">Web app checklist</p>
            <ul className="mt-3 space-y-2 text-sm leading-7 text-[color:var(--page-muted)]">
              <li>1. Create a Web App at <code className="font-mono">reddit.com/prefs/apps</code>.</li>
              <li>2. Set its callback URI to <code className="font-mono">{runtimeConfig.redirectUri || "your callback URL"}</code>.</li>
              <li>3. Keep the client secret on the server and sign in through this site.</li>
            </ul>
          </div>
        </section>

        <section className={cardClassName()}>
          <SectionTitle
            eyebrow="Preview"
            title="Scan comments and posts before shredding"
            description="The preview phase now runs on the server using your Reddit session, applies the fixed age and score rules, and stores the matching list only for this browser session."
          />

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-ink)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#130c08] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!session || isPreviewing || isRunning}
              onClick={handlePreview}
            >
              {isPreviewing ? "Scanning Reddit history..." : "Scan my account"}
            </button>
            <label className="inline-flex items-center gap-3 rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] px-4 py-3 text-sm font-semibold text-[color:var(--page-ink)]">
              <input
                checked={dryRun}
                className="h-4 w-4 accent-[color:var(--page-accent)]"
                disabled={isRunning}
                onChange={(event) => setDryRun(event.target.checked)}
                type="checkbox"
              />
              Dry run only
            </label>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Comments discovered"
              value={preview?.counts.commentsDiscovered ?? previewProgress?.commentsDiscovered ?? 0}
            />
            <StatCard
              label="Posts discovered"
              value={preview?.counts.postsDiscovered ?? previewProgress?.postsDiscovered ?? 0}
            />
            <StatCard label="Eligible comments" value={preview?.counts.eligibleComments ?? 0} />
            <StatCard label="Eligible posts" value={preview?.counts.eligiblePosts ?? 0} />
          </div>

          {previewProgress && isPreviewing ? (
            <div className="mt-6 rounded-3xl border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] px-4 py-4 text-sm leading-7 text-[color:var(--page-muted)]">
              Scanning stage: <span className="font-semibold text-[color:var(--page-ink)]">{previewProgress.stage}</span>
            </div>
          ) : null}

          <div className="mt-6">
            <PreviewSample preview={preview} />
          </div>
        </section>
      </div>

      <section className={`${cardClassName()} mt-6`}>
        <SectionTitle
          eyebrow="Execution"
          title="Run the destructive pass"
          description="Once started, the server owns the run and can keep working if the page refreshes. If the server process restarts or the Reddit session becomes invalid mid-run, the job stops and reports what happened."
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <Notice tone="warning">
              Review the preview first. The destructive button stays locked until you acknowledge that matching comments and posts will be overwritten and deleted through the server session.
            </Notice>

            <label className="flex items-start gap-3 rounded-3xl border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] px-4 py-4 text-sm leading-7 text-[color:var(--page-ink)]">
              <input
                checked={confirmChecked}
                className="mt-1 h-4 w-4 accent-[color:var(--page-accent)]"
                disabled={!preview || preview.eligibleItems.length === 0 || isRunning}
                onChange={(event) => setConfirmChecked(event.target.checked)}
                type="checkbox"
              />
              <span>I understand that this run targets content older than {runtimeConfig.minAgeDays} days with score below {runtimeConfig.maxScore}.</span>
            </label>

            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!preview || preview.eligibleItems.length === 0 || !confirmChecked || isRunning || isPreviewing}
                onClick={handleRun}
              >
                {isRunning ? (dryRun ? "Simulating..." : "Shredding...") : dryRun ? "Run dry simulation" : "Begin shredding"}
              </button>
              <button
                className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] px-5 py-3 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[rgba(32,21,15,0.24)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!runReport}
                onClick={handleDownloadReport}
              >
                Download run report
              </button>
            </div>
          </div>

          <div className="rounded-[30px] border border-[color:var(--page-border)] bg-[color:var(--page-panel-strong)] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--page-muted)]">Run progress</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)]">
                  {runProgress?.currentLabel || runReport?.status || "Idle"}
                </p>
              </div>
              <p className="text-sm font-semibold text-[color:var(--page-muted)]">{progressPercent}%</p>
            </div>

            <div className="mt-4 h-3 overflow-hidden rounded-full bg-[rgba(32,21,15,0.08)]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--page-accent),#db6b2a)] transition-[width] duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <StatCard label="Processed" value={runProgress?.processed ?? runReport?.totals.processed ?? 0} />
              <StatCard label="Deleted" value={runProgress?.deleted ?? runReport?.totals.deleted ?? 0} />
              <StatCard label="Failed" value={runProgress?.failed ?? runReport?.totals.failed ?? 0} />
            </div>

            <p className="mt-4 text-sm leading-7 text-[color:var(--page-muted)]">
              {runProgress?.currentStep ||
                runReport?.stopReason ||
                "Runs are executed sequentially on the server so the UI can reconnect and show each stage."}
            </p>

            {runReport ? (
              <div className="mt-6 rounded-3xl border border-[color:var(--page-border)] bg-white/50 px-4 py-4 text-sm leading-7 text-[color:var(--page-muted)]">
                <p>
                  Finished: <span className="font-semibold text-[color:var(--page-ink)]">{formatTimestamp(runReport.finishedAt)}</span>
                </p>
                <p>
                  Mode: <span className="font-semibold text-[color:var(--page-ink)]">{runReport.dryRun ? "Dry run" : "Live deletion"}</span>
                </p>
                <p>
                  Status: <span className="font-semibold text-[color:var(--page-ink)]">{runReport.status}</span>
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {runReport ? (
        <section className={`${cardClassName()} mt-6`}>
          <SectionTitle
            eyebrow="Report"
            title="Run summary"
            description="The report is generated on the server and downloaded in your browser. Save it before starting another run if you want a local audit trail."
          />

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Discovered" value={runReport.totals.discovered} />
            <StatCard label="Eligible" value={runReport.totals.eligible} />
            <StatCard label="Edited" value={runReport.totals.edited} />
            <StatCard label="Deleted" value={runReport.totals.deleted} />
          </div>

          <div className="mt-6">
            <FailureList report={runReport} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
