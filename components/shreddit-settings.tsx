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
import { ThemeToggle } from "@/components/theme-toggle";
import {
  type AccountSchedule,
  DEFAULT_STORE_DELETION_HISTORY,
  type ScheduledRunSummary,
  type SessionSummary,
  fetchScheduledHistory,
  fetchSessionSummary,
  formatExpiry,
  formatTimestamp,
  getBrowserTimezone,
  getBrowserTimezoneOffsetMinutes,
  saveAccountSettings,
  startOauthRedirect,
  toUserMessage,
  validateScopes,
} from "@/lib/shreddit";
import {
  summarizeCadence,
  toLocalScheduleFields,
  toUtcScheduleFields,
} from "@/lib/shreddit-schedule";

type WeekdayValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;

type StatusMessage = {
  key: string;
  tone: "info" | "warning" | "danger" | "success";
  content: ReactNode;
};

type SettingsFormState = {
  minAgeDays: number;
  maxScore: number;
  storeDeletionHistory: boolean;
  scheduleEnabled: boolean;
  cadence: AccountSchedule["cadence"];
  timeValue: string;
  minuteLocal: number;
  weekdayLocal: WeekdayValue;
};

type AccountSettingsPayload = {
  storeDeletionHistory: boolean;
  minAgeDays: number;
  maxScore: number;
  schedule: Pick<AccountSchedule, "enabled" | "cadence" | "minuteUtc" | "hourUtc" | "weekdayUtc">;
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
    theme: "dark",
  },
  schedule: null,
  requiresReconnect: false,
  lastScheduledRun: null,
  lastRun: null,
  lastRunDeletedSnippets: [],
};

const WEEKDAY_OPTIONS: Array<{ value: WeekdayValue; label: string }> = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function surfaceClassName(extra = "") {
  return `rounded-[24px] border border-[color:var(--page-border)] bg-[color:var(--page-surface)] shadow-[0_20px_48px_var(--page-shadow)] ${extra}`.trim();
}

function subtlePanelClassName(extra = "") {
  return `rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] ${extra}`.trim();
}

function sectionLabelClassName() {
  return "text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--page-muted)]";
}

function inputClassName() {
  return "mt-2 w-full rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface-strong)] px-4 py-3 text-sm text-[color:var(--page-ink)] shadow-none outline-none transition placeholder:text-[color:var(--page-muted)] focus:border-[color:var(--page-accent)]";
}

function parseTimeValue(value: string) {
  const [hour, minute] = value.split(":", 2).map((part) => Number(part));

  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 9,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  };
}

function formatTimeValue(hour: number | null, minute: number) {
  return `${(hour ?? 0).toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function formatLocalTimeLabel(timeValue: string, timeZone: string) {
  const { hour, minute } = parseTimeValue(timeValue);
  const reference = new Date();
  reference.setHours(hour, minute, 0, 0);

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    timeZone,
  }).format(reference);
}

function getTimezoneShortLabel(timeZone: string) {
  const part = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: "short",
  })
    .formatToParts(new Date())
    .find((value) => value.type === "timeZoneName");

  return part?.value || timeZone;
}

function defaultSettingsForm(summary: SessionSummary, timezoneOffsetMinutes: number): SettingsFormState {
  const storedSchedule = summary.schedule;
  const localSchedule = storedSchedule
    ? toLocalScheduleFields(storedSchedule, timezoneOffsetMinutes)
    : {
        cadence: "daily" as const,
        minuteLocal: 0,
        hourLocal: 9,
        weekdayLocal: 1,
      };

  return {
    minAgeDays: summary.settings.minAgeDays,
    maxScore: summary.settings.maxScore,
    storeDeletionHistory: summary.settings.storeDeletionHistory,
    scheduleEnabled: storedSchedule?.enabled ?? false,
    cadence: localSchedule.cadence,
    timeValue: formatTimeValue(localSchedule.hourLocal, localSchedule.minuteLocal),
    minuteLocal: localSchedule.minuteLocal,
    weekdayLocal: (localSchedule.weekdayLocal ?? 1) as WeekdayValue,
  };
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

function subscribeToMountState() {
  return () => {};
}

export function ShredditSettings() {
  const hasMounted = useSyncExternalStore(subscribeToMountState, () => true, () => false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary>(DEFAULT_SESSION_SUMMARY);
  const [settingsForm, setSettingsForm] = useState<SettingsFormState>(() => defaultSettingsForm(DEFAULT_SESSION_SUMMARY, 0));
  const [scheduledHistory, setScheduledHistory] = useState<ScheduledRunSummary[]>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const hydratedUsernameRef = useRef<string | null>(null);
  const formDirtyRef = useRef(false);
  const formRevisionRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const failedRevisionRef = useRef<number | null>(null);

  const timezone = hasMounted ? getBrowserTimezone() : "UTC";
  const timezoneOffsetMinutes = hasMounted ? getBrowserTimezoneOffsetMinutes() : 0;
  const session = sessionSummary.authenticated ? sessionSummary : null;
  const sessionWarnings = useMemo(() => (session ? validateScopes(session) : []), [session]);

  const utcScheduleFields = useMemo(() => {
    if (settingsForm.cadence === "hourly") {
      return {
        cadence: "hourly" as const,
        minuteUtc: settingsForm.minuteLocal,
        hourUtc: null,
        weekdayUtc: null,
      };
    }

    const { hour, minute } = parseTimeValue(settingsForm.timeValue);

    return toUtcScheduleFields(
      {
        cadence: settingsForm.cadence,
        minuteLocal: minute,
        hourLocal: hour,
        weekdayLocal: settingsForm.weekdayLocal,
      },
      timezoneOffsetMinutes,
    );
  }, [settingsForm.cadence, settingsForm.minuteLocal, settingsForm.timeValue, settingsForm.weekdayLocal, timezoneOffsetMinutes]);

  const localScheduleSummary = useMemo(() => {
    if (settingsForm.cadence === "hourly") {
      return `Every hour at :${settingsForm.minuteLocal.toString().padStart(2, "0")} ${getTimezoneShortLabel(timezone)}`;
    }

    const localTimeLabel = formatLocalTimeLabel(settingsForm.timeValue, timezone);

    if (settingsForm.cadence === "daily") {
      return `Every day at ${localTimeLabel}`;
    }

    return `${WEEKDAY_OPTIONS.find((option) => option.value === settingsForm.weekdayLocal)?.label ?? "Weekly"} at ${localTimeLabel}`;
  }, [settingsForm.cadence, settingsForm.minuteLocal, settingsForm.timeValue, settingsForm.weekdayLocal, timezone]);

  const utcScheduleSummary = useMemo(() => summarizeCadence(utcScheduleFields), [utcScheduleFields]);

  const autoSavePayload = useMemo<AccountSettingsPayload>(
    () => ({
      storeDeletionHistory: settingsForm.storeDeletionHistory,
      minAgeDays: settingsForm.minAgeDays,
      maxScore: settingsForm.maxScore,
      schedule: {
        enabled: settingsForm.scheduleEnabled,
        cadence: utcScheduleFields.cadence,
        minuteUtc: utcScheduleFields.minuteUtc,
        hourUtc: utcScheduleFields.hourUtc,
        weekdayUtc: utcScheduleFields.weekdayUtc,
      },
    }),
    [
      settingsForm.maxScore,
      settingsForm.minAgeDays,
      settingsForm.scheduleEnabled,
      settingsForm.storeDeletionHistory,
      utcScheduleFields.cadence,
      utcScheduleFields.hourUtc,
      utcScheduleFields.minuteUtc,
      utcScheduleFields.weekdayUtc,
    ],
  );

  const statusMessages = useMemo<StatusMessage[]>(() => {
    const messages: StatusMessage[] = [];

    if (!sessionSummary.authConfigured) {
      messages.push({
        key: "config",
        tone: "warning",
        content: sessionSummary.configurationError || "Server auth configuration is incomplete.",
      });
    }

    if (authError) {
      messages.push({
        key: "error",
        tone: "danger",
        content: authError,
      });
    }

    if (sessionWarnings.length > 0) {
      messages.push({
        key: "scope-warning",
        tone: "warning",
        content: (
          <>
            The current Reddit session is missing{" "}
            <code className="font-mono text-[0.95em]">{sessionWarnings.join(", ")}</code>. Reconnect and approve the full scope set.
          </>
        ),
      });
    }

    if (sessionSummary.requiresReconnect) {
      messages.push({
        key: "reconnect",
        tone: "warning",
        content: "Stored Reddit automation needs a fresh sign-in before scheduled cleanup can be enabled again.",
      });
    }

    return messages;
  }, [authError, sessionSummary, sessionWarnings]);

  const syncSettingsForm = useCallback((summary: SessionSummary) => {
    if (!hasMounted) {
      return;
    }

    if (!summary.authenticated) {
      setSettingsForm(defaultSettingsForm(summary, timezoneOffsetMinutes));
      hydratedUsernameRef.current = null;
      formDirtyRef.current = false;
      formRevisionRef.current = 0;
      failedRevisionRef.current = null;
      return;
    }

    if (hydratedUsernameRef.current !== summary.username || !formDirtyRef.current) {
      setSettingsForm(defaultSettingsForm(summary, timezoneOffsetMinutes));
      hydratedUsernameRef.current = summary.username;
      formDirtyRef.current = false;
      failedRevisionRef.current = null;
    }
  }, [hasMounted, timezoneOffsetMinutes]);

  const refreshScheduledHistory = useCallback(async (username?: string | null) => {
    if (!username) {
      setScheduledHistory([]);
      return;
    }

    const response = await fetchScheduledHistory(8);
    setScheduledHistory(response.items);
  }, []);

  const refreshSessionSummary = useCallback(async () => {
    const summary = await fetchSessionSummary();
    setSessionSummary(summary);
    syncSettingsForm(summary);
    await refreshScheduledHistory(summary.username);
    return summary;
  }, [refreshScheduledHistory, syncSettingsForm]);

  const applySavedSettings = useCallback(
    (
      updated: {
        settings: SessionSummary["settings"];
        schedule: SessionSummary["schedule"];
        requiresReconnect: boolean;
      },
      username: string,
      revision: number,
      requestId: number,
    ) => {
      if (requestId !== saveRequestIdRef.current) {
        return;
      }

      hydratedUsernameRef.current = username;

      if (formRevisionRef.current === revision) {
        formDirtyRef.current = false;
      }
      failedRevisionRef.current = null;

      setSessionSummary((current) => ({
        ...current,
        minAgeDays: updated.settings.minAgeDays,
        maxScore: updated.settings.maxScore,
        settings: updated.settings,
        preferences: {
          ...current.preferences,
          storeDeletionHistory: updated.settings.storeDeletionHistory,
        },
        schedule: updated.schedule,
        requiresReconnect: updated.requiresReconnect,
      }));
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setIsBootstrapping(true);

      try {
        await refreshSessionSummary();
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

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [refreshSessionSummary]);

  useEffect(() => {
    if (!session?.username) {
      return;
    }

    const interval = setInterval(() => {
      void refreshSessionSummary().catch(() => {});
    }, 30_000);

    return () => clearInterval(interval);
  }, [refreshSessionSummary, session?.username]);

  useEffect(() => {
    if (!session?.username || !hasMounted || isBootstrapping || isSaving || !formDirtyRef.current) {
      return;
    }

    const revision = formRevisionRef.current;

    if (failedRevisionRef.current === revision) {
      return;
    }

    const username = session.username;
    const timeout = setTimeout(() => {
      const requestId = saveRequestIdRef.current + 1;
      saveRequestIdRef.current = requestId;
      setIsSaving(true);
      setAuthError(null);

      void saveAccountSettings(autoSavePayload)
        .then((updated) => {
          applySavedSettings(updated, username, revision, requestId);
        })
        .catch((error) => {
          if (requestId !== saveRequestIdRef.current) {
            return;
          }

          failedRevisionRef.current = revision;
          setAuthError(toUserMessage(error));
        })
        .finally(() => {
          if (requestId === saveRequestIdRef.current) {
            setIsSaving(false);
          }
        });
    }, 450);

    return () => clearTimeout(timeout);
  }, [applySavedSettings, autoSavePayload, hasMounted, isBootstrapping, isSaving, session?.username]);

  function updateSettingsForm<K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) {
    formDirtyRef.current = true;
    formRevisionRef.current += 1;
    failedRevisionRef.current = null;
    setAuthError(null);
    setSettingsForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handleSignIn() {
    setAuthError(null);

    if (!sessionSummary.authConfigured) {
      setAuthError(sessionSummary.configurationError || "Server auth configuration is incomplete.");
      return;
    }

    startOauthRedirect(window.location);
  }

  if (!hasMounted) {
    return null;
  }

  return (
    <div className="pb-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface)] shadow-[0_10px_30px_var(--page-shadow-soft)]">
            <Logo className="text-[color:var(--page-accent)]" size={22} />
          </div>
          <div>
            <p className={sectionLabelClassName()}>ShredditWeb</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)] sm:text-3xl">
              Settings
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ThemeToggle
            authenticated={Boolean(session)}
            onError={setAuthError}
            onSaved={(theme) => {
              setSessionSummary((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  theme,
                },
              }));
            }}
            preferredTheme={sessionSummary.preferences.theme}
          />
          <Link
            className="inline-flex items-center justify-center rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface)] px-4 py-2 text-sm font-semibold text-[color:var(--page-ink)] transition hover:border-[color:var(--page-border-strong)]"
            href="/"
          >
            Back to cleanup
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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className={sectionLabelClassName()}>Automation</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--page-ink)]">
                  Cleanup settings
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-[color:var(--page-muted)]">
                  Adjust your cleanup rules and schedule here. Changes save automatically as you edit.
                </p>
              </div>
              {!session ? (
                <button
                  className="inline-flex items-center justify-center rounded-full bg-[color:var(--page-accent)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[color:var(--page-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!sessionSummary.authConfigured || isBootstrapping}
                  onClick={handleSignIn}
                >
                  Connect Reddit
                </button>
              ) : null}
            </div>

            <div className="mt-6">
              <StatusStack messages={statusMessages} />
            </div>

            <div className="mt-4 flex items-center gap-3 text-sm text-[color:var(--page-muted)]">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isSaving ? "bg-[color:var(--page-accent)]" : "bg-[color:var(--page-success)]"
                }`}
              />
              <span>
                {!session
                  ? "Connect Reddit to edit saved settings."
                  : isSaving
                    ? "Saving changes..."
                    : "Changes save automatically."}
              </span>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-[color:var(--page-muted-strong)]">
                    Minimum age (days)
                    <input
                      className={inputClassName()}
                      disabled={!session}
                      min={1}
                      onChange={(event) => updateSettingsForm("minAgeDays", Math.max(1, Number(event.target.value) || 1))}
                      type="number"
                      value={settingsForm.minAgeDays}
                    />
                  </label>
                  <label className="text-sm text-[color:var(--page-muted-strong)]">
                    Maximum score
                    <input
                      className={inputClassName()}
                      disabled={!session}
                      min={1}
                      onChange={(event) => updateSettingsForm("maxScore", Math.max(1, Number(event.target.value) || 1))}
                      type="number"
                      value={settingsForm.maxScore}
                    />
                  </label>
                </div>

                <div className={subtlePanelClassName("px-4 py-4")}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[color:var(--page-ink)]">Store deleted history</p>
                      <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">
                        When enabled, live deletions keep original content and metadata in SQLite for this account.
                      </p>
                    </div>
                    <button
                      aria-checked={settingsForm.storeDeletionHistory}
                      className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        settingsForm.storeDeletionHistory ? "bg-[color:var(--page-accent)]" : "bg-[rgba(91,103,118,0.22)]"
                      }`}
                      disabled={!session}
                      onClick={() => updateSettingsForm("storeDeletionHistory", !settingsForm.storeDeletionHistory)}
                      role="switch"
                      type="button"
                    >
                      <span className="sr-only">Store deleted history for this Reddit account</span>
                      <span
                        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-[0_6px_16px_rgba(15,23,42,0.18)] transition ${
                          settingsForm.storeDeletionHistory ? "left-6" : "left-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div className={subtlePanelClassName("px-4 py-4")}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-[color:var(--page-ink)]">Scheduled cleanup</p>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">
                      Schedule runs in your browser time with the browser&apos;s native time input, then the app stores the UTC equivalent for execution.
                    </p>
                  </div>
                  <button
                    aria-checked={settingsForm.scheduleEnabled}
                    className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-60 ${
                      settingsForm.scheduleEnabled ? "bg-[color:var(--page-danger)]" : "bg-[rgba(91,103,118,0.22)]"
                    }`}
                    disabled={!session || sessionSummary.requiresReconnect}
                    onClick={() => updateSettingsForm("scheduleEnabled", !settingsForm.scheduleEnabled)}
                    role="switch"
                    type="button"
                  >
                    <span className="sr-only">Enable scheduled cleanup</span>
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-[0_6px_16px_rgba(15,23,42,0.18)] transition ${
                        settingsForm.scheduleEnabled ? "left-6" : "left-1"
                      }`}
                    />
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <label className="text-sm text-[color:var(--page-muted-strong)]">
                    Cadence
                    <select
                      className={inputClassName()}
                      disabled={!session}
                      onChange={(event) => updateSettingsForm("cadence", event.target.value as AccountSchedule["cadence"])}
                      value={settingsForm.cadence}
                    >
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </select>
                  </label>

                  {settingsForm.cadence === "hourly" ? (
                    <label className="text-sm text-[color:var(--page-muted-strong)]">
                      Minute
                      <input
                        className={inputClassName()}
                        disabled={!session}
                        max={59}
                        min={0}
                        onChange={(event) =>
                          updateSettingsForm("minuteLocal", Math.min(59, Math.max(0, Number(event.target.value) || 0)))
                        }
                        type="number"
                        value={settingsForm.minuteLocal}
                      />
                    </label>
                  ) : (
                    <label className="text-sm text-[color:var(--page-muted-strong)]">
                      Time
                      <input
                        className={inputClassName()}
                        disabled={!session}
                        onChange={(event) => updateSettingsForm("timeValue", event.target.value)}
                        step={60}
                        type="time"
                        value={settingsForm.timeValue}
                      />
                    </label>
                  )}

                  {settingsForm.cadence === "weekly" ? (
                    <label className="text-sm text-[color:var(--page-muted-strong)]">
                      Weekday
                      <select
                        className={inputClassName()}
                        disabled={!session}
                        onChange={(event) => updateSettingsForm("weekdayLocal", Number(event.target.value) as WeekdayValue)}
                        value={settingsForm.weekdayLocal}
                      >
                        {WEEKDAY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <div className="rounded-2xl border border-[color:var(--page-border)] bg-[color:var(--page-surface)] px-4 py-3 text-sm leading-6 text-[color:var(--page-muted)]">
                    <p className="font-medium text-[color:var(--page-ink)]">{localScheduleSummary}</p>
                    <p className="mt-1">Stored as {utcScheduleSummary}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[color:var(--page-muted)]">
                      {sessionSummary.schedule?.enabled && sessionSummary.schedule.nextRunAt
                        ? `Next run ${formatTimestamp(sessionSummary.schedule.nextRunAt)}`
                        : "Schedule disabled"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className={surfaceClassName("p-5")}>
            <p className={sectionLabelClassName()}>Account</p>
            <div className="mt-4 divide-y divide-[color:var(--page-border)]">
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[color:var(--page-muted-strong)]">Username</p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">Current Reddit account for this device session.</p>
                </div>
                <div className="text-right text-sm font-semibold text-[color:var(--page-ink)]">{session?.username || "Signed out"}</div>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[color:var(--page-muted-strong)]">Token</p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">Current access token status.</p>
                </div>
                <div className="text-right text-sm font-semibold text-[color:var(--page-ink)]">{session ? formatExpiry(session.expiresAt) : "Not connected"}</div>
              </div>
            </div>
          </section>

          <section className={surfaceClassName("p-5")}>
            <p className={sectionLabelClassName()}>Automation</p>
            <div className="mt-4 divide-y divide-[color:var(--page-border)]">
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[color:var(--page-muted-strong)]">Status</p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">Whether scheduled cleanup is enabled.</p>
                </div>
                <div className="text-right text-sm font-semibold text-[color:var(--page-ink)]">
                  {sessionSummary.schedule?.enabled ? "Enabled" : "Disabled"}
                </div>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[color:var(--page-muted-strong)]">Next run</p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">Shown in your browser timezone.</p>
                </div>
                <div className="text-right text-sm font-semibold text-[color:var(--page-ink)]">
                  {sessionSummary.schedule?.enabled && sessionSummary.schedule.nextRunAt
                    ? formatTimestamp(sessionSummary.schedule.nextRunAt)
                    : "Disabled"}
                </div>
              </div>
              <div className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-[color:var(--page-muted-strong)]">Last run</p>
                  <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">Most recent scheduled execution.</p>
                </div>
                <div className="text-right text-sm font-semibold text-[color:var(--page-ink)]">
                  {sessionSummary.lastScheduledRun?.status || "None yet"}
                </div>
              </div>
            </div>
          </section>

          <section className={surfaceClassName("p-5")}>
            <p className={sectionLabelClassName()}>Recent scheduled runs</p>
            <div className="mt-4 space-y-3">
              {scheduledHistory.length === 0 ? (
                <div className={subtlePanelClassName("px-4 py-4 text-sm leading-6 text-[color:var(--page-muted)]")}>
                  Scheduled runs will appear here after automation has executed.
                </div>
              ) : (
                scheduledHistory.slice(0, 4).map((item) => (
                  <div className={subtlePanelClassName("px-4 py-4")} key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[color:var(--page-ink)]">{item.status}</p>
                        <p className="mt-1 text-sm leading-6 text-[color:var(--page-muted)]">
                          {item.message || "No additional message was recorded."}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs uppercase tracking-[0.14em] text-[color:var(--page-muted)]">
                        {formatTimestamp(item.finishedAt)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
