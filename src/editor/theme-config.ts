import {
  defaultCodeFontStack,
  defaultContentFontStack,
  defaultUIFontStack,
} from "./editor-constants";
import { themeTypographyTokens } from "../theme-contract";

/**
 * Theme presets: typed typography configurations for the editor and app chrome.
 *
 * Each preset declares UI/content/code fonts, heading sizes/weights/styles,
 * line-height, and content width. These values are applied as CSS custom
 * properties on `document.documentElement` so app chrome, CM6, Read mode,
 * and export helpers can all reference them via `var(--cf-*)`.
 */

export interface HeadingStyle {
  size: string;
  weight: string;
  style: string;
}

export interface ThemePreset {
  name: string;
  uiFont: string;
  contentFont: string;
  codeFont: string;
  baseFontSize: string;
  lineHeight: string;
  contentMaxWidth: string;
  h1: HeadingStyle;
  h2: HeadingStyle;
  h3: HeadingStyle;
  h4: HeadingStyle;
  h5: HeadingStyle;
  h6: HeadingStyle;
}

/**
 * Academic — current default: KaTeX_Main serif, subtle headings (H2 italic),
 * Oxford Lecture Series style.
 */
const academic: ThemePreset = {
  name: "Academic",
  uiFont: defaultUIFontStack,
  contentFont: defaultContentFontStack,
  codeFont: defaultCodeFontStack,
  baseFontSize: "16px",
  lineHeight: "1.5",
  contentMaxWidth: "800px",
  h1: { size: "1.15em", weight: "700", style: "normal" },
  h2: { size: "1.15em", weight: "400", style: "italic" },
  h3: { size: "1.1em", weight: "600", style: "italic" },
  h4: { size: "1.05em", weight: "600", style: "normal" },
  h5: { size: "1em", weight: "600", style: "normal" },
  h6: { size: "0.95em", weight: "600", style: "normal" },
};

/**
 * Monospace — IBM Plex Mono for everything, larger headings,
 * wider line-height for readability.
 */
const monospace: ThemePreset = {
  name: "Monospace",
  uiFont: "'IBM Plex Mono', 'Fira Code', monospace",
  contentFont: "'IBM Plex Mono', 'Fira Code', monospace",
  codeFont: defaultCodeFontStack,
  baseFontSize: "15px",
  lineHeight: "1.6",
  contentMaxWidth: "800px",
  h1: { size: "1.4em", weight: "700", style: "normal" },
  h2: { size: "1.25em", weight: "700", style: "normal" },
  h3: { size: "1.15em", weight: "600", style: "normal" },
  h4: { size: "1.05em", weight: "600", style: "normal" },
  h5: { size: "1em", weight: "600", style: "normal" },
  h6: { size: "0.95em", weight: "600", style: "normal" },
};

/**
 * Modern — system-ui sans-serif, clean bold headings, balanced spacing.
 */
const modern: ThemePreset = {
  name: "Modern",
  uiFont: defaultUIFontStack,
  contentFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  codeFont: defaultCodeFontStack,
  baseFontSize: "16px",
  lineHeight: "1.5",
  contentMaxWidth: "800px",
  h1: { size: "1.5em", weight: "700", style: "normal" },
  h2: { size: "1.3em", weight: "600", style: "normal" },
  h3: { size: "1.15em", weight: "600", style: "normal" },
  h4: { size: "1.05em", weight: "600", style: "normal" },
  h5: { size: "1em", weight: "600", style: "normal" },
  h6: { size: "0.95em", weight: "500", style: "normal" },
};

/** All available presets keyed by identifier. */
export const themePresets: Record<string, ThemePreset> = {
  academic,
  monospace,
  modern,
};

/** Ordered list of preset keys for UI display (derived from themePresets). */
export const themePresetKeys: string[] = Object.keys(themePresets);

/** All CSS custom property names set by applyThemePreset. */
const PRESET_PROPERTIES = [...themeTypographyTokens];

/**
 * Apply a theme preset by setting CSS custom properties on `document.documentElement`.
 * Both the CM6 editor theme and Read mode CSS reference these variables.
 */
export function applyThemePreset(preset: ThemePreset): void {
  const root = document.documentElement;
  root.style.setProperty("--cf-ui-font", preset.uiFont);
  root.style.setProperty("--cf-content-font", preset.contentFont);
  root.style.setProperty("--cf-code-font", preset.codeFont);
  root.style.setProperty("--cf-base-font-size", preset.baseFontSize);
  root.style.setProperty("--cf-line-height", preset.lineHeight);
  root.style.setProperty("--cf-content-max-width", preset.contentMaxWidth);

  const levels = [preset.h1, preset.h2, preset.h3, preset.h4, preset.h5, preset.h6];
  for (let i = 0; i < levels.length; i++) {
    const n = i + 1;
    root.style.setProperty(`--cf-h${n}-size`, levels[i].size);
    root.style.setProperty(`--cf-h${n}-weight`, levels[i].weight);
    root.style.setProperty(`--cf-h${n}-style`, levels[i].style);
  }
}

/** Remove all CSS custom properties set by applyThemePreset. */
export function clearThemePreset(): void {
  const root = document.documentElement;
  for (const prop of PRESET_PROPERTIES) {
    root.style.removeProperty(prop);
  }
}
