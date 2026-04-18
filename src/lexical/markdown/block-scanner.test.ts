import { describe, expect, it } from "vitest";

import { collectSourceBlockRanges } from "./block-scanner";

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
});
