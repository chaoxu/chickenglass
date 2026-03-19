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

const STORAGE_KEY = "cg-settings";

const DEFAULT_SETTINGS: Settings = {
  autoSaveInterval: 30000,
  fontSize: 16,
  lineHeight: 1.6,
  tabSize: 2,
  showLineNumbers: false,
  wordWrap: true,
  spellCheck: false,
  editorMode: "rendered",
  theme: "system",
  defaultExportFormat: "pdf",
  enabledPlugins: {},
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const loaded = { ...DEFAULT_SETTINGS, ...parsed };

    // Migrate legacy spellCheck boolean into enabledPlugins
    if (loaded.spellCheck !== undefined && loaded.enabledPlugins?.spellcheck === undefined) {
      loaded.enabledPlugins = { ...loaded.enabledPlugins, spellcheck: loaded.spellCheck };
    }

    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable (test environments, private browsing)
  }
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
