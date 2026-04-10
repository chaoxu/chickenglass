import { describe, expect, it } from "vitest";

import {
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
  roundTripMarkdown,
  setLexicalMarkdown,
} from "./markdown";

describe("coflat lexical markdown", () => {
  it("round-trips frontmatter macros without doubling backslashes", () => {
    const markdown = [
      "---",
      "title: Test Document",
      "math:",
      '  \\R: "\\\\mathbb{R}"',
      "---",
      "",
      "# Intro",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips inline math in both supported delimiter styles", () => {
    const markdown = "Inline $e^{i\\pi}+1=0$ and \\(x^2 + y^2\\).";
    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips display math blocks with equation labels", () => {
    const markdown = [
      "$$",
      "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
      "$$ {#eq:gaussian}",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips fenced div blocks verbatim", () => {
    const markdown = [
      "::::: {#thm:main .theorem} Main Result",
      "Statement.",
      "",
      ":::: {.proof}",
      "Proof body with $x \\in \\R$.",
      "::::",
      ":::::",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("syncs markdown through a reusable editor instance", () => {
    const editor = createHeadlessCoflatEditor();
    const markdown = [
      "| Set | Size |",
      "|:----|-----:|",
      "| $\\R$ | 1 |",
      "",
      "- [ ] Keep task list markers",
    ].join("\n");

    setLexicalMarkdown(editor, markdown);
    expect(getLexicalMarkdown(editor)).toBe(markdown);
  });
});
