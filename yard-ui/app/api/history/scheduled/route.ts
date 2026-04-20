import { NextRequest } from "next/server";
import { listScheduledRunsForUsername } from "@/lib/server/shreddit-db";
import { jsonNoStore } from "@/lib/server/shreddit-responses";
import { getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

function parseLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }

  return Math.min(100, Math.floor(parsed));
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return jsonNoStore(
      {
        error: "Sign in with Reddit before reading scheduled history.",
      },
      { status: 401 },
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  return jsonNoStore({
    items: listScheduledRunsForUsername(session.reddit.username, limit),
  });
}
