/**
 * Theme manager: handles Light / Dark / System theme switching.
 *
 * Strategy:
 * - CSS custom properties (--cg-*) define all colors in :root (light) and
 *   [data-theme="dark"] (dark). The manager sets data-theme on <html>.
 * - "System" mode listens to the OS prefers-color-scheme media query and
 *   updates automatically.
 * - Theme choice is persisted to localStorage via the settings key.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "cg-theme";

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

type ThemeChangeHandler = (resolved: "light" | "dark") => void;

/**
 * ThemeManager applies the active theme to the document and listens for OS
 * preference changes when the theme is set to "system".
 *
 * Usage:
 * ```ts
 * const mgr = new ThemeManager();
 * mgr.onChange((resolved) => view.dispatch({ effects: themeCompartment.reconfigure(...) }));
 * mgr.setTheme(loadTheme());
 * ```
 */
export class ThemeManager {
  private theme: Theme = "system";
  private resolved: "light" | "dark" = "light";
  private handlers: ThemeChangeHandler[] = [];
  private mediaQuery: MediaQueryList | null = null;
  private readonly mediaListener: (e: MediaQueryListEvent) => void;

  constructor() {
    this.mediaListener = (e) => {
      if (this.theme === "system") {
        this.applyResolved(e.matches ? "dark" : "light");
      }
    };
  }

  /** Register a callback invoked when the resolved (light|dark) theme changes. */
  onChange(handler: ThemeChangeHandler): void {
    this.handlers.push(handler);
  }

  /** Set the theme and apply it immediately. */
  setTheme(theme: Theme): void {
    this.theme = theme;
    saveTheme(theme);

    if (theme === "system") {
      this.startMediaListener();
      const isDark = this.mediaQuery?.matches ?? false;
      this.applyResolved(isDark ? "dark" : "light");
    } else {
      this.stopMediaListener();
      this.applyResolved(theme);
    }
  }

  /** Get the current theme setting (not the resolved value). */
  getTheme(): Theme {
    return this.theme;
  }

  /** Get the currently resolved theme (light or dark). */
  getResolved(): "light" | "dark" {
    return this.resolved;
  }

  /** Remove OS media-query listeners. Call when the app is destroyed. */
  destroy(): void {
    this.stopMediaListener();
  }

  // ── private ────────────────────────────────────────────────────────────────

  private applyResolved(resolved: "light" | "dark"): void {
    // Guard: skip no-op updates to avoid spurious CM6 reconfigures.
    if (resolved === this.resolved && document.documentElement.getAttribute("data-theme") === resolved) {
      return;
    }
    this.resolved = resolved;
    document.documentElement.setAttribute("data-theme", resolved);
    for (const h of this.handlers) h(resolved);
  }

  private startMediaListener(): void {
    if (this.mediaQuery) return; // already listening
    if (typeof window.matchMedia !== "function") return; // test environments
    this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    this.mediaQuery.addEventListener("change", this.mediaListener);
  }

  private stopMediaListener(): void {
    if (!this.mediaQuery) return;
    this.mediaQuery.removeEventListener("change", this.mediaListener);
    this.mediaQuery = null;
  }
}
