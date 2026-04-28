/**
 * localStorage key constants used across the Coflat app.
 *
 * Centralising keys here prevents typos and makes it easy to audit
 * all persisted state in one place.
 */

/** Unified application settings (theme, font size, editor mode, etc.). */
export const SETTINGS_KEY = "cf-settings";

/** Most-recently-opened file paths (array of strings). */
export const RECENT_FILES_KEY = "cf-recent-files";

/** Most-recently-opened folder paths (array of strings). */
export const RECENT_FOLDERS_KEY = "cf-recent-folders";

/** Full window layout state (tabs, sidebar width, section collapse). */
export const WINDOW_STATE_KEY = "cf-window-state";
