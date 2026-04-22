import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, destroySession, getSessionFromRequest } from "@/lib/server/shreddit-store";
import { DEFAULT_THEME_PREFERENCE, setThemePreferenceCookie } from "@/lib/server/shreddit-theme";

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
  setThemePreferenceCookie(response, DEFAULT_THEME_PREFERENCE);
  return response;
}
