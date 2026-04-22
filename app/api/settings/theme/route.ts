import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/server/shreddit-responses";
import {
  upsertAccountThemePreference,
} from "@/lib/server/shreddit-db";
import {
  isThemePreference,
  setThemePreferenceCookie,
} from "@/lib/server/shreddit-theme";
import { getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return jsonNoStore(
      {
        error: "Sign in with Reddit before updating theme preferences.",
      },
      { status: 401 },
    );
  }

  const body = (await request.json()) as { theme?: string };

  if (!isThemePreference(body.theme)) {
    return jsonNoStore(
      {
        error: "Provide a valid theme preference.",
      },
      { status: 400 },
    );
  }

  const savedPreference = upsertAccountThemePreference(session.reddit.username, body.theme);
  const response = jsonNoStore({
    theme: savedPreference.theme,
  });
  setThemePreferenceCookie(response, savedPreference.theme);
  return response;
}
