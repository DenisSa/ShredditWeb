import { NextRequest } from "next/server";
import { setStoreDeletionHistoryPreference } from "@/lib/server/shreddit-db";
import { getDefaultCleanupSettings } from "@/lib/server/shreddit-core";
import { jsonError, jsonNoStore } from "@/lib/server/shreddit-responses";
import { getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

type HistorySettingsRequest = {
  storeDeletionHistory?: boolean;
};

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return jsonNoStore(
      {
        error: "Sign in with Reddit before updating account history settings.",
      },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as HistorySettingsRequest;

    if (typeof body.storeDeletionHistory !== "boolean") {
      return jsonNoStore(
        {
          error: "Provide storeDeletionHistory as a boolean value.",
        },
        { status: 400 },
      );
    }

    const preference = setStoreDeletionHistoryPreference(
      session.reddit.username,
      body.storeDeletionHistory,
      getDefaultCleanupSettings(),
    );

    return jsonNoStore({
      storeDeletionHistory: preference.storeDeletionHistory,
    });
  } catch (error) {
    return jsonError(error);
  }
}
