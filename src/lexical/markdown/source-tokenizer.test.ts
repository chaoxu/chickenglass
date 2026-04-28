import { describe, expect, it } from "vitest";

import {
  parseMarkdownSourceTokens,
  type ParsedSourceRevealToken,
} from "./source-tokenizer";

function referenceSources(markdown: string): string[] {
  return parseMarkdownSourceTokens(markdown)
    .filter((token): token is ParsedSourceRevealToken =>
      token.kind === "reveal" && token.adapterId === "reference")
    .map((token) => token.source);
}

function revealSources(markdown: string): string[] {
  return parseMarkdownSourceTokens(markdown)
    .filter((token): token is ParsedSourceRevealToken => token.kind === "reveal")
    .map((token) => token.source);
}

describe("parseMarkdownSourceTokens", () => {
  it("tokenizes table cells with pipes inside math and code spans", () => {
    const markdown = [
      "| Kind | Value |",
      "|---|---|",
      "| dollar | $a | b$ |",
      "| paren | \\(a \\| b\\) |",
      "| code | `a | b` |",
    ].join("\n");

    const tokens = parseMarkdownSourceTokens(markdown);
    const dollarSource = "$a | b$";
    const dollarFrom = markdown.indexOf(dollarSource);
    const parenSource = "\\(a \\| b\\)";
    const parenFrom = markdown.indexOf(parenSource);
    const codeSource = "`a | b`";
    const codeFrom = markdown.indexOf(codeSource);
    const codeTextFrom = codeFrom + 1;

    expect(tokens).toContainEqual({
      adapterId: "inline-math",
      from: dollarFrom,
      kind: "reveal",
      source: dollarSource,
      to: dollarFrom + dollarSource.length,
    });
    expect(tokens).toContainEqual({
      adapterId: "inline-math",
      from: parenFrom,
      kind: "reveal",
      source: parenSource,
      to: parenFrom + parenSource.length,
    });
    expect(tokens).toContainEqual({
      formatSource: {
        from: codeFrom,
        source: codeSource,
        to: codeFrom + codeSource.length,
      },
      formats: ["code"],
      from: codeTextFrom,
      kind: "text",
      source: "a | b",
      text: "a | b",
      to: codeTextFrom + "a | b".length,
    });
  });

  it("tokenizes references with the shared grammar", () => {
    expect(referenceSources(
      "See @sec:intro/motivation, @o'brien2020, [@thm:main; @eq:sum; @fig:plot], [@doe2020, p. 12; @roe2021, ch. 3], @fig:plot. and @sec:results:.",
    )).toEqual([
      "@sec:intro/motivation",
      "@o'brien2020",
      "[@thm:main; @eq:sum; @fig:plot]",
      "[@doe2020, p. 12; @roe2021, ch. 3]",
      "@fig:plot",
      "@sec:results",
    ]);
  });

  it("does not reveal narrative references inside malformed bracket clusters", () => {
    expect(referenceSources("No [see @id] or [@id; see @other], yes [@id].")).toEqual([
      "[@id]",
    ]);
  });

  it("tokenizes inline reveal sources through the shared model", () => {
    const markdown = "See [**rich** link](<https://example.com/a b> 'title'), $x$, [^n], and @sec:intro.";

    expect(revealSources(markdown)).toEqual([
      "[**rich** link](<https://example.com/a b> 'title')",
      "$x$",
      "[^n]",
      "@sec:intro",
    ]);
  });
});
