import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/server/shreddit-responses";
import { buildSessionSummary } from "@/lib/server/shreddit-session-summary";
import { getSessionFromRequest } from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  return jsonNoStore(buildSessionSummary(session));
}
