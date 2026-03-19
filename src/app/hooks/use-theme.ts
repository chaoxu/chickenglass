/**
 * useTheme — React hook for Light / Dark / System theme management.
 *
 * - Sets `data-theme` on `<html>` so CSS custom properties pick it up.
 * - System mode follows `prefers-color-scheme` via matchMedia listener.
 * - Persists choice in localStorage under key "cg-theme".
 * - Guards matchMedia and localStorage access for test environments.
 */

import { useState, useEffect, useCallback } from "react";
import { loadTheme, saveTheme, type Theme } from "../theme-manager";

// Re-export Theme so consumers only need one import.
export type { Theme } from "../theme-manager";
export type ResolvedTheme = "light" | "dark";

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved);
}

export interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme;
}

export function useTheme(): UseThemeReturn {
  // Single lazy initializer: read localStorage once and derive both states.
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    () => resolveTheme(loadTheme()),
  );

  // Apply resolved theme to <html> and sync state whenever theme changes.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);

    if (theme !== "system" || typeof window.matchMedia !== "function") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent): void => {
      const next: ResolvedTheme = e.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyTheme(next);
    };

    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    saveTheme(next);
    setThemeState(next);
  }, []);

  return { theme, setTheme, resolvedTheme };
}
