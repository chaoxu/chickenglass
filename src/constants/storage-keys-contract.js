export const SETTINGS_KEY = "cf-settings";
export const LEGACY_THEME_KEY = "cf-theme";
export const RECENT_FILES_KEY = "cf-recent-files";
export const RECENT_FOLDERS_KEY = "cf-recent-folders";
export const WINDOW_STATE_KEY = "cf-window-state";
export const WINDOW_STATE_SCOPED_PREFIX = `${WINDOW_STATE_KEY}:`;

export function isWindowStateStorageKey(key) {
  return key === WINDOW_STATE_KEY || key.startsWith(WINDOW_STATE_SCOPED_PREFIX);
}

