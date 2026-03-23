/**
 * useSettings — React hook for localStorage-backed application settings.
 *
 * - Loads from localStorage on first render, falling back to defaults.
 * - `updateSetting(key, value)` updates one field and persists the full object.
 * - `resetSettings()` restores all defaults and persists them.
 * - All localStorage access is wrapped in try/catch for test environments.
 */

import { useState, useCallback } from "react";
import type { Settings } from "../lib/types";
import { readLocalStorage, writeLocalStorage } from "../lib/utils";

const STORAGE_KEY = "cf-settings";

const DEFAULT_SETTINGS: Settings = {
  autoSaveInterval: 30000,
  fontSize: 16,
  lineHeight: 1.6,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellCheck: false,
  editorMode: "rich",
  theme: "system",
  defaultExportFormat: "pdf",
  enabledPlugins: {},
  themeName: "default",
  writingTheme: "academic",
  customCss: "",
};

/** Key used by the legacy standalone theme-manager. */
const LEGACY_THEME_KEY = "cf-theme";

function isValidTheme(value: unknown): value is Settings["theme"] {
  return value === "light" || value === "dark" || value === "system";
}

function loadSettings(): Settings {
  const parsed = readLocalStorage<Partial<Settings>>(STORAGE_KEY, {});
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
    } catch {
      // best-effort: localStorage unavailable (private browsing or test environment)
    }
  }

  // Validate theme value in case of corrupt data
  if (!isValidTheme(loaded.theme)) {
    loaded.theme = "system";
  }

  return loaded;
}

function persistSettings(settings: Settings): void {
  writeLocalStorage(STORAGE_KEY, settings);
}

export interface UseSettingsReturn {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      persistSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_SETTINGS };
    persistSettings(defaults);
    setSettings(defaults);
  }, []);

  return { settings, updateSetting, resetSettings };
}
