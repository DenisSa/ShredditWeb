import { vi } from "vitest";

vi.mock("@/lib/server/shreddit-system-status", () => ({
  getSystemStatus: vi.fn(),
}));

import { GET as getSystemStatusRoute } from "@/app/api/system/status/route";
import { getSystemStatus } from "@/lib/server/shreddit-system-status";

describe("system status route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a no-store system metrics payload", async () => {
    vi.mocked(getSystemStatus).mockResolvedValue({
      updatedAt: 1234,
      temperature: {
        celsius: 48.5,
        source: "vcgencmd",
      },
      cpu: {
        usagePercent: 22.4,
      },
      memory: {
        totalBytes: 1024,
        usedBytes: 512,
        availableBytes: 512,
        usagePercent: 50,
      },
      unavailableReason: null,
    });

    const response = await getSystemStatusRoute();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toMatchObject({
      temperature: {
        celsius: 48.5,
        source: "vcgencmd",
      },
      cpu: {
        usagePercent: 22.4,
      },
      memory: {
        usagePercent: 50,
      },
    });
  });
});
