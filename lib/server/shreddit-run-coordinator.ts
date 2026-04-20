import "server-only";

export type AccountRunSource = "manual" | "scheduled";

type ActiveRunMap = Map<string, AccountRunSource>;

type GlobalWithCoordinator = typeof globalThis & {
  __shredditActiveRuns?: ActiveRunMap;
};

function getActiveRuns() {
  const globalWithCoordinator = globalThis as GlobalWithCoordinator;

  if (!globalWithCoordinator.__shredditActiveRuns) {
    globalWithCoordinator.__shredditActiveRuns = new Map<string, AccountRunSource>();
  }

  return globalWithCoordinator.__shredditActiveRuns;
}

export function tryAcquireAccountRun(username: string, source: AccountRunSource) {
  const activeRuns = getActiveRuns();

  if (activeRuns.has(username)) {
    return {
      acquired: false,
      activeSource: activeRuns.get(username) ?? null,
    } as const;
  }

  activeRuns.set(username, source);

  return {
    acquired: true,
    activeSource: source,
  } as const;
}

export function releaseAccountRun(username: string) {
  getActiveRuns().delete(username);
}

export function getActiveAccountRunSource(username: string) {
  return getActiveRuns().get(username) ?? null;
}

export function resetRunCoordinatorForTests() {
  getActiveRuns().clear();
}
