import {
  AccountSchedule,
  ScheduleCadence,
  ScheduledRunStatus,
} from "@/lib/shreddit-types";

export type ScheduleFields = Pick<AccountSchedule, "cadence" | "minuteUtc" | "hourUtc" | "weekdayUtc">;

export type BrowserScheduleFields = {
  cadence: ScheduleCadence;
  minuteLocal: number;
  hourLocal: number | null;
  weekdayLocal: number | null;
};

export type ScheduleValidationResult = {
  valid: boolean;
  error: string | null;
};

const MINUTES_PER_DAY = 24 * 60;
const MILLIS_PER_MINUTE = 60_000;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeModulo(value: number, modulo: number) {
  return ((value % modulo) + modulo) % modulo;
}

export function validateScheduleFields(fields: ScheduleFields): ScheduleValidationResult {
  if (!Number.isInteger(fields.minuteUtc) || fields.minuteUtc < 0 || fields.minuteUtc > 59) {
    return {
      valid: false,
      error: "Choose a UTC minute between 0 and 59.",
    };
  }

  if (fields.cadence === "hourly") {
    return {
      valid: true,
      error: null,
    };
  }

  const hourUtc = fields.hourUtc;

  if (hourUtc === null || !Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) {
    return {
      valid: false,
      error: "Choose a UTC hour between 0 and 23.",
    };
  }

  if (fields.cadence === "daily") {
    return {
      valid: true,
      error: null,
    };
  }

  const weekdayUtc = fields.weekdayUtc;

  if (weekdayUtc === null || !Number.isInteger(weekdayUtc) || weekdayUtc < 0 || weekdayUtc > 6) {
    return {
      valid: false,
      error: "Choose a UTC weekday between 0 and 6.",
    };
  }

  return {
    valid: true,
    error: null,
  };
}

function computeNextHourly(fields: ScheduleFields, fromMs: number) {
  const next = new Date(fromMs);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(fields.minuteUtc);

  if (next.getTime() <= fromMs) {
    next.setUTCHours(next.getUTCHours() + 1);
  }

  return next.getTime();
}

function computeNextDaily(fields: ScheduleFields, fromMs: number) {
  const hourUtc = fields.hourUtc ?? 0;
  const next = new Date(fromMs);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(hourUtc, fields.minuteUtc, 0, 0);

  if (next.getTime() <= fromMs) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next.getTime();
}

function computeNextWeekly(fields: ScheduleFields, fromMs: number) {
  const hourUtc = fields.hourUtc ?? 0;
  const desiredWeekday = fields.weekdayUtc ?? 0;
  const next = new Date(fromMs);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(hourUtc, fields.minuteUtc, 0, 0);
  const currentWeekday = next.getUTCDay();
  let dayDelta = normalizeModulo(desiredWeekday - currentWeekday, 7);

  if (dayDelta === 0 && next.getTime() <= fromMs) {
    dayDelta = 7;
  }

  next.setUTCDate(next.getUTCDate() + dayDelta);
  return next.getTime();
}

export function computeNextRunAt(fields: ScheduleFields, fromMs: number) {
  const validation = validateScheduleFields(fields);

  if (!validation.valid) {
    throw new Error(validation.error ?? "Schedule fields are invalid.");
  }

  if (fields.cadence === "hourly") {
    return computeNextHourly(fields, fromMs);
  }

  if (fields.cadence === "daily") {
    return computeNextDaily(fields, fromMs);
  }

  return computeNextWeekly(fields, fromMs);
}

export function advanceSchedule(fields: ScheduleFields, afterMs: number) {
  return computeNextRunAt(fields, afterMs);
}

export function summarizeCadence(fields: ScheduleFields) {
  if (fields.cadence === "hourly") {
    return `Every hour at :${fields.minuteUtc.toString().padStart(2, "0")} UTC`;
  }

  const timeLabel = `${(fields.hourUtc ?? 0).toString().padStart(2, "0")}:${fields.minuteUtc
    .toString()
    .padStart(2, "0")} UTC`;

  if (fields.cadence === "daily") {
    return `Every day at ${timeLabel}`;
  }

  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `${weekdays[fields.weekdayUtc ?? 0]} at ${timeLabel}`;
}

export function toUtcScheduleFields(localFields: BrowserScheduleFields, timezoneOffsetMinutes: number): ScheduleFields {
  const utcMinutesOfDay = normalizeModulo(
    ((localFields.hourLocal ?? 0) * 60) + localFields.minuteLocal + timezoneOffsetMinutes,
    MINUTES_PER_DAY,
  );
  const utcHour = Math.floor(utcMinutesOfDay / 60);
  const utcMinute = utcMinutesOfDay % 60;
  const dayShift = Math.floor(
    ((((localFields.hourLocal ?? 0) * 60) + localFields.minuteLocal + timezoneOffsetMinutes) -
      utcMinutesOfDay) /
      MINUTES_PER_DAY,
  );

  return {
    cadence: localFields.cadence,
    minuteUtc: utcMinute,
    hourUtc: localFields.cadence === "hourly" ? null : utcHour,
    weekdayUtc:
      localFields.cadence === "weekly" && localFields.weekdayLocal !== null
        ? normalizeModulo(localFields.weekdayLocal + dayShift, 7)
        : null,
  };
}

export function toLocalScheduleFields(utcFields: ScheduleFields, timezoneOffsetMinutes: number): BrowserScheduleFields {
  const utcTotalMinutes = ((utcFields.hourUtc ?? 0) * 60) + utcFields.minuteUtc;
  const localMinutesOfDay = normalizeModulo(utcTotalMinutes - timezoneOffsetMinutes, MINUTES_PER_DAY);
  const localHour = Math.floor(localMinutesOfDay / 60);
  const localMinute = localMinutesOfDay % 60;
  const dayShift = Math.floor((utcTotalMinutes - timezoneOffsetMinutes - localMinutesOfDay) / MINUTES_PER_DAY);

  return {
    cadence: utcFields.cadence,
    minuteLocal: localMinute,
    hourLocal: utcFields.cadence === "hourly" ? null : localHour,
    weekdayLocal:
      utcFields.cadence === "weekly" && utcFields.weekdayUtc !== null
        ? normalizeModulo(utcFields.weekdayUtc + dayShift, 7)
        : null,
  };
}

export function formatLocalTimestamp(timestamp: number, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(timestamp);
}

export function formatLocalScheduleDescription(
  schedule: ScheduleFields,
  timezoneOffsetMinutes: number,
  dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
) {
  const localFields = toLocalScheduleFields(schedule, timezoneOffsetMinutes);

  if (localFields.cadence === "hourly") {
    return `Every hour at :${localFields.minuteLocal.toString().padStart(2, "0")} local time`;
  }

  const localTime = `${(localFields.hourLocal ?? 0).toString().padStart(2, "0")}:${localFields.minuteLocal
    .toString()
    .padStart(2, "0")} local time`;

  if (localFields.cadence === "daily") {
    return `Every day at ${localTime}`;
  }

  return `${dayNames[localFields.weekdayLocal ?? 0]} at ${localTime}`;
}

export function createScheduledRunMessage(status: ScheduledRunStatus, message: string | null) {
  if (message) {
    return message;
  }

  if (status === "skipped") {
    return "Scheduled run skipped.";
  }

  return status === "completed" ? "Scheduled cleanup finished." : "Scheduled cleanup stopped.";
}

export function roundDownToMinute(timestamp: number) {
  return Math.floor(timestamp / MILLIS_PER_MINUTE) * MILLIS_PER_MINUTE;
}

export function addMinutes(timestamp: number, minutes: number) {
  return timestamp + minutes * MILLIS_PER_MINUTE;
}

export function addDays(timestamp: number, days: number) {
  return timestamp + days * MILLIS_PER_DAY;
}
