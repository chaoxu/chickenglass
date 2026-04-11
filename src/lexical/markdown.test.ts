import { $isCodeHighlightNode, $isCodeNode, registerCodeHighlighting } from "@lexical/code";
import { $getRoot } from "lexical";
import { describe, expect, it } from "vitest";

import {
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
  roundTripMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isTableNode } from "./nodes/table-node";

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

  it("tokenizes fenced code blocks into highlighted code nodes", () => {
    const editor = createHeadlessCoflatEditor();
    const unregister = registerCodeHighlighting(editor);
    const markdown = [
      "```ts",
      "const total = lines.length + 1;",
      "```",
    ].join("\n");

    try {
      setLexicalMarkdown(editor, markdown);
      expect(getLexicalMarkdown(editor)).toBe(markdown);
      const highlightTypes = editor.getEditorState().read(() => {
        const root = $getRoot();
        const codeNode = root.getFirstChild();
        if (!$isCodeNode(codeNode)) {
          return null;
        }
        return codeNode
          .getChildren()
          .filter($isCodeHighlightNode)
          .map((node) => node.getHighlightType())
          .filter((type): type is string => typeof type === "string");
      });

      expect(highlightTypes).not.toBeNull();
      expect(highlightTypes).toContain("keyword");
      expect(highlightTypes).toContain("operator");
      expect(highlightTypes).toContain("number");
    } finally {
      unregister();
    }
  });

  it("imports markdown tables as native table nodes instead of raw blocks", () => {
    const editor = createHeadlessCoflatEditor();
    const markdown = [
      "| Feature | Value |",
      "|:--------|------:|",
      "| `code` | [link](https://example.com) |",
      "| $x$ | [@ref] |",
    ].join("\n");

    setLexicalMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const firstChild = $getRoot().getFirstChild();
      expect($isTableNode(firstChild)).toBe(true);
      expect($isRawBlockNode(firstChild)).toBe(false);
    });

    expect(getLexicalMarkdown(editor)).toBe(markdown);
  });
});
