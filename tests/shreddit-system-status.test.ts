import {
  calculateCpuUsagePercent,
  parseCpuSample,
  parseMemorySnapshot,
  parseThermalZoneTemperature,
  parseVcgencmdTemperature,
} from "@/lib/server/shreddit-system-status";

describe("shreddit system status helpers", () => {
  it("parses aggregate cpu totals from /proc/stat", () => {
    expect(
      parseCpuSample("cpu  10 5 15 70 5 0 0 0 0 0\ncpu0 5 2 7 35 2 0 0 0 0 0\n"),
    ).toEqual({
      idle: 75,
      total: 105,
    });
  });

  it("calculates cpu usage from two samples", () => {
    expect(
      calculateCpuUsagePercent(
        { idle: 700, total: 1000 },
        { idle: 760, total: 1150 },
      ),
    ).toBeCloseTo(60, 5);
  });

  it("parses memory totals and usage", () => {
    const snapshot = parseMemorySnapshot([
      "MemTotal:         947244 kB",
      "MemFree:          120000 kB",
      "MemAvailable:     310000 kB",
      "",
    ].join("\n"));

    expect(snapshot.totalBytes).toBe(947244 * 1024);
    expect(snapshot.availableBytes).toBe(310000 * 1024);
    expect(snapshot.usedBytes).toBe((947244 - 310000) * 1024);
    expect(snapshot.usagePercent).toBeCloseTo(((947244 - 310000) / 947244) * 100, 5);
  });

  it("parses vcgencmd temperature output", () => {
    expect(parseVcgencmdTemperature("temp=48.6'C\n")).toBe(48.6);
  });

  it("parses thermal zone temperature output", () => {
    expect(parseThermalZoneTemperature("41234\n")).toBe(41.234);
  });

  it("accepts zero memory as a valid available value", () => {
    const snapshot = parseMemorySnapshot([
      "MemTotal:         1024 kB",
      "MemAvailable:     0 kB",
      "",
    ].join("\n"));

    expect(snapshot.usedBytes).toBe(1024 * 1024);
    expect(snapshot.usagePercent).toBe(100);
  });
});
