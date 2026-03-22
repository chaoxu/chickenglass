import { describe, expect, it } from "vitest";

import { createStandardPlugin } from "./plugin-factory";

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
    expect(spec.className).toBe("cf-block cf-block-definition");
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

  it("passes through defaults when provided", () => {
    const defaults = { qedSymbol: "\u220E" } as const;
    const plugin = createStandardPlugin({
      name: "proof",
      numbered: false,
      defaults,
    });
    expect(plugin.defaults).toEqual({ qedSymbol: "\u220E" });
  });

  it("omits defaults when not provided", () => {
    const plugin = createStandardPlugin({ name: "theorem" });
    expect(plugin.defaults).toBeUndefined();
  });

  it("sets name on the returned plugin", () => {
    const plugin = createStandardPlugin({ name: "conjecture" });
    expect(plugin.name).toBe("conjecture");
  });
});
