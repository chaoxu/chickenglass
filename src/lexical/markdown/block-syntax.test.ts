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

  it("adds title attributes instead of trailing titles", () => {
    const parsed = parseStructuredFencedDivRaw([
      "::: {.theorem #thm:pythagoras}",
      "Body",
      ":::",
    ].join("\n"));

    expect(serializeFencedDivRaw(parsed, {
      titleMarkdown: "Pythagoras",
    })).toBe([
      '::: {.theorem #thm:pythagoras title="Pythagoras"}',
      "Body",
      ":::",
    ].join("\n"));
  });

  it("ignores non-canonical trailing opener text as a title", () => {
    const parsed = parseStructuredFencedDivRaw([
      '::: {#thm:main .theorem title="Attribute Title"} Trailing Title',
      "Body",
      ":::",
    ].join("\n"));

    expect(parsed).toMatchObject({
      blockType: "theorem",
      id: "thm:main",
      title: "Attribute Title",
      titleKind: "attribute",
      titleMarkdown: "Attribute Title",
    });
  });

  it("parses fenced div titles with braces through the canonical attr parser", () => {
    const parsed = parseStructuredFencedDivRaw([
      '::: {.theorem #thm:brace title="A } B"}',
      "Body",
      ":::",
    ].join("\n"));

    expect(parsed).toMatchObject({
      attrsRaw: '{.theorem #thm:brace title="A } B"}',
      blockType: "theorem",
      id: "thm:brace",
      title: "A } B",
      titleKind: "attribute",
      titleMarkdown: "A } B",
    });
  });

  it("treats bare known block labels as type-only fenced div openers", () => {
    const parsed = parseStructuredFencedDivRaw([
      "::: Proof",
      "Body",
      ":::",
    ].join("\n"));

    expect(parsed).toMatchObject({
      blockType: "proof",
      title: undefined,
      titleKind: "none",
      titleMarkdown: undefined,
    });
    expect(serializeFencedDivRaw(parsed)).toBe([
      "::: proof",
      "Body",
      ":::",
    ].join("\n"));
  });

  it("parses and serializes structured display math", () => {
    const parsed = parseStructuredDisplayMathRaw([
      "$$",
      "x + y",
      "$$",
    ].join("\n"));

    expect(parsed).toMatchObject({
      body: "x + y",
      id: undefined,
      labelSuffix: "",
      openingDelimiter: "$$",
    });
    expect(serializeDisplayMathRaw(parsed, "x + y + z")).toBe([
      "$$",
      "x + y + z",
      "$$",
    ].join("\n"));
  });

  it("parses and serializes canonical pandoc-crossref display math labels", () => {
    const parsed = parseStructuredDisplayMathRaw([
      "$$",
      "x + y",
      "$$ {#eq:sum}",
    ].join("\n"));

    expect(parsed).toMatchObject({
      body: "x + y",
      bodyMarkdown: "x + y",
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

  it("parses and serializes backslash display math labels", () => {
    const parsed = parseStructuredDisplayMathRaw([
      "\\[",
      "x + y",
      "\\] {#eq:sum}",
    ].join("\n"));

    expect(parsed).toMatchObject({
      body: "x + y",
      bodyMarkdown: "x + y",
      id: "eq:sum",
      labelSuffix: "{#eq:sum}",
      openingDelimiter: "\\[",
    });
    expect(serializeDisplayMathRaw(parsed, "x + y + z")).toBe([
      "\\[",
      "x + y + z",
      "\\] {#eq:sum}",
    ].join("\n"));
  });

  it("parses single-line backslash display math labels", () => {
    const parsed = parseStructuredDisplayMathRaw("\\[x + y\\] {#eq:sum}");

    expect(parsed).toMatchObject({
      body: "x + y",
      bodyMarkdown: "x + y",
      id: "eq:sum",
      labelSuffix: "{#eq:sum}",
      openingDelimiter: "\\[",
    });
  });

  it("parses raw LaTeX equation environments without creating canonical labels", () => {
    const parsed = parseStructuredDisplayMathRaw([
      "\\begin{equation}\\label{eq:sum}",
      "x + y",
      "\\end{equation}",
    ].join("\n"));

    expect(parsed).toMatchObject({
      body: "x + y",
      bodyMarkdown: "x + y",
      id: undefined,
      labelSuffix: "\\label{eq:sum}",
      openingDelimiter: "\\begin{equation}",
    });
    expect(serializeDisplayMathRaw(parsed, "x + y + z")).toBe([
      "\\begin{equation}\\label{eq:sum}",
      "x + y + z",
      "\\end{equation}",
    ].join("\n"));
  });

  it("finds fenced div and canonical equation ranges without swallowing surrounding markdown", () => {
    const markdown = [
      "Intro",
      "",
      '::: {.theorem #thm:a title="Title"}',
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
