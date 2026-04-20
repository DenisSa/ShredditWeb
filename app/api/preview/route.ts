import { NextRequest } from "next/server";
import {
  buildPreview,
  createSessionRedditContext,
  getDefaultCleanupSettings,
} from "@/lib/server/shreddit-core";
import { ensureAccountSettings } from "@/lib/server/shreddit-db";
import { jsonError, jsonNoStore } from "@/lib/server/shreddit-responses";
import { getSessionFromRequest, updateSession } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

type PreviewRequest = {
  rules?: {
    minAgeDays?: number;
    maxScore?: number;
  };
};

async function readPreviewRequest(request: NextRequest) {
  const raw = await request.text();

  if (!raw.trim()) {
    return {} as PreviewRequest;
  }

  return JSON.parse(raw) as PreviewRequest;
}

export async function POST(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session?.reddit) {
    return jsonNoStore(
      {
        error: "Sign in with Reddit before running a preview.",
      },
      { status: 401 },
    );
  }

  try {
    const body = await readPreviewRequest(request);
    const savedSettings = ensureAccountSettings(session.reddit.username, getDefaultCleanupSettings());
    const minAgeDays = body.rules?.minAgeDays ?? savedSettings.minAgeDays;
    const maxScore = body.rules?.maxScore ?? savedSettings.maxScore;

    if (!Number.isFinite(minAgeDays) || minAgeDays <= 0 || !Number.isFinite(maxScore) || maxScore <= 0) {
      return jsonNoStore(
        {
          error: "Provide positive numeric minAgeDays and maxScore values when overriding preview rules.",
        },
        { status: 400 },
      );
    }

    const preview = await buildPreview(
      createSessionRedditContext(session),
      {
        ...savedSettings,
        minAgeDays,
        maxScore,
      },
    );
    updateSession(session, { preview });
    return jsonNoStore(preview);
  } catch (error) {
    return jsonError(error);
  }
}
