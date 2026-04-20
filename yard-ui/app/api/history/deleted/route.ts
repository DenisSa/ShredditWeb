import { NextRequest } from "next/server";
import { listDeletedItemsForSession } from "@/lib/server/shreddit-db";
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

  if (!session) {
    return jsonNoStore(
      {
        error: "Sign in first or reuse an existing session to read deleted item history.",
      },
      { status: 401 },
    );
  }

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  return jsonNoStore({
    items: listDeletedItemsForSession(session.id, limit),
  });
}
