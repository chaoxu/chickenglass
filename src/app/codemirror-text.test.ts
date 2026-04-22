import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { normalizeCmTextString, textMatchesString } from "./codemirror-text";

function textOf(source: string): Text {
  return Text.of(source.split("\n"));
}

describe("textMatchesString", () => {
  it("matches empty and single-line documents", () => {
    expect(textMatchesString(textOf(""), "")).toBe(true);
    expect(textMatchesString(textOf("alpha"), "alpha")).toBe(true);
    expect(textMatchesString(textOf("alpha"), "alphx")).toBe(false);
  });

  it("preserves newline and blank-line boundaries", () => {
    expect(textMatchesString(textOf("alpha\n\nbeta\n"), "alpha\n\nbeta\n")).toBe(true);
    expect(textMatchesString(textOf("alpha\n\nbeta"), "alpha\nbeta")).toBe(false);
    expect(textMatchesString(textOf("alpha\nbeta"), "alpha\nbeta\n")).toBe(false);
  });

  it("detects equal-length mismatches at line boundaries", () => {
    expect(textMatchesString(textOf("alpha\nbeta\ngamma"), "alpha\nBeta\ngamma")).toBe(false);
  });

  it("handles unicode by JS string offsets", () => {
    expect(textMatchesString(textOf("Hello 世界\nmath 🧮"), "Hello 世界\nmath 🧮")).toBe(true);
    expect(textMatchesString(textOf("Hello 世界\nmath 🧮"), "Hello 世界\nmath ?")).toBe(false);
  });

  it("walks large multiline documents without flattening", () => {
    const source = Array.from({ length: 1_000 }, (_, index) =>
      `line ${index} has alpha beta gamma and 世界 tokens`
    ).join("\n");

    expect(textMatchesString(textOf(source), source)).toBe(true);
    expect(textMatchesString(textOf(source), `${source.slice(0, -1)}x`)).toBe(false);
  });
});

describe("normalizeCmTextString", () => {
  it("matches CodeMirror string document line-ending normalization", () => {
    expect(normalizeCmTextString("alpha\r\nbeta\rgamma\n")).toBe("alpha\nbeta\ngamma\n");
  });
});
