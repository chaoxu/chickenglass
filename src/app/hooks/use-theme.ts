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
import { getThemeById, type WritingTheme } from "../themes";
import { themePresets, applyThemePreset, clearThemePreset } from "../../editor/theme-config";

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

/** Apply or clear CSS variable overrides from a WritingTheme on <html>. */
function applyThemeVariables(
  writingTheme: WritingTheme,
  prevVariablesRef: React.RefObject<string[]>,
): void {
  const root = document.documentElement;

  // Clear previous overrides
  for (const key of prevVariablesRef.current) {
    root.style.removeProperty(key);
  }

  // Apply new overrides
  const keys = Object.keys(writingTheme.variables);
  for (const key of keys) {
    root.style.setProperty(key, writingTheme.variables[key]);
  }
  prevVariablesRef.current = keys;
}

/** ID for the injected custom CSS style element. */
const CUSTOM_CSS_STYLE_ID = "cf-custom-css";

/** Inject or update user custom CSS in a managed <style> tag. */
function applyCustomCss(css: string): void {
  let styleEl = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    // Remove the style element if CSS is empty
    if (styleEl) styleEl.remove();
    return;
  }
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = CUSTOM_CSS_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

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

  // Apply writing theme CSS variable overrides whenever themeName changes.
  useEffect(() => {
    const wt = getThemeById(themeName ?? "default");
    applyThemeVariables(wt, prevVariablesRef);

    // If the writing theme declares itself as dark/light, override the
    // light/dark toggle for non-default themes.
    if (wt.id !== "default") {
      const resolved: ResolvedTheme = wt.dark ? "dark" : "light";
      setResolvedTheme(resolved);
      applyTheme(resolved);
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
    const presetId = writingTheme ?? "academic";
    const preset = themePresets[presetId] ?? themePresets["academic"];
    applyThemePreset(preset);
    return () => { clearThemePreset(); };
  }, [writingTheme]);

  // Inject user custom CSS whenever it changes.
  useEffect(() => {
    applyCustomCss(customCss ?? "");
    return () => { applyCustomCss(""); };
  }, [customCss]);

  return { theme, setTheme: onThemeChange, resolvedTheme };
}
