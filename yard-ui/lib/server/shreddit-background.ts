import "server-only";

import { startSchedulerLoop } from "@/lib/server/shreddit-scheduler";
import { startStoreMaintenance } from "@/lib/server/shreddit-store";

type GlobalWithBackgroundFlag = typeof globalThis & {
  __shredditBackgroundStarted?: boolean;
};

export function startBackgroundLoops() {
  const globalWithBackgroundFlag = globalThis as GlobalWithBackgroundFlag;

  if (globalWithBackgroundFlag.__shredditBackgroundStarted) {
    return;
  }

  globalWithBackgroundFlag.__shredditBackgroundStarted = true;
  startStoreMaintenance();
  startSchedulerLoop();
}
