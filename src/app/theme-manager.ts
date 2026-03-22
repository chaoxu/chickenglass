/**
 * Theme manager: handles Light / Dark / System theme switching.
 *
 * Strategy:
 * - CSS custom properties (--cf-*) define all colors in :root (light) and
 *   [data-theme="dark"] (dark). The manager sets data-theme on <html>.
 * - "System" mode listens to the OS prefers-color-scheme media query and
 *   updates automatically.
 * - Theme choice is persisted to localStorage via the settings key.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "cf-theme";

/** Read the persisted theme, defaulting to "system". */
export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // localStorage unavailable (test environments, private browsing)
  }
  return "system";
}

/** Persist the theme choice. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable
  }
}

