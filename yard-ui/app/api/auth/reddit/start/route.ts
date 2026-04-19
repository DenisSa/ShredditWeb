import { NextRequest, NextResponse } from "next/server";
import {
  buildOauthAuthorizeUrl,
  createOauthState,
  getPublicSessionDefaults,
} from "@/lib/server/shreddit-core";
import { redirectHomeWithAuthError } from "@/lib/server/shreddit-responses";
import {
  getOrCreateSession,
  setSessionCookie,
} from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const defaults = getPublicSessionDefaults();

  if (!defaults.authConfigured) {
    return redirectHomeWithAuthError(
      request,
      defaults.configurationError ?? "Server auth configuration is incomplete.",
    );
  }

  try {
    const { session } = getOrCreateSession(request);
    session.oauthState = createOauthState();
    session.preview = null;

    const response = NextResponse.redirect(buildOauthAuthorizeUrl(session.oauthState));
    setSessionCookie(response, session.id);
    return response;
  } catch (error) {
    return redirectHomeWithAuthError(
      request,
      error instanceof Error ? error.message : "Unable to start Reddit sign-in.",
    );
  }
}
