import { cookies } from "next/headers";
import { ShredditApp } from "@/components/shreddit-app";
import { buildSessionSummary } from "@/lib/server/shreddit-session-summary";
import { getSystemStatus } from "@/lib/server/shreddit-system-status";
import { getSessionFromCookieValue, SESSION_COOKIE_NAME } from "@/lib/server/shreddit-store";

export default async function Home() {
  const cookieStore = await cookies();
  const session = getSessionFromCookieValue(cookieStore.get(SESSION_COOKIE_NAME)?.value);

  return (
    <ShredditApp
      initialSessionSummary={buildSessionSummary(session)}
      initialSystemStatus={await getSystemStatus()}
    />
  );
}
