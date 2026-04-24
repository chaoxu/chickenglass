import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Settings } from "../lib/types";
import { useSettings } from "./use-settings";
import { SETTINGS_KEY, LEGACY_THEME_KEY } from "../../constants";

const STORAGE_KEY = SETTINGS_KEY;

function storedSettings(): Settings | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Settings) : null;
}

describe("useSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ── loadSettings ──────────────────────────────────────────────────

  describe("loadSettings (via hook initialisation)", () => {
    it("returns full defaults when localStorage is empty", () => {
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings).toEqual({
        autoSaveInterval: 30000,
        fontSize: 16,
        lineHeight: 1.6,
        tabSize: 2,
        showLineNumbers: false,
        wordWrap: true,
        spellCheck: false,
        editorMode: "cm6-rich",
        theme: "system",
        defaultExportFormat: "pdf",
        enabledPlugins: { spellcheck: false },
        themeName: "default",
        writingTheme: "academic",
        customCss: "",
        skipDirtyConfirm: true,
      });
    });

    it("merges persisted partial settings with defaults", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ fontSize: 20, tabSize: 4 }),
      );
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.fontSize).toBe(20);
      expect(result.current.settings.tabSize).toBe(4);
      expect(result.current.settings.lineHeight).toBe(1.6);
      expect(result.current.settings.editorMode).toBe("cm6-rich");
    });

    it("migrates legacy spellCheck into enabledPlugins", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ spellCheck: true }),
      );
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.enabledPlugins.spellcheck).toBe(true);
    });

    it("does not overwrite existing enabledPlugins.spellcheck", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          spellCheck: true,
          enabledPlugins: { spellcheck: false },
        }),
      );
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.enabledPlugins.spellcheck).toBe(false);
    });

    it("migrates legacy cf-theme key into settings.theme", () => {
      localStorage.setItem(LEGACY_THEME_KEY, "dark");
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.theme).toBe("dark");
      // Legacy key should be cleaned up
      expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
    });

    it("ignores invalid legacy cf-theme values", () => {
      localStorage.setItem(LEGACY_THEME_KEY, "neon");
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.theme).toBe("system");
      // Key still removed after migration attempt
      expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
    });

    it("does not migrate legacy theme when settings already have a theme", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme: "light" }),
      );
      localStorage.setItem(LEGACY_THEME_KEY, "dark");
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.theme).toBe("light");
    });

    it("falls back to 'system' for corrupt theme value", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme: "banana" }),
      );
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.theme).toBe("system");
    });

    it("handles corrupt JSON in localStorage gracefully", () => {
      localStorage.setItem(STORAGE_KEY, "not-json{{{");
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings.fontSize).toBe(16);
      expect(result.current.settings.theme).toBe("system");
    });
  });

  // ── updateSetting ─────────────────────────────────────────────────

  describe("updateSetting", () => {
    it("notifies every hook instance in the same tab", () => {
      const first = renderHook(() => useSettings());
      const second = renderHook(() => useSettings());

      act(() => {
        first.result.current.updateSetting("fontSize", 24);
      });

      expect(second.result.current.settings.fontSize).toBe(24);
    });

    it("updates after browser storage events from another window", () => {
      const { result } = renderHook(() => useSettings());

      act(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize: 22 }));
        window.dispatchEvent(new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: localStorage.getItem(STORAGE_KEY),
        }));
      });

      expect(result.current.settings.fontSize).toBe(22);
    });

    it("persists individual field changes to localStorage", () => {
      const { result } = renderHook(() => useSettings());
      act(() => {
        result.current.updateSetting("fontSize", 24);
      });
      const stored = storedSettings();
      expect(stored?.fontSize).toBe(24);
    });

    it("preserves other fields when updating one", () => {
      const { result } = renderHook(() => useSettings());
      act(() => {
        result.current.updateSetting("tabSize", 8);
      });
      const stored = storedSettings();
      expect(stored?.tabSize).toBe(8);
      expect(stored?.lineHeight).toBe(1.6);
      expect(stored?.editorMode).toBe("cm6-rich");
    });

    it("updates the in-memory state", () => {
      const { result } = renderHook(() => useSettings());
      act(() => {
        result.current.updateSetting("wordWrap", false);
      });
      expect(result.current.settings.wordWrap).toBe(false);
    });
  });

  // ── resetSettings ─────────────────────────────────────────────────

  describe("resetSettings", () => {
    it("restores all settings to defaults", () => {
      const { result } = renderHook(() => useSettings());
      act(() => {
        result.current.updateSetting("fontSize", 42);
        result.current.updateSetting("theme", "dark");
        result.current.resetSettings();
      });
      expect(result.current.settings.fontSize).toBe(16);
      expect(result.current.settings.theme).toBe("system");
    });

    it("persists the default settings to localStorage", () => {
      const { result } = renderHook(() => useSettings());
      act(() => {
        result.current.updateSetting("fontSize", 42);
        result.current.resetSettings();
      });
      const stored = storedSettings();
      expect(stored?.fontSize).toBe(16);
      expect(stored?.theme).toBe("system");
    });

    it("clears customised enabledPlugins", () => {
      const { result } = renderHook(() => useSettings());
      act(() => {
        result.current.updateSetting("enabledPlugins", { spellcheck: true, foo: false });
        result.current.resetSettings();
      });
      expect(result.current.settings.enabledPlugins).toEqual({});
    });
  });
});
