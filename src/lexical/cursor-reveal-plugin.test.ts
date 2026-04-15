/**
 * Unit coverage for the pure helpers inside cursor-reveal-plugin: the
 * markdown source wrap/unwrap round-trip that drives both the floating
 * and inline-swap presentations.
 */
import { describe, it, expect } from "vitest";

import type { InlineTextFormatSpec } from "../lexical-next/model/inline-text-format-family";
import { getInlineTextFormatSpecs } from "../lexical-next/model/inline-text-format-family";
import * as Reveal from "./cursor-reveal-plugin";

describe("cursor-reveal: wrap/unwrap helpers", () => {
  const specs = getInlineTextFormatSpecs();
  const bold = specs.find((s) => s.family === "bold")!;
  const italic = specs.find((s) => s.family === "italic")!;
  const code = specs.find((s) => s.family === "code")!;

  it("wraps plain text with a single format's markers", () => {
    expect(Reveal.wrapWithSpecs("hello", [italic])).toBe("*hello*");
    expect(Reveal.wrapWithSpecs("hello", [bold])).toBe("**hello**");
    expect(Reveal.wrapWithSpecs("f()", [code])).toBe("`f()`");
  });

  it("wraps with stacked markers in outer-first order", () => {
    expect(Reveal.wrapWithSpecs("x", [bold, italic])).toBe("***x***");
  });

  it("unwraps a single-format run to its inner text", () => {
    const { text, specs: found } = Reveal.unwrapSource("*hello*");
    expect(text).toBe("hello");
    expect(found.map((s: InlineTextFormatSpec) => s.family)).toEqual(["italic"]);
  });

  it("unwraps stacked markers outer-first", () => {
    const { text, specs: found } = Reveal.unwrapSource("***x***");
    expect(text).toBe("x");
    expect(found.map((s: InlineTextFormatSpec) => s.family)).toEqual(["bold", "italic"]);
  });

  it("leaves unbalanced or unknown input as plain text", () => {
    const { text, specs: found } = Reveal.unwrapSource("*unbalanced");
    expect(text).toBe("*unbalanced");
    expect(found).toEqual([]);
  });

  it("round-trips wrap → unwrap for each supported format", () => {
    for (const spec of specs) {
      const wrapped = Reveal.wrapWithSpecs("sample", [spec]);
      const { text, specs: found } = Reveal.unwrapSource(wrapped);
      expect(text).toBe("sample");
      expect(found.map((s: InlineTextFormatSpec) => s.family)).toEqual([spec.family]);
    }
  });
});
