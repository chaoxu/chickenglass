import { describe, expect, it } from "vitest";

import {
  collectSpecialBlockRanges,
  parseStructuredDisplayMathRaw,
  parseStructuredFencedDivRaw,
  serializeDisplayMathRaw,
  serializeFencedDivRaw,
} from "./block-syntax";

describe("block-syntax", () => {
  it("parses and serializes attribute-backed fenced div titles", () => {
    const parsed = parseStructuredFencedDivRaw([
      '::: {.figure #fig:one title="Original"}',
      "Body",
      ":::",
    ].join("\n"));

    expect(parsed).toMatchObject({
      blockType: "figure",
      id: "fig:one",
      title: "Original",
      titleKind: "attribute",
    });
    expect(serializeFencedDivRaw(parsed, {
      titleMarkdown: "Updated",
    })).toBe([
      '::: {.figure #fig:one title="Updated"}',
      "Body",
      ":::",
    ].join("\n"));
  });

  it("hides trailing label syntax from fenced div title fields while preserving source", () => {
    const parsed = parseStructuredFencedDivRaw([
      "::: {.theorem} Pythagoras {#thm:pythagoras}",
      "Body",
      ":::",
    ].join("\n"));

    expect(parsed).toMatchObject({
      blockType: "theorem",
      id: "thm:pythagoras",
      title: "Pythagoras",
      titleLabelSuffix: "{#thm:pythagoras}",
      titleMarkdown: "Pythagoras",
      titleKind: "trailing",
    });
    expect(serializeFencedDivRaw(parsed, {
      titleMarkdown: "Updated",
    })).toBe([
      "::: {.theorem} Updated {#thm:pythagoras}",
      "Body",
      ":::",
    ].join("\n"));
  });

  it("parses and serializes structured display math", () => {
    const parsed = parseStructuredDisplayMathRaw([
      "$$",
      "x + y",
      "$$ {#eq:sum}",
    ].join("\n"));

    expect(parsed).toMatchObject({
      body: "x + y",
      id: "eq:sum",
      labelSuffix: "{#eq:sum}",
      openingDelimiter: "$$",
    });
    expect(serializeDisplayMathRaw(parsed, "x + y + z")).toBe([
      "$$",
      "x + y + z",
      "$$ {#eq:sum}",
    ].join("\n"));
  });

  it("finds fenced div and display math ranges without swallowing surrounding markdown", () => {
    const markdown = [
      "Intro",
      "",
      "::: {.theorem #thm:a} Title",
      "Body",
      ":::",
      "",
      "$$",
      "x",
      "$$ {#eq:x}",
      "",
      "Outro",
    ].join("\n");

    expect(collectSpecialBlockRanges(markdown).map((range) => range.variant)).toEqual([
      "fenced-div",
      "display-math",
    ]);
  });
});
