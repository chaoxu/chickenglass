/**
 * Theme presets: typed typography configurations for the editor.
 *
 * Each preset declares fonts, heading sizes/weights/styles, line-height,
 * and content width. These values are applied as CSS custom properties on
 * `document.documentElement` so both the CM6 editor theme and Read mode
 * CSS reference them via `var(--cg-*)`.
 */

export interface HeadingStyle {
  size: string;
  weight: string;
  style: string;
}

export interface ThemePreset {
  name: string;
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
  contentFont: "KaTeX_Main, 'Times New Roman', serif",
  codeFont: "'IBM Plex Mono', 'Fira Code', monospace",
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
  contentFont: "'IBM Plex Mono', 'Fira Code', monospace",
  codeFont: "'IBM Plex Mono', 'Fira Code', monospace",
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
  contentFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  codeFont: "'IBM Plex Mono', 'Fira Code', monospace",
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
const PRESET_PROPERTIES = [
  "--cg-content-font",
  "--cg-code-font",
  "--cg-base-font-size",
  "--cg-line-height",
  "--cg-content-max-width",
  ...Array.from({ length: 6 }, (_, i) => {
    const n = i + 1;
    return [`--cg-h${n}-size`, `--cg-h${n}-weight`, `--cg-h${n}-style`];
  }).flat(),
];

/**
 * Apply a theme preset by setting CSS custom properties on `document.documentElement`.
 * Both the CM6 editor theme and Read mode CSS reference these variables.
 */
export function applyThemePreset(preset: ThemePreset): void {
  const root = document.documentElement;
  root.style.setProperty("--cg-content-font", preset.contentFont);
  root.style.setProperty("--cg-code-font", preset.codeFont);
  root.style.setProperty("--cg-base-font-size", preset.baseFontSize);
  root.style.setProperty("--cg-line-height", preset.lineHeight);
  root.style.setProperty("--cg-content-max-width", preset.contentMaxWidth);

  const levels = [preset.h1, preset.h2, preset.h3, preset.h4, preset.h5, preset.h6];
  for (let i = 0; i < levels.length; i++) {
    const n = i + 1;
    root.style.setProperty(`--cg-h${n}-size`, levels[i].size);
    root.style.setProperty(`--cg-h${n}-weight`, levels[i].weight);
    root.style.setProperty(`--cg-h${n}-style`, levels[i].style);
  }
}

/** Remove all CSS custom properties set by applyThemePreset. */
export function clearThemePreset(): void {
  const root = document.documentElement;
  for (const prop of PRESET_PROPERTIES) {
    root.style.removeProperty(prop);
  }
}
