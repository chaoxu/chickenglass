import { describe, expect, it } from "vitest";

import {
  collectSourceBoundaryRanges,
  collectSourceBlockRanges,
  findSourceBoundaryRangeContainingChange,
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
      "+-------+-------+",
      "| Left  | Right |",
      "+=======+=======+",
      "| $x$   | y     |",
      "+-------+-------+",
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
      "grid-table",
      "table",
    ]);
  });

  it("reports body ranges for source-backed blocks", () => {
    const markdown = [
      "---",
      "title: Test",
      "---",
      "",
      "::: {.proof}",
      "Body text.",
      ":::",
      "",
      "$$x + y$$ {#eq:sum}",
      "",
      "[^1]: first line",
      "  second line",
      "",
      "| A | B |",
      "| --- | --- |",
      "| $x$ | y |",
    ].join("\n");

    const ranges = collectSourceBlockRanges(markdown);
    const bodyFor = (variant: string) => {
      const range = ranges.find((candidate) => candidate.variant === variant);
      expect(range).toBeDefined();
      return markdown.slice(range?.bodyFrom, range?.bodyTo);
    };

    expect(bodyFor("frontmatter")).toBe("title: Test");
    expect(bodyFor("fenced-div")).toBe("Body text.");
    expect(bodyFor("display-math")).toBe("x + y");
    expect(bodyFor("footnote-definition")).toBe("first line\n  second line");
    expect(bodyFor("table")).toBe([
      "| A | B |",
      "| --- | --- |",
      "| $x$ | y |",
    ].join("\n"));
  });

  it("can include a footnote terminating blank line by option without changing the body range", () => {
    const markdown = [
      "[^1]: first line",
      "  second line",
      "",
      "Next paragraph",
    ].join("\n");

    const [defaultRange] = collectSourceBlockRanges(markdown);
    const [withBlankRange] = collectSourceBlockRanges(markdown, {
      includeFootnoteTerminatingBlank: true,
    });

    expect(defaultRange?.raw).toBe("[^1]: first line\n  second line");
    expect(withBlankRange?.raw).toBe("[^1]: first line\n  second line\n");
    expect(markdown.slice(withBlankRange?.bodyFrom, withBlankRange?.bodyTo)).toBe(
      "first line\n  second line",
    );
  });

  it("starts footnote body range at the first continuation when the definition line has no body", () => {
    const markdown = [
      "[^1]:",
      "  continuation",
    ].join("\n");
    const [range] = collectSourceBlockRanges(markdown);

    expect(markdown.slice(range?.bodyFrom, range?.bodyTo)).toBe("  continuation");
  });

  it("iterates source blocks and single-line fallback boundaries in document order", () => {
    const markdown = [
      "Alpha",
      "",
      "$$",
      "x",
      "$$",
      "Tail",
    ].join("\n");

    expect(collectSourceBoundaryRanges(markdown).map((range) => range.variant)).toEqual([
      "line",
      "line",
      "display-math",
      "line",
    ]);
  });

  it("finds the boundary containing a change without materializing all boundaries", () => {
    const markdown = [
      "Alpha",
      "",
      "$$",
      "x",
      "$$",
      "Tail",
    ].join("\n");
    const from = markdown.indexOf("x");
    const range = findSourceBoundaryRangeContainingChange(markdown, {
      from,
      to: from + 1,
    });

    expect(range).toMatchObject({
      index: 2,
      raw: "$$\nx\n$$",
      variant: "display-math",
    });
  });

  it("collects pandoc grid tables as source-backed blocks", () => {
    const markdown = [
      "Before",
      "",
      "+-------+------------------+",
      "| Input | Output           |",
      "+=======+==================+",
      "| graph | first paragraph  |",
      "|       |                  |",
      "|       | second paragraph |",
      "+-------+------------------+",
      "",
      "After",
    ].join("\n");

    expect(collectSourceBlockRanges(markdown)).toMatchObject([
      {
        raw: [
          "+-------+------------------+",
          "| Input | Output           |",
          "+=======+==================+",
          "| graph | first paragraph  |",
          "|       |                  |",
          "|       | second paragraph |",
          "+-------+------------------+",
        ].join("\n"),
        variant: "grid-table",
      },
    ]);
  });

  it("recognizes single-line dollar display math consistently with import", () => {
    expect(collectSourceBlockRanges("Before\n\n$$x + y$$ {#eq:sum}\n\nAfter").map((range) => ({
      raw: range.raw,
      variant: range.variant,
    }))).toEqual([
      {
        raw: "$$x + y$$ {#eq:sum}",
        variant: "display-math",
      },
    ]);
  });

  it("recognizes labeled backslash display math consistently with import", () => {
    expect(collectSourceBlockRanges("Before\n\n\\[\nx + y\n\\] {#eq:sum}\n\nAfter").map((range) => ({
      raw: range.raw,
      variant: range.variant,
    }))).toEqual([
      {
        raw: "\\[\nx + y\n\\] {#eq:sum}",
        variant: "display-math",
      },
    ]);
    expect(collectSourceBlockRanges("Before\n\n\\[x + y\\] {#eq:sum}\n\nAfter").map((range) => ({
      raw: range.raw,
      variant: range.variant,
    }))).toEqual([
      {
        raw: "\\[x + y\\] {#eq:sum}",
        variant: "display-math",
      },
    ]);
  });

  it("keeps longer fenced divs whole when they contain shorter nested fences", () => {
    const markdown = [
      ':::: {.theorem title="Outer"}',
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

  it("does not recognize non-canonical single-line fenced divs", () => {
    expect(collectSourceBlockRanges("::: {.theorem} Short statement. :::")).toEqual([]);
    expect(collectSourceBlockRanges("::: {.theorem #thm:a} Legacy title\nBody\n:::")).toEqual([]);
    expect(collectSourceBlockRanges(":::\nBody\n:::")).toEqual([]);
  });

  it("exposes shared markdown-expansion start-line matchers", () => {
    expect(matchFencedDivStartLine("::: {.theorem}", { requireHeader: true })?.[1]).toBe(":::");
    expect(matchFencedDivStartLine("::: {.theorem} Legacy")).toBeNull();
    expect(matchFencedDivStartLine(":::", { requireHeader: true })).toBeNull();
    expect(isDisplayMathDollarExpansionLine("$$")).toBe(true);
    expect(isDisplayMathDollarExpansionLine("$$x + y$$")).toBe(false);
    expect(isDisplayMathBracketExpansionLine("\\[")).toBe(true);
    expect(isDisplayMathBracketExpansionLine("\\[x + y\\]")).toBe(false);
  });
});
