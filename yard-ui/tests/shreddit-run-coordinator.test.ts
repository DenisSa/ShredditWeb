import {
  getActiveAccountRunSource,
  releaseAccountRun,
  resetRunCoordinatorForTests,
  tryAcquireAccountRun,
} from "@/lib/server/shreddit-run-coordinator";

describe("shreddit-run-coordinator", () => {
  beforeEach(() => {
    resetRunCoordinatorForTests();
  });

  it("blocks manual runs when the same account already has a manual run", () => {
    expect(tryAcquireAccountRun("alice", "manual").acquired).toBe(true);
    expect(tryAcquireAccountRun("alice", "manual")).toEqual({
      acquired: false,
      activeSource: "manual",
    });
  });

  it("blocks scheduled runs when a manual run is active", () => {
    tryAcquireAccountRun("alice", "manual");

    expect(tryAcquireAccountRun("alice", "scheduled")).toEqual({
      acquired: false,
      activeSource: "manual",
    });
  });

  it("blocks manual runs when a scheduled run is active", () => {
    tryAcquireAccountRun("alice", "scheduled");

    expect(tryAcquireAccountRun("alice", "manual")).toEqual({
      acquired: false,
      activeSource: "scheduled",
    });
  });

  it("releases locks after completion or failure", () => {
    tryAcquireAccountRun("alice", "manual");
    expect(getActiveAccountRunSource("alice")).toBe("manual");
    releaseAccountRun("alice");
    expect(getActiveAccountRunSource("alice")).toBeNull();
    expect(tryAcquireAccountRun("alice", "scheduled").acquired).toBe(true);
  });
});
