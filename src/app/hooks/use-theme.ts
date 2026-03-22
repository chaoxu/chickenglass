/**
 * useTheme — React hook for Light / Dark / System theme management,
 * writing theme (CSS variable overrides), and user custom CSS.
 *
 * Theme state is owned by useSettings (persisted in the unified "cf-settings"
 * localStorage key). This hook is purely a side-effect applier: it reads the
 * theme value passed in from settings and applies DOM changes (data-theme
 * attribute, CSS variables, custom CSS injection).
 *
 * - Sets `data-theme` on `<html>` so CSS custom properties pick it up.
 * - System mode follows `prefers-color-scheme` via matchMedia listener.
 * - Applies writing theme CSS variable overrides on `document.documentElement`.
 * - Injects user custom CSS via a managed `<style>` element.
 * - Guards matchMedia and localStorage access for test environments.
 */

import { useState, useEffect, useRef } from "react";
import type { Theme } from "../theme-manager";
import { getThemeById } from "../themes";
import {
  applyCustomCss,
  applyResolvedThemeToDom,
  applyTypographyPreset,
  applyWritingThemeVariables,
  clearTypographyPreset,
  resolveTheme,
  type ResolvedTheme,
} from "../theme-dom";

// Re-export Theme so consumers only need one import.
export type { Theme } from "../theme-manager";
export type { ResolvedTheme } from "../theme-dom";

export interface UseThemeReturn {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: ResolvedTheme;
}

/**
 * Apply theme side effects based on settings state.
 *
 * @param theme - Light/dark/system preference from settings
 * @param onThemeChange - Callback to persist theme changes (delegates to updateSetting)
 * @param themeName - Writing theme ID for CSS variable overrides
 * @param customCss - User custom CSS to inject
 * @param writingTheme - Writing preset ID for typography
 */
export function useTheme(
  theme: Theme,
  onThemeChange: (next: Theme) => void,
  themeName?: string,
  customCss?: string,
  writingTheme?: string,
): UseThemeReturn {
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(
    () => resolveTheme(theme),
  );

  // Track previously applied CSS variable keys so we can clear them.
  const prevVariablesRef = useRef<string[]>([]);

  // Apply resolved theme to <html> and sync state whenever theme changes.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyResolvedThemeToDom(resolved);

    if (theme !== "system" || typeof window.matchMedia !== "function") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent): void => {
      const next: ResolvedTheme = e.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyResolvedThemeToDom(next);
    };

    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, [theme]);

  // Apply writing theme CSS variable overrides whenever themeName changes.
  useEffect(() => {
    const wt = getThemeById(themeName ?? "default");
    applyWritingThemeVariables(wt, prevVariablesRef);

    // If the writing theme declares itself as dark/light, override the
    // light/dark toggle for non-default themes.
    if (wt.id !== "default") {
      const resolved: ResolvedTheme = wt.dark ? "dark" : "light";
      setResolvedTheme(resolved);
      applyResolvedThemeToDom(resolved);
    }

    // Cleanup: remove overrides when unmounting or switching themes
    return () => {
      const root = document.documentElement;
      for (const key of prevVariablesRef.current) {
        root.style.removeProperty(key);
      }
      prevVariablesRef.current = [];
    };
  }, [themeName]);

  // Apply writing theme preset (typography: fonts, heading sizes) whenever it changes.
  useEffect(() => {
    applyTypographyPreset(writingTheme);
    return () => { clearTypographyPreset(); };
  }, [writingTheme]);

  // Inject user custom CSS whenever it changes.
  useEffect(() => {
    applyCustomCss(customCss ?? "");
    return () => { applyCustomCss(""); };
  }, [customCss]);

  return { theme, setTheme: onThemeChange, resolvedTheme };
}
