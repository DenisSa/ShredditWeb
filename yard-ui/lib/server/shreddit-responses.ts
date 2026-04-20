import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  RedditAuthError,
  RedditConnectivityError,
  RedditRequestError,
  RunConflictError,
  toUserMessage,
} from "@/lib/server/shreddit-core";

export function jsonNoStore(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

function getErrorStatus(error: unknown) {
  if (error instanceof RedditAuthError) {
    return 401;
  }

  if (error instanceof RedditConnectivityError) {
    return 503;
  }

  if (error instanceof RedditRequestError) {
    return error.status;
  }

  if (error instanceof RunConflictError) {
    return 409;
  }

  return 500;
}

export function jsonError(error: unknown) {
  return jsonNoStore(
    {
      error: toUserMessage(error),
    },
    {
      status: getErrorStatus(error),
    },
  );
}

export function redirectHomeWithAuthError(request: NextRequest, message: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("authError", message);
  return NextResponse.redirect(url);
}
