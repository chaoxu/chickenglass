import { describe, expect, it } from "vitest";

import {
  collectSourceBlockRanges,
  isDisplayMathBracketExpansionLine,
  isDisplayMathDollarExpansionLine,
  matchFencedDivStartLine,
} from "./block-scanner";

describe("block-scanner", () => {
  it("collects source-backed block ranges without scanning through following prose", () => {
    const markdown = [
      "---",
      "title: Test",
      "---",
      "",
      "::: {.theorem #thm:a}",
      "Body",
      ":::",
      "",
      "$$",
      "x",
      "$$ {#eq:x}",
      "",
      "![Alt](figure.png)",
      "",
      "[^1]: footnote",
      "  continuation",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "After",
    ].join("\n");

    expect(collectSourceBlockRanges(markdown).map((range) => range.variant)).toEqual([
      "frontmatter",
      "fenced-div",
      "display-math",
      "image",
      "footnote-definition",
      "table",
    ]);
  });

  it("recognizes single-line dollar display math consistently with import", () => {
    expect(collectSourceBlockRanges("Before\n\n$$x + y$$\n\nAfter").map((range) => ({
      raw: range.raw,
      variant: range.variant,
    }))).toEqual([
      {
        raw: "$$x + y$$",
        variant: "display-math",
      },
    ]);
  });

  it("keeps longer fenced divs whole when they contain shorter nested fences", () => {
    const markdown = [
      ":::: {.theorem} Outer",
      "Before",
      "",
      "::: {.blockquote}",
      "Inner",
      ":::",
      "",
      "After",
      "::::",
    ].join("\n");

    expect(collectSourceBlockRanges(markdown)).toMatchObject([
      {
        from: 0,
        raw: markdown,
        to: markdown.length,
        variant: "fenced-div",
      },
    ]);
  });

  it("recognizes documented single-line fenced divs", () => {
    expect(collectSourceBlockRanges("::: {.theorem} Short statement. :::")).toMatchObject([
      {
        raw: "::: {.theorem} Short statement. :::",
        variant: "fenced-div",
      },
    ]);
  });

  it("exposes shared markdown-expansion start-line matchers", () => {
    expect(matchFencedDivStartLine("::: {.theorem}", { requireHeader: true })?.[1]).toBe(":::");
    expect(matchFencedDivStartLine(":::", { requireHeader: true })).toBeNull();
    expect(isDisplayMathDollarExpansionLine("$$")).toBe(true);
    expect(isDisplayMathDollarExpansionLine("$$x + y$$")).toBe(false);
    expect(isDisplayMathBracketExpansionLine("\\[")).toBe(true);
  });
});
