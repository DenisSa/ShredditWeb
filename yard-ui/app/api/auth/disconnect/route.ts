import { NextRequest, NextResponse } from "next/server";
import {
  clearPersistedAccountGrant,
  disableAccountSchedule,
} from "@/lib/server/shreddit-db";
import {
  clearSessionCookie,
  destroySession,
  getSessionFromRequest,
} from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return NextResponse.json(
      {
        error: "Sign in with Reddit before disconnecting the current account.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  clearPersistedAccountGrant(session.reddit.username, true);
  disableAccountSchedule(session.reddit.username, "Reconnect Reddit to resume scheduled cleanup.");
  destroySession(session.id);

  const response = new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });

  clearSessionCookie(response);
  return response;
}
