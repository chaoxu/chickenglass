/**
 * Built-in writing themes for Coflat.
 *
 * Each theme is a set of CSS custom property overrides applied to
 * `document.documentElement`. The `dark` flag tells CM6 whether to
 * activate its dark-mode base theme (colorScheme, scroll gutter, etc.).
 */

export interface WritingTheme {
  /** Unique identifier stored in settings. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** CSS variable overrides (keys include the `--cg-` prefix). */
  variables: Record<string, string>;
  /** Whether this theme is dark (drives CM6 dark base theme). */
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
    "--cg-bg": "#f5f0e8",
    "--cg-bg-secondary": "#f5f0e8",
    "--cg-fg": "#433422",
    "--cg-muted": "#8b7355",
    "--cg-border": "#d4c9b5",
    "--cg-subtle": "rgba(0, 0, 0, 0.03)",
    "--cg-hover": "rgba(0, 0, 0, 0.05)",
    "--cg-active": "rgba(0, 0, 0, 0.07)",
    "--cg-accent": "#5c4033",
    "--cg-accent-fg": "#f5f0e8",
    "--cg-bg-overlay": "rgba(245, 240, 232, 0.82)",
    "--cg-border-overlay": "rgba(212, 201, 181, 0.6)",
    "--cg-separator": "rgba(139, 115, 85, 0.8)",
  },
  dark: false,
};

/** Nord — muted blue/grey theme inspired by arctic landscapes. */
const nordTheme: WritingTheme = {
  id: "nord",
  name: "Nord",
  variables: {
    "--cg-bg": "#2e3440",
    "--cg-bg-secondary": "#2e3440",
    "--cg-fg": "#eceff4",
    "--cg-muted": "#8fbcbb",
    "--cg-border": "#4c566a",
    "--cg-subtle": "rgba(255, 255, 255, 0.04)",
    "--cg-hover": "rgba(255, 255, 255, 0.06)",
    "--cg-active": "rgba(255, 255, 255, 0.09)",
    "--cg-accent": "#88c0d0",
    "--cg-accent-fg": "#2e3440",
    "--cg-bg-overlay": "rgba(46, 52, 64, 0.82)",
    "--cg-border-overlay": "rgba(76, 86, 106, 0.6)",
    "--cg-separator": "rgba(143, 188, 187, 0.6)",
  },
  dark: true,
};

/** Dracula — dark purple theme popular with developers. */
const draculaTheme: WritingTheme = {
  id: "dracula",
  name: "Dracula",
  variables: {
    "--cg-bg": "#282a36",
    "--cg-bg-secondary": "#282a36",
    "--cg-fg": "#f8f8f2",
    "--cg-muted": "#bd93f9",
    "--cg-border": "#44475a",
    "--cg-subtle": "rgba(255, 255, 255, 0.04)",
    "--cg-hover": "rgba(255, 255, 255, 0.06)",
    "--cg-active": "rgba(255, 255, 255, 0.09)",
    "--cg-accent": "#ff79c6",
    "--cg-accent-fg": "#282a36",
    "--cg-bg-overlay": "rgba(40, 42, 54, 0.82)",
    "--cg-border-overlay": "rgba(68, 71, 90, 0.6)",
    "--cg-separator": "rgba(189, 147, 249, 0.6)",
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
