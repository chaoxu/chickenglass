import { $isCodeHighlightNode, $isCodeNode, registerCodeHighlighting } from "@lexical/code";
import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
  roundTripMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import { $isHeadingAttributeNode } from "./nodes/heading-attribute-node";
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

  it("keeps Pandoc heading attributes as source-owned heading chrome", () => {
    const editor = createHeadlessCoflatEditor();
    const markdown = "# Intro {#sec:intro}";

    setLexicalMarkdown(editor, markdown);

    const headingAttributeRaw = editor.getEditorState().read(() => {
      const heading = $getRoot().getFirstChild();
      if (!$isElementNode(heading)) {
        return null;
      }
      const suffix = heading.getLastChild();
      return $isHeadingAttributeNode(suffix) ? suffix.getRaw() : null;
    });

    expect(headingAttributeRaw).toBe(" {#sec:intro}");
    expect(getLexicalMarkdown(editor)).toBe(markdown);
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

  it("serializes visible table-cell line breaks as pipe-table br markers", () => {
    const editor = createHeadlessCoflatEditor();
    const markdown = [
      "| Case | Notes |",
      "|------|-------|",
      "| A | one |",
    ].join("\n");

    setLexicalMarkdown(editor, markdown);
    editor.update(() => {
      const table = $getRoot().getFirstChild();
      if (!$isTableNode(table)) {
        throw new Error("expected table node");
      }
      const row = table.getChildAtIndex(1);
      if (!$isElementNode(row)) {
        throw new Error("expected table row");
      }
      const cell = row.getChildAtIndex(1);
      if (!$isElementNode(cell)) {
        throw new Error("expected table cell");
      }
      const paragraph = cell.getFirstChild();
      if (!$isElementNode(paragraph)) {
        throw new Error("expected table cell paragraph");
      }
      paragraph.clear();
      paragraph.append(
        $createTextNode("first line"),
        $createLineBreakNode(),
        $createTextNode("second line"),
      );
    }, { discrete: true });

    expect(getLexicalMarkdown(editor)).toBe([
      "| Case | Notes |",
      "|------|-------|",
      "| A | first line<br>second line |",
    ].join("\n"));
  });

  it("imports pipe-table br markers as visible table-cell line breaks", () => {
    const markdown = [
      "| Case | Notes |",
      "|------|-------|",
      "| A | first line<br>second line |",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("preserves literal br text in table-cell code spans", () => {
    const markdown = [
      "| Case | Notes |",
      "|------|-------|",
      "| A | `<br>` and first line<br>second line |",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("imports inline markdown formats as native formatted text nodes", () => {
    const editor = createHeadlessCoflatEditor();
    const markdown = "**Bold** *italic* ~~strike~~ ==highlight== `code`";

    setLexicalMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const textNodes = $getRoot().getAllTextNodes();
      expect(textNodes.some((node) => node.getType() === "coflat-inline-format-source")).toBe(false);
      expect(textNodes.some((node) => node.getTextContent() === "Bold" && node.hasFormat("bold"))).toBe(true);
      expect(textNodes.some((node) => node.getTextContent() === "italic" && node.hasFormat("italic"))).toBe(true);
      expect(textNodes.some((node) => node.getTextContent() === "strike" && node.hasFormat("strikethrough"))).toBe(true);
      expect(textNodes.some((node) => node.getTextContent() === "highlight" && node.hasFormat("highlight"))).toBe(true);
      expect(textNodes.some((node) => node.getTextContent() === "code" && node.hasFormat("code"))).toBe(true);
    });

    expect(getLexicalMarkdown(editor)).toBe(markdown);
  });
});
