import { describe, expect, it } from "vitest";

import { BLOCK_MANIFEST_ENTRIES } from "../constants/block-manifest";
import { CSS } from "../constants/css-classes";
import { createStandardPlugin, pluginFromManifest } from "./plugin-factory";

describe("createStandardPlugin", () => {
  it("auto-capitalizes title from name", () => {
    const plugin = createStandardPlugin({ name: "theorem" });
    expect(plugin.title).toBe("Theorem");
  });

  it("uses explicit title when provided", () => {
    const plugin = createStandardPlugin({ name: "thm", title: "Theorem" });
    expect(plugin.title).toBe("Theorem");
  });

  it("defaults numbered to true", () => {
    const plugin = createStandardPlugin({ name: "theorem" });
    expect(plugin.numbered).toBe(true);
  });

  it("respects numbered=false", () => {
    const plugin = createStandardPlugin({ name: "proof", numbered: false });
    expect(plugin.numbered).toBe(false);
  });

  it("passes through counter when provided", () => {
    const plugin = createStandardPlugin({
      name: "lemma",
      counter: "theorem",
    });
    expect(plugin.counter).toBe("theorem");
  });

  it("omits counter when not provided", () => {
    const plugin = createStandardPlugin({ name: "proof", numbered: false });
    expect(plugin.counter).toBeUndefined();
  });

  it("attaches a render function that produces correct spec", () => {
    const plugin = createStandardPlugin({ name: "definition" });
    const spec = plugin.render({ type: "definition", number: 3 });
    expect(spec.header).toBe("Definition 3");
    expect(spec.className).toBe(CSS.block("definition"));
  });

  it("render uses auto-capitalized title in header", () => {
    const plugin = createStandardPlugin({ name: "algorithm" });
    const spec = plugin.render({ type: "algorithm", number: 1 });
    expect(spec.header).toBe("Algorithm 1");
  });

  it("render omits number for unnumbered blocks", () => {
    const plugin = createStandardPlugin({ name: "remark", numbered: false });
    const spec = plugin.render({ type: "remark" });
    expect(spec.header).toBe("Remark");
  });

  it("sets name on the returned plugin", () => {
    const plugin = createStandardPlugin({ name: "conjecture" });
    expect(plugin.name).toBe("conjecture");
  });

  it("accepts manifest entries directly", () => {
    const youtube = BLOCK_MANIFEST_ENTRIES.find((entry) => entry.name === "youtube");
    expect(youtube).toBeDefined();
    if (!youtube) throw new Error("expected youtube manifest entry");

    const plugin = createStandardPlugin(youtube);
    expect(plugin.title).toBe("YouTube");
    expect(plugin.numbered).toBe(false);
    expect(plugin.specialBehavior).toBe("embed");
  });

  it("maps manifest counter and metadata through pluginFromManifest", () => {
    const blockquote = BLOCK_MANIFEST_ENTRIES.find((entry) => entry.name === "blockquote");
    expect(blockquote).toBeDefined();
    if (!blockquote) throw new Error("expected blockquote manifest entry");

    const plugin = pluginFromManifest(blockquote);
    expect(plugin.numbered).toBe(false);
    expect(plugin.counter).toBeUndefined();
    expect(plugin.displayHeader).toBe(false);
    expect(plugin.specialBehavior).toBe("blockquote");
  });

  describe("negative / edge-case", () => {
    it("handles single-character name", () => {
      const plugin = createStandardPlugin({ name: "x" });
      expect(plugin.name).toBe("x");
      expect(plugin.title).toBe("X");
    });

    it("render with number=0 produces header with 0", () => {
      const plugin = createStandardPlugin({ name: "theorem" });
      const spec = plugin.render({ type: "theorem", number: 0 });
      expect(spec.header).toBe("Theorem 0");
    });

    it("render with undefined number for numbered plugin omits number", () => {
      const plugin = createStandardPlugin({ name: "theorem" });
      const spec = plugin.render({ type: "theorem" });
      // Without a number, header is just the title
      expect(spec.header).toBe("Theorem");
    });

    it("render for unnumbered plugin still shows number if passed in attrs", () => {
      // The render function uses formatBlockHeader which shows number when present.
      // Callers (block-counter) only pass number for numbered plugins.
      const plugin = createStandardPlugin({ name: "proof", numbered: false });
      const spec = plugin.render({ type: "proof", number: 42 });
      expect(spec.header).toBe("Proof 42");
    });

    it("CSS class uses the plugin name, not the title", () => {
      const plugin = createStandardPlugin({ name: "myblock", title: "My Block" });
      const spec = plugin.render({ type: "myblock" });
      expect(spec.className).toBe(CSS.block("myblock"));
    });
  });
});
