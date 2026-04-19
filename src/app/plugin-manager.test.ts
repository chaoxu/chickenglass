import { describe, expect, it } from "vitest";

import {
  defaultEditorPlugins,
  isPluginEnabled,
  resolvePluginEnabled,
  type EditorPlugin,
} from "./plugin-manager";

describe("plugin enablement resolver", () => {
  const defaultOnPlugin: EditorPlugin = {
    id: "default-on",
    name: "Default On",
    defaultEnabled: true,
  };

  it("uses explicit settings overrides", () => {
    expect(resolvePluginEnabled({ enabledPlugins: { spellcheck: true } }, defaultEditorPlugins[0])).toBe(true);
    expect(resolvePluginEnabled({ enabledPlugins: { "default-on": false } }, defaultOnPlugin)).toBe(false);
  });

  it("falls back to plugin registry defaults", () => {
    expect(resolvePluginEnabled({ enabledPlugins: {} }, defaultOnPlugin)).toBe(true);
    expect(isPluginEnabled({ enabledPlugins: {} }, "spellcheck")).toBe(false);
  });

  it("returns false for unknown plugin ids", () => {
    expect(isPluginEnabled({ enabledPlugins: {} }, "missing-plugin")).toBe(false);
  });
});

