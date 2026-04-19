import { NextRequest } from "next/server";
import { buildPreview } from "@/lib/server/shreddit-core";
import { jsonError, jsonNoStore } from "@/lib/server/shreddit-responses";
import { getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

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
    const preview = await buildPreview(session);
    session.preview = preview;
    return jsonNoStore(preview);
  } catch (error) {
    return jsonError(error);
  }
}
