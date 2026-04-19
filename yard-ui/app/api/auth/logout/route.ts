import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, destroySession, getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (session) {
    destroySession(session.id);
  }

  const response = new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });

  clearSessionCookie(response);
  return response;
}
