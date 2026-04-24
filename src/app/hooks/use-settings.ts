/**
 * useSettings — React hook for localStorage-backed application settings.
 *
 * - Loads from a shared localStorage-backed store, falling back to defaults.
 * - `updateSetting(key, value)` updates one field and persists the full object.
 * - `resetSettings()` restores all defaults and persists them.
 * - All localStorage access is wrapped in try/catch for test environments.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { Settings } from "../lib/types";
import { readLocalStorage, writeLocalStorage } from "../lib/utils";
import { SETTINGS_KEY, LEGACY_THEME_KEY } from "../../constants";
import { defaultEditorMode, normalizeEditorMode } from "../../editor-display-mode";
import {
  emitLocalStorageKeyChange,
  subscribeLocalStorageKey,
} from "../stores/local-storage-subscription";

const DEFAULT_SETTINGS: Settings = {
  autoSaveInterval: 30000,
  fontSize: 16,
  lineHeight: 1.6,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellCheck: false,
  editorMode: defaultEditorMode,
  theme: "system",
  defaultExportFormat: "pdf",
  enabledPlugins: {},
  themeName: "default",
  writingTheme: "academic",
  customCss: "",
  skipDirtyConfirm: import.meta.env.DEV,
};

function isValidTheme(value: unknown): value is Settings["theme"] {
  return value === "light" || value === "dark" || value === "system";
}

function loadSettings(): Settings {
  const parsed = readLocalStorage<Partial<Settings>>(SETTINGS_KEY, {});
  const loaded = { ...DEFAULT_SETTINGS, ...parsed };

  // Migrate legacy spellCheck boolean into enabledPlugins
  if (loaded.spellCheck !== undefined && loaded.enabledPlugins?.spellcheck === undefined) {
    loaded.enabledPlugins = { ...loaded.enabledPlugins, spellcheck: loaded.spellCheck };
  }

  // Migrate legacy standalone theme key ("cf-theme") into unified settings.
  // Only applies when settings don't already have a non-default theme and the
  // legacy key exists.
  if (loaded.theme === "system" && !parsed.theme) {
    try {
      const legacy = localStorage.getItem(LEGACY_THEME_KEY);
      if (isValidTheme(legacy)) {
        loaded.theme = legacy;
      }
      // Clean up legacy key after migration
      localStorage.removeItem(LEGACY_THEME_KEY);
    } catch (_e) {
      // best-effort: localStorage unavailable (private browsing or test environment)
    }
  }

  // Validate theme value in case of corrupt data
  if (!isValidTheme(loaded.theme)) {
    loaded.theme = "system";
  }
  loaded.editorMode = normalizeEditorMode(loaded.editorMode, true);

  return loaded;
}

function persistSettings(settings: Settings): void {
  writeLocalStorage(SETTINGS_KEY, settings);
  settingsSnapshot = settings;
  settingsStorageSignature = readSettingsStorageSignature();
  emitLocalStorageKeyChange(SETTINGS_KEY);
}

let settingsSnapshot: Settings | null = null;
let settingsStorageSignature: string | null = null;

function readSettingsStorageSignature(): string {
  try {
    return JSON.stringify({
      settings: localStorage.getItem(SETTINGS_KEY),
      legacyTheme: localStorage.getItem(LEGACY_THEME_KEY),
    });
  } catch (_error) {
    return "";
  }
}

function getSettingsSnapshot(): Settings {
  const signature = readSettingsStorageSignature();
  if (!settingsSnapshot || signature !== settingsStorageSignature) {
    settingsSnapshot = loadSettings();
    settingsStorageSignature = readSettingsStorageSignature();
  }
  return settingsSnapshot;
}

function subscribeSettings(listener: () => void): () => void {
  const handleChange = () => {
    getSettingsSnapshot();
    listener();
  };
  const unsubscribeSettings = subscribeLocalStorageKey(SETTINGS_KEY, handleChange);
  const unsubscribeLegacyTheme = subscribeLocalStorageKey(LEGACY_THEME_KEY, handleChange);
  return () => {
    unsubscribeSettings();
    unsubscribeLegacyTheme();
  };
}

export interface UseSettingsReturn {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
}

export function useSettings(): UseSettingsReturn {
  const settings = useSyncExternalStore(
    subscribeSettings,
    getSettingsSnapshot,
    getSettingsSnapshot,
  );

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    persistSettings({ ...getSettingsSnapshot(), [key]: value });
  }, []);

  const resetSettings = useCallback(() => {
    persistSettings({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, updateSetting, resetSettings };
}
