import { cookies } from "next/headers";
import { ShredditSettings } from "@/components/shreddit-settings";
import {
  buildSessionSummary,
  listRecentScheduledRunsForSession,
} from "@/lib/server/shreddit-session-summary";
import { getSessionFromCookieValue, SESSION_COOKIE_NAME } from "@/lib/server/shreddit-store";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const session = getSessionFromCookieValue(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <ShredditSettings
      initialScheduledHistory={listRecentScheduledRunsForSession(session, 8)}
      initialSessionSummary={buildSessionSummary(session)}
    />
  );
}
