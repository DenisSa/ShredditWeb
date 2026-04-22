import { jsonError, jsonNoStore } from "@/lib/server/shreddit-responses";
import { getSystemStatus } from "@/lib/server/shreddit-system-status";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonNoStore(await getSystemStatus());
  } catch (error) {
    return jsonError(error);
  }
}
