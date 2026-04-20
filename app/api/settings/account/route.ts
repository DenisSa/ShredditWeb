import { NextRequest } from "next/server";
import {
  ensureAccountSettings,
  loadAccountSchedule,
  loadPersistedAccountAuth,
  upsertPersistedAccountGrant,
  upsertAccountSchedule,
  upsertAccountSettings,
} from "@/lib/server/shreddit-db";
import { getDefaultCleanupSettings } from "@/lib/server/shreddit-core";
import { jsonError, jsonNoStore } from "@/lib/server/shreddit-responses";
import { getSessionFromRequest } from "@/lib/server/shreddit-store";
import { SCHEDULE_CADENCES, ScheduleCadence } from "@/lib/shreddit-types";
import {
  computeNextRunAt,
  validateScheduleFields,
} from "@/lib/shreddit-schedule";

export const runtime = "nodejs";

type AccountSettingsRequest = {
  storeDeletionHistory?: boolean;
  minAgeDays?: number;
  maxScore?: number;
  schedule?: {
    enabled?: boolean;
    cadence?: ScheduleCadence;
    minuteUtc?: number;
    hourUtc?: number | null;
    weekdayUtc?: number | null;
  };
};

function isValidCadence(value: unknown): value is ScheduleCadence {
  return typeof value === "string" && SCHEDULE_CADENCES.includes(value as ScheduleCadence);
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return jsonNoStore(
      {
        error: "Sign in with Reddit before updating account settings.",
      },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as AccountSettingsRequest;

    if (
      typeof body.storeDeletionHistory !== "boolean" ||
      !Number.isFinite(body.minAgeDays) ||
      Number(body.minAgeDays) <= 0 ||
      !Number.isFinite(body.maxScore) ||
      Number(body.maxScore) <= 0
    ) {
      return jsonNoStore(
        {
          error: "Provide storeDeletionHistory, minAgeDays, and maxScore with valid values.",
        },
        { status: 400 },
      );
    }

    if (!body.schedule) {
      return jsonNoStore(
        {
          error: "Provide a schedule payload.",
        },
        { status: 400 },
      );
    }

    if (typeof body.schedule.enabled !== "boolean" || !isValidCadence(body.schedule.cadence)) {
      return jsonNoStore(
        {
          error: "Provide a valid schedule cadence and enabled flag.",
        },
        { status: 400 },
      );
    }

    const nextSettings = upsertAccountSettings(session.reddit.username, {
      storeDeletionHistory: body.storeDeletionHistory,
      minAgeDays: Number(body.minAgeDays),
      maxScore: Number(body.maxScore),
    });
    const currentSchedule = loadAccountSchedule(session.reddit.username);
    const scheduleFields = {
      cadence: body.schedule.cadence,
      minuteUtc: Number(body.schedule.minuteUtc),
      hourUtc: body.schedule.hourUtc === null ? null : Number(body.schedule.hourUtc),
      weekdayUtc: body.schedule.weekdayUtc === null ? null : Number(body.schedule.weekdayUtc),
    };
    const validation = validateScheduleFields(scheduleFields);

    if (!validation.valid) {
      return jsonNoStore(
        {
          error: validation.error,
        },
        { status: 400 },
      );
    }

    let accountAuth = loadPersistedAccountAuth(session.reddit.username);

    if (!accountAuth) {
      accountAuth = upsertPersistedAccountGrant(session.reddit);
    }

    if (body.schedule.enabled && (!accountAuth?.grant || accountAuth.requiresReconnect)) {
      return jsonNoStore(
        {
          error: "Reconnect Reddit before enabling a schedule for this account.",
        },
        { status: 400 },
      );
    }

    const nextRunAt = body.schedule.enabled ? computeNextRunAt(scheduleFields, Date.now()) : null;
    const savedSchedule = upsertAccountSchedule(session.reddit.username, {
      enabled: body.schedule.enabled,
      cadence: scheduleFields.cadence,
      minuteUtc: scheduleFields.minuteUtc,
      hourUtc: scheduleFields.hourUtc,
      weekdayUtc: scheduleFields.weekdayUtc,
      nextRunAt,
      lastRunAt: currentSchedule?.lastRunAt ?? null,
      lastRunStatus: currentSchedule?.lastRunStatus ?? null,
      lastRunMessage: currentSchedule?.lastRunMessage ?? null,
    });

    return jsonNoStore({
      settings: nextSettings,
      schedule: savedSchedule,
      requiresReconnect: accountAuth?.requiresReconnect ?? false,
    });
  } catch (error) {
    return jsonError(error);
  }
}
