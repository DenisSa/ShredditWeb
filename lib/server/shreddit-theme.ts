import "server-only";

import { NextResponse } from "next/server";
import { ThemePreference } from "@/lib/shreddit-types";

export const THEME_COOKIE_NAME = "shreddit.theme";
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light";
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function setThemePreferenceCookie(response: NextResponse, theme: ThemePreference) {
  response.cookies.set({
    name: THEME_COOKIE_NAME,
    value: theme,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
