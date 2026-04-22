"use client";

import { useEffect, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { saveThemePreference, ThemePreference, toUserMessage } from "@/lib/shreddit";

type ThemeToggleProps = {
  authenticated: boolean;
  preferredTheme: ThemePreference;
  onError: (message: string | null) => void;
  onSaved: (theme: ThemePreference) => void;
};

export function ThemeToggle({
  authenticated,
  preferredTheme,
  onError,
  onSaved,
}: ThemeToggleProps) {
  const { setTheme } = useTheme();
  const [pendingTheme, setPendingTheme] = useState<ThemePreference | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setPendingTheme(null);
    setTheme(authenticated ? preferredTheme : "dark");
  }, [authenticated, preferredTheme, setTheme]);

  if (!authenticated) {
    return null;
  }

  function handleThemeChange(nextTheme: ThemePreference) {
    if (isPending || nextTheme === preferredTheme) {
      return;
    }

    onError(null);
    setPendingTheme(nextTheme);
    setTheme(nextTheme);

    startTransition(() => {
      void saveThemePreference(nextTheme)
        .then((response) => {
          setPendingTheme(null);
          setTheme(response.theme);
          onSaved(response.theme);
        })
        .catch((error) => {
          setPendingTheme(null);
          setTheme(preferredTheme);
          onError(toUserMessage(error));
        });
    });
  }

  const activeTheme = pendingTheme ?? preferredTheme;

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[color:var(--page-border)] bg-[color:var(--page-surface)] p-1 shadow-[0_10px_30px_var(--page-shadow-soft)]">
      {(["dark", "light"] as const).map((option) => {
        const isActive = option === activeTheme;

        return (
          <button
            aria-pressed={isActive}
            className={`rounded-full px-3 py-2 text-sm font-semibold transition ${
              isActive
                ? "bg-[color:var(--page-control-strong)] text-[color:var(--page-control-strong-text)]"
                : "text-[color:var(--page-muted-strong)] hover:bg-[color:var(--page-surface-strong)]"
            }`}
            disabled={isPending}
            key={option}
            onClick={() => handleThemeChange(option)}
            type="button"
          >
            {option === "dark" ? "Dark" : "Light"}
          </button>
        );
      })}
    </div>
  );
}
