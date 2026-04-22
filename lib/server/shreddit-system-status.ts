import "server-only";

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import {
  type SystemCpu,
  type SystemMemory,
  type SystemStatus,
  type SystemTemperature,
} from "@/lib/shreddit-types";

const execFileAsync = promisify(execFile);
const CPU_SAMPLE_DELAY_MS = 125;

type CpuSample = {
  idle: number;
  total: number;
};

let vcgencmdSupported: boolean | null = null;

function getProcStatPath() {
  return process.env.SHREDDIT_SYSTEM_PROC_STAT_PATH?.trim() || "/proc/stat";
}

function getMeminfoPath() {
  return process.env.SHREDDIT_SYSTEM_MEMINFO_PATH?.trim() || "/proc/meminfo";
}

function getThermalZonePath() {
  return process.env.SHREDDIT_SYSTEM_THERMAL_ZONE_PATH?.trim() || "/sys/class/thermal/thermal_zone0/temp";
}

function getTemperatureCommand() {
  const configured = process.env.SHREDDIT_SYSTEM_TEMPERATURE_COMMAND?.trim();

  if (configured === "") {
    return null;
  }

  return configured || "vcgencmd";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function parseCpuSample(text: string): CpuSample {
  const line = text
    .split("\n")
    .find((entry) => entry.startsWith("cpu "));

  if (!line) {
    throw new Error("Missing aggregate cpu line.");
  }

  const values = line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map((value) => Number(value));

  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Invalid /proc/stat cpu line.");
  }

  const idle = values[3] + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    throw new Error("Invalid cpu totals.");
  }

  return { idle, total };
}

export function calculateCpuUsagePercent(previous: CpuSample, current: CpuSample) {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;

  if (totalDelta <= 0) {
    return null;
  }

  return clampPercent(((totalDelta - idleDelta) / totalDelta) * 100);
}

export function parseMemorySnapshot(text: string): SystemMemory {
  const values = new Map<string, number>();

  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);

    if (match) {
      values.set(match[1], Number(match[2]));
    }
  }

  const totalKiB = values.get("MemTotal") ?? null;
  const availableKiB = values.get("MemAvailable") ?? values.get("MemFree") ?? null;

  if (totalKiB === null || availableKiB === null || totalKiB <= 0 || availableKiB < 0) {
    throw new Error("Missing memory fields.");
  }

  const totalBytes = totalKiB * 1024;
  const availableBytes = availableKiB * 1024;
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const usagePercent = clampPercent((usedBytes / totalBytes) * 100);

  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usagePercent,
  };
}

export function parseVcgencmdTemperature(text: string) {
  const match = text.match(/temp=([0-9]+(?:\.[0-9]+)?)'C/i);

  if (!match) {
    throw new Error("Invalid vcgencmd output.");
  }

  return Number(match[1]);
}

export function parseThermalZoneTemperature(text: string) {
  const rawValue = Number(text.trim());

  if (!Number.isFinite(rawValue)) {
    throw new Error("Invalid thermal zone value.");
  }

  return rawValue / 1000;
}

async function readTextFile(path: string) {
  return readFile(path, "utf8");
}

async function readCpuUsage(): Promise<SystemCpu> {
  try {
    const firstSample = parseCpuSample(await readTextFile(getProcStatPath()));
    await sleep(CPU_SAMPLE_DELAY_MS);
    const secondSample = parseCpuSample(await readTextFile(getProcStatPath()));
    const usagePercent = calculateCpuUsagePercent(firstSample, secondSample);

    return { usagePercent };
  } catch {
    return { usagePercent: null };
  }
}

async function readMemoryUsage(): Promise<SystemMemory> {
  try {
    return parseMemorySnapshot(await readTextFile(getMeminfoPath()));
  } catch {
    return {
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      usagePercent: null,
    };
  }
}

async function readTemperatureViaCommand(command: string): Promise<SystemTemperature | null> {
  if (vcgencmdSupported === false) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(command, ["measure_temp"], {
      timeout: 1500,
      maxBuffer: 16 * 1024,
    });

    vcgencmdSupported = true;

    return {
      celsius: parseVcgencmdTemperature(stdout),
      source: "vcgencmd",
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      vcgencmdSupported = false;
    }

    return null;
  }
}

async function readTemperatureViaSysfs(): Promise<SystemTemperature> {
  try {
    return {
      celsius: parseThermalZoneTemperature(await readTextFile(getThermalZonePath())),
      source: "sysfs",
    };
  } catch {
    return {
      celsius: null,
      source: null,
    };
  }
}

async function readTemperature(): Promise<SystemTemperature> {
  const command = getTemperatureCommand();

  if (command) {
    const fromCommand = await readTemperatureViaCommand(command);

    if (fromCommand) {
      return fromCommand;
    }
  }

  return readTemperatureViaSysfs();
}

function summarizeUnavailableMetrics(status: Omit<SystemStatus, "updatedAt" | "unavailableReason">) {
  const unavailable = [];

  if (status.temperature.celsius === null) {
    unavailable.push("temperature");
  }

  if (status.cpu.usagePercent === null) {
    unavailable.push("cpu");
  }

  if (status.memory.usagePercent === null) {
    unavailable.push("memory");
  }

  if (unavailable.length === 0) {
    return null;
  }

  if (unavailable.length === 3) {
    return "Host system metrics are unavailable in this deployment.";
  }

  return `${unavailable.map((value) => value.toUpperCase()).join(", ")} unavailable right now.`;
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const [temperature, cpu, memory] = await Promise.all([
    readTemperature(),
    readCpuUsage(),
    readMemoryUsage(),
  ]);

  const baseStatus = {
    temperature,
    cpu,
    memory,
  };

  return {
    ...baseStatus,
    updatedAt: Date.now(),
    unavailableReason: summarizeUnavailableMetrics(baseStatus),
  };
}
