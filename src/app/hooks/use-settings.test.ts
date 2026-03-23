import { beforeEach, describe, expect, it, vi } from "vitest";

// ── localStorage shim ───────────────────────────────────────────────
// Node 25+ exposes a native `localStorage` that lacks standard methods
// when --localstorage-file is not set.  Install a spec-compliant shim
// so the source module (and our assertions) can call getItem / setItem /
// removeItem / clear without hitting the broken native object.
const storage = new Map<string, string>();
const localStorageShim: Storage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
};
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageShim,
  writable: true,
  configurable: true,
});

// ── React mock ──────────────────────────────────────────────────────
// Replace useState / useCallback with synchronous stubs so we can drive
// the hook without a React renderer.
let capturedState: unknown;

vi.mock("react", () => ({
  useState: (init: unknown) => {
    const value = typeof init === "function" ? (init as () => unknown)() : init;
    capturedState = value;
    const setter = (updaterOrValue: unknown) => {
      if (typeof updaterOrValue === "function") {
        capturedState = (updaterOrValue as (prev: unknown) => unknown)(capturedState);
      } else {
        capturedState = updaterOrValue;
      }
    };
    return [value, setter];
  },
  useCallback: <T>(fn: T) => fn,
}));

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
    capturedState = undefined;
  });

  // ── loadSettings ──────────────────────────────────────────────────

  describe("loadSettings (via hook initialisation)", () => {
    it("returns full defaults when localStorage is empty", () => {
      const { settings } = useSettings();
      expect(settings).toEqual({
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
        enabledPlugins: { spellcheck: false },
        themeName: "default",
        writingTheme: "academic",
        customCss: "",
      });
    });

    it("merges persisted partial settings with defaults", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ fontSize: 20, tabSize: 4 }),
      );
      const { settings } = useSettings();
      expect(settings.fontSize).toBe(20);
      expect(settings.tabSize).toBe(4);
      expect(settings.lineHeight).toBe(1.6);
      expect(settings.editorMode).toBe("rich");
    });

    it("migrates legacy spellCheck into enabledPlugins", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ spellCheck: true }),
      );
      const { settings } = useSettings();
      expect(settings.enabledPlugins.spellcheck).toBe(true);
    });

    it("does not overwrite existing enabledPlugins.spellcheck", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          spellCheck: true,
          enabledPlugins: { spellcheck: false },
        }),
      );
      const { settings } = useSettings();
      expect(settings.enabledPlugins.spellcheck).toBe(false);
    });

    it("migrates legacy cf-theme key into settings.theme", () => {
      localStorage.setItem(LEGACY_THEME_KEY, "dark");
      const { settings } = useSettings();
      expect(settings.theme).toBe("dark");
      // Legacy key should be cleaned up
      expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
    });

    it("ignores invalid legacy cf-theme values", () => {
      localStorage.setItem(LEGACY_THEME_KEY, "neon");
      const { settings } = useSettings();
      expect(settings.theme).toBe("system");
      // Key still removed after migration attempt
      expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull();
    });

    it("does not migrate legacy theme when settings already have a theme", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme: "light" }),
      );
      localStorage.setItem(LEGACY_THEME_KEY, "dark");
      const { settings } = useSettings();
      expect(settings.theme).toBe("light");
    });

    it("falls back to 'system' for corrupt theme value", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ theme: "banana" }),
      );
      const { settings } = useSettings();
      expect(settings.theme).toBe("system");
    });

    it("handles corrupt JSON in localStorage gracefully", () => {
      localStorage.setItem(STORAGE_KEY, "not-json{{{");
      const { settings } = useSettings();
      expect(settings.fontSize).toBe(16);
      expect(settings.theme).toBe("system");
    });
  });

  // ── updateSetting ─────────────────────────────────────────────────

  describe("updateSetting", () => {
    it("persists individual field changes to localStorage", () => {
      const { updateSetting } = useSettings();
      updateSetting("fontSize", 24);
      const stored = storedSettings();
      expect(stored?.fontSize).toBe(24);
    });

    it("preserves other fields when updating one", () => {
      const { updateSetting } = useSettings();
      updateSetting("tabSize", 8);
      const stored = storedSettings();
      expect(stored?.tabSize).toBe(8);
      expect(stored?.lineHeight).toBe(1.6);
      expect(stored?.editorMode).toBe("rich");
    });

    it("updates the in-memory state", () => {
      const { updateSetting } = useSettings();
      updateSetting("wordWrap", false);
      expect((capturedState as Settings).wordWrap).toBe(false);
    });
  });

  // ── resetSettings ─────────────────────────────────────────────────

  describe("resetSettings", () => {
    it("restores all settings to defaults", () => {
      const { updateSetting, resetSettings } = useSettings();
      updateSetting("fontSize", 42);
      updateSetting("theme", "dark");
      resetSettings();
      expect((capturedState as Settings).fontSize).toBe(16);
      expect((capturedState as Settings).theme).toBe("system");
    });

    it("persists the default settings to localStorage", () => {
      const { updateSetting, resetSettings } = useSettings();
      updateSetting("fontSize", 42);
      resetSettings();
      const stored = storedSettings();
      expect(stored?.fontSize).toBe(16);
      expect(stored?.theme).toBe("system");
    });

    it("clears customised enabledPlugins", () => {
      const { updateSetting, resetSettings } = useSettings();
      updateSetting("enabledPlugins", { spellcheck: true, foo: false });
      resetSettings();
      expect((capturedState as Settings).enabledPlugins).toEqual({});
    });
  });
});
