/**
 * Built-in writing themes for Coflat.
 *
 * Each theme is a set of CSS custom property overrides applied to
 * `document.documentElement`. The `dark` flag marks presets that are designed
 * to sit on a dark base palette.
 */
import type { WritingThemeVariables } from "../../theme-contract";

export interface WritingTheme {
  /** Unique identifier stored in settings. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** CSS variable overrides (keys include the `--cf-` prefix). */
  variables: WritingThemeVariables;
  /** Whether this theme is designed for a dark base palette. */
  dark: boolean;
}

/**
 * Default theme — no variable overrides; uses whatever :root / [data-theme]
 * defines in globals.css. The light/dark toggle controls the appearance.
 */
const defaultTheme: WritingTheme = {
  id: "default",
  name: "Default",
  variables: {},
  dark: false,
};

/** Sepia — warm paper-like writing theme. */
const sepiaTheme: WritingTheme = {
  id: "sepia",
  name: "Sepia",
  variables: {
    "--cf-bg": "#f5f0e8",
    "--cf-bg-secondary": "#f5f0e8",
    "--cf-fg": "#433422",
    "--cf-muted": "#8b7355",
    "--cf-border": "#d4c9b5",
    "--cf-subtle": "rgba(0, 0, 0, 0.03)",
    "--cf-hover": "rgba(0, 0, 0, 0.05)",
    "--cf-active": "rgba(0, 0, 0, 0.07)",
    "--cf-accent": "#5c4033",
    "--cf-accent-fg": "#f5f0e8",
    "--cf-bg-overlay": "rgba(245, 240, 232, 0.82)",
    "--cf-border-overlay": "rgba(212, 201, 181, 0.6)",
  },
  dark: false,
};

/** Nord — muted blue/grey theme inspired by arctic landscapes. */
const nordTheme: WritingTheme = {
  id: "nord",
  name: "Nord",
  variables: {
    "--cf-bg": "#2e3440",
    "--cf-bg-secondary": "#2e3440",
    "--cf-fg": "#eceff4",
    "--cf-muted": "#8fbcbb",
    "--cf-border": "#4c566a",
    "--cf-subtle": "rgba(255, 255, 255, 0.04)",
    "--cf-hover": "rgba(255, 255, 255, 0.06)",
    "--cf-active": "rgba(255, 255, 255, 0.09)",
    "--cf-accent": "#88c0d0",
    "--cf-accent-fg": "#2e3440",
    "--cf-bg-overlay": "rgba(46, 52, 64, 0.82)",
    "--cf-border-overlay": "rgba(76, 86, 106, 0.6)",
  },
  dark: true,
};

/** Dracula — dark purple theme popular with developers. */
const draculaTheme: WritingTheme = {
  id: "dracula",
  name: "Dracula",
  variables: {
    "--cf-bg": "#282a36",
    "--cf-bg-secondary": "#282a36",
    "--cf-fg": "#f8f8f2",
    "--cf-muted": "#bd93f9",
    "--cf-border": "#44475a",
    "--cf-subtle": "rgba(255, 255, 255, 0.04)",
    "--cf-hover": "rgba(255, 255, 255, 0.06)",
    "--cf-active": "rgba(255, 255, 255, 0.09)",
    "--cf-accent": "#ff79c6",
    "--cf-accent-fg": "#282a36",
    "--cf-bg-overlay": "rgba(40, 42, 54, 0.82)",
    "--cf-border-overlay": "rgba(68, 71, 90, 0.6)",
  },
  dark: true,
};

/** All built-in themes, in display order. */
export const builtinThemes: WritingTheme[] = [
  defaultTheme,
  sepiaTheme,
  nordTheme,
  draculaTheme,
];

/** Look up a theme by id, falling back to the default. */
export function getThemeById(id: string): WritingTheme {
  return builtinThemes.find((t) => t.id === id) ?? defaultTheme;
}
