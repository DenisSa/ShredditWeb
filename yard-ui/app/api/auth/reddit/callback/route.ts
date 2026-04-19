import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  toUserMessage,
} from "@/lib/server/shreddit-core";
import { redirectHomeWithAuthError } from "@/lib/server/shreddit-responses";
import {
  getSessionFromRequest,
  setSessionCookie,
} from "@/lib/server/shreddit-store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);

  if (!session) {
    return redirectHomeWithAuthError(
      request,
      "The Reddit login session was lost before the callback completed. Try signing in again.",
    );
  }

  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    session.oauthState = null;
    return redirectHomeWithAuthError(
      request,
      error === "access_denied"
        ? "Reddit sign-in was canceled before access was granted."
        : `Reddit returned an OAuth error: ${error}.`,
    );
  }

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");

  if (!state || !code) {
    session.oauthState = null;
    return redirectHomeWithAuthError(
      request,
      "Reddit did not return a valid authorization code response.",
    );
  }

  if (!session.oauthState || session.oauthState !== state) {
    session.oauthState = null;
    return redirectHomeWithAuthError(
      request,
      "The Reddit auth response did not match the stored state value. Try signing in again.",
    );
  }

  try {
    const redditGrant = await exchangeAuthorizationCode(code);
    session.oauthState = null;
    session.reddit = redditGrant;
    session.preview = null;

    const response = NextResponse.redirect(new URL("/", request.url));
    setSessionCookie(response, session.id);
    return response;
  } catch (callbackError) {
    session.oauthState = null;
    session.reddit = null;
    session.preview = null;
    return redirectHomeWithAuthError(request, toUserMessage(callbackError));
  }
}
