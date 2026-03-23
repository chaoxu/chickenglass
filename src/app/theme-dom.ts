import type React from "react";

import type { Theme } from "./theme-manager";
import type { WritingTheme } from "./themes";
import { applyThemePreset, clearThemePreset, themePresets } from "../editor";

export type ResolvedTheme = "light" | "dark";

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "system") return theme;
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyResolvedThemeToDom(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", resolved);
}

export function applyWritingThemeVariables(
  writingTheme: WritingTheme,
  prevVariablesRef: React.RefObject<string[]>,
): void {
  const root = document.documentElement;

  for (const key of prevVariablesRef.current) {
    root.style.removeProperty(key);
  }

  const keys = Object.keys(writingTheme.variables) as Array<keyof typeof writingTheme.variables>;
  for (const key of keys) {
    const value = writingTheme.variables[key];
    if (value) {
      root.style.setProperty(key, value);
    }
  }
  prevVariablesRef.current = [...keys];
}

const CUSTOM_CSS_STYLE_ID = "cf-custom-css";

export function applyCustomCss(css: string): void {
  let styleEl = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
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

export function applyTypographyPreset(presetId?: string): void {
  const preset = themePresets[presetId ?? "academic"] ?? themePresets["academic"];
  applyThemePreset(preset);
}

export function clearTypographyPreset(): void {
  clearThemePreset();
}
