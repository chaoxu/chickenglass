/**
 * localStorage key constants used across the Coflat app.
 *
 * Centralising keys here prevents typos and makes it easy to audit
 * all persisted state in one place.
 */

export {
  SETTINGS_KEY,
  LEGACY_THEME_KEY,
  RECENT_FILES_KEY,
  RECENT_FOLDERS_KEY,
  WINDOW_STATE_KEY,
  WINDOW_STATE_SCOPED_PREFIX,
  isWindowStateStorageKey,
} from "./storage-keys-contract.js";
