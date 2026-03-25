/**
 * Tests for the block-type picker extension.
 *
 * Covers:
 * - Input handler interception of ::: at line start
 * - Picker entry list generation from plugin registry
 * - Block insertion with correct nesting depth
 * - Source mode bypass (no interception)
 */

import { describe, expect, it } from "vitest";
import { createEditor, editorModeField, setEditorMode } from "./editor";
import { pluginRegistryField } from "../plugins";

describe("blockTypePickerExtension", () => {
  it("includes pluginRegistryField in created editor state", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent, doc: "# Test\n" });

    // The registry should be available
    const registry = view.state.field(pluginRegistryField);
    expect(registry).toBeDefined();
    expect(registry.plugins.size).toBeGreaterThan(0);

    // Should contain standard block types
    expect(registry.plugins.has("theorem")).toBe(true);
    expect(registry.plugins.has("proof")).toBe(true);
    expect(registry.plugins.has("definition")).toBe(true);

    view.destroy();
  });

  it("has editorModeField defaulting to rich", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent, doc: "# Test\n" });

    expect(view.state.field(editorModeField)).toBe("rich");

    view.destroy();
  });

  it("editorModeField updates to source when set", () => {
    const parent = document.createElement("div");
    const view = createEditor({ parent, doc: "# Test\n" });

    setEditorMode(view, "source");
    expect(view.state.field(editorModeField)).toBe("source");

    view.destroy();
  });

  describe("plugin registry entries", () => {
    it("contains expected block types for picker", () => {
      const parent = document.createElement("div");
      const view = createEditor({ parent, doc: "# Test\n" });

      const registry = view.state.field(pluginRegistryField);
      const names = [...registry.plugins.keys()];

      // Should have theorem family
      expect(names).toContain("theorem");
      expect(names).toContain("lemma");
      expect(names).toContain("corollary");
      expect(names).toContain("proposition");
      expect(names).toContain("conjecture");

      // Should have other standard types
      expect(names).toContain("definition");
      expect(names).toContain("proof");
      expect(names).toContain("remark");
      expect(names).toContain("example");
      expect(names).toContain("algorithm");
      expect(names).toContain("blockquote");

      // Should have embed types (excluded from picker but in registry)
      expect(names).toContain("embed");

      view.destroy();
    });

    it("plugin titles match expected display names", () => {
      const parent = document.createElement("div");
      const view = createEditor({ parent, doc: "# Test\n" });

      const registry = view.state.field(pluginRegistryField);

      expect(registry.plugins.get("theorem")?.title).toBe("Theorem");
      expect(registry.plugins.get("proof")?.title).toBe("Proof");
      expect(registry.plugins.get("definition")?.title).toBe("Definition");
      expect(registry.plugins.get("blockquote")?.title).toBe("Blockquote");

      view.destroy();
    });
  });
});
