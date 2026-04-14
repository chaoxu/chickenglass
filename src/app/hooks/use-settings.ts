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
import { SETTINGS_KEY, LEGACY_THEME_KEY } from "../../constants";
import { EDITOR_MODE, LEGACY_EDITOR_MODE_READ } from "../editor-mode";
import { BASE_FONT_SIZE_PX, BASE_LINE_HEIGHT } from "../../constants/typography";

const DEFAULT_SETTINGS: Settings = {
  autoSaveInterval: 30000,
  fontSize: BASE_FONT_SIZE_PX,
  lineHeight: BASE_LINE_HEIGHT,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellCheck: false,
  editorMode: EDITOR_MODE.LEXICAL,
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

  if ((parsed as { editorMode?: string }).editorMode === LEGACY_EDITOR_MODE_READ) {
    loaded.editorMode = EDITOR_MODE.LEXICAL;
  }

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

  return loaded;
}

function persistSettings(settings: Settings): void {
  writeLocalStorage(SETTINGS_KEY, settings);
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
