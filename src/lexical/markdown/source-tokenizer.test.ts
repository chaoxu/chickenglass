import { describe, expect, it } from "vitest";

import { parseMarkdownSourceTokens } from "./source-tokenizer";

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
});
