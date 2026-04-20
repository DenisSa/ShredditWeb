import { NextRequest } from "next/server";
import { listDeletedItemsForUsername } from "@/lib/server/shreddit-db";
import { jsonNoStore } from "@/lib/server/shreddit-responses";
import { getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

function parseLimit(value: string | null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 100;
  }

  return Math.min(500, Math.floor(parsed));
}

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return jsonNoStore(
      {
        error: "Sign in with Reddit before reading deleted item history.",
      },
      { status: 401 },
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  return jsonNoStore({
    items: listDeletedItemsForUsername(session.reddit.username, limit),
  });
}
