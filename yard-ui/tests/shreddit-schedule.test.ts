import {
  advanceSchedule,
  computeNextRunAt,
  toLocalScheduleFields,
  toUtcScheduleFields,
  validateScheduleFields,
} from "@/lib/shreddit-schedule";

describe("shreddit-schedule helpers", () => {
  it("validates cadence-specific UTC fields", () => {
    expect(validateScheduleFields({
      cadence: "hourly",
      minuteUtc: 20,
      hourUtc: null,
      weekdayUtc: null,
    }).valid).toBe(true);

    expect(validateScheduleFields({
      cadence: "daily",
      minuteUtc: 20,
      hourUtc: null,
      weekdayUtc: null,
    }).valid).toBe(false);

    expect(validateScheduleFields({
      cadence: "weekly",
      minuteUtc: 20,
      hourUtc: 8,
      weekdayUtc: null,
    }).valid).toBe(false);
  });

  it("computes the next hourly, daily, and weekly run in UTC", () => {
    expect(
      computeNextRunAt(
        {
          cadence: "hourly",
          minuteUtc: 15,
          hourUtc: null,
          weekdayUtc: null,
        },
        Date.parse("2026-04-19T10:20:00Z"),
      ),
    ).toBe(Date.parse("2026-04-19T11:15:00Z"));

    expect(
      computeNextRunAt(
        {
          cadence: "daily",
          minuteUtc: 30,
          hourUtc: 9,
          weekdayUtc: null,
        },
        Date.parse("2026-04-19T08:00:00Z"),
      ),
    ).toBe(Date.parse("2026-04-19T09:30:00Z"));

    expect(
      computeNextRunAt(
        {
          cadence: "weekly",
          minuteUtc: 0,
          hourUtc: 12,
          weekdayUtc: 0,
        },
        Date.parse("2026-04-19T13:00:00Z"),
      ),
    ).toBe(Date.parse("2026-04-26T12:00:00Z"));
  });

  it("advances future runs after success, failure, skip, and catch-up execution", () => {
    const dailySchedule = {
      cadence: "daily" as const,
      minuteUtc: 5,
      hourUtc: 6,
      weekdayUtc: null,
    };

    expect(advanceSchedule(dailySchedule, Date.parse("2026-04-19T06:05:00Z"))).toBe(
      Date.parse("2026-04-20T06:05:00Z"),
    );
    expect(advanceSchedule(dailySchedule, Date.parse("2026-04-19T12:30:00Z"))).toBe(
      Date.parse("2026-04-20T06:05:00Z"),
    );
  });

  it("converts local browser-time inputs to UTC storage fields and back", () => {
    const stored = toUtcScheduleFields(
      {
        cadence: "daily",
        hourLocal: 9,
        minuteLocal: 30,
        weekdayLocal: null,
      },
      420,
    );

    expect(stored).toEqual({
      cadence: "daily",
      hourUtc: 16,
      minuteUtc: 30,
      weekdayUtc: null,
    });

    expect(toLocalScheduleFields(stored, 420)).toEqual({
      cadence: "daily",
      hourLocal: 9,
      minuteLocal: 30,
      weekdayLocal: null,
    });
  });

  it("keeps weekly day conversions correct across timezone offsets", () => {
    const stored = toUtcScheduleFields(
      {
        cadence: "weekly",
        hourLocal: 0,
        minuteLocal: 30,
        weekdayLocal: 1,
      },
      -600,
    );

    expect(stored).toEqual({
      cadence: "weekly",
      hourUtc: 14,
      minuteUtc: 30,
      weekdayUtc: 0,
    });

    expect(toLocalScheduleFields(stored, -600)).toEqual({
      cadence: "weekly",
      hourLocal: 0,
      minuteLocal: 30,
      weekdayLocal: 1,
    });
  });
});
