import { $isCodeHighlightNode, $isCodeNode, registerCodeHighlighting } from "@lexical/code";
import type { ElementTransformer } from "@lexical/markdown";
import { QuoteNode } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type LexicalNode,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  coflatMarkdownTransformers,
  createHeadlessCoflatEditor,
  getLexicalMarkdown,
  roundTripMarkdown,
  setLexicalMarkdown,
} from "./markdown";
import { $isHeadingAttributeNode } from "./nodes/heading-attribute-node";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { $isReferenceNode } from "./nodes/reference-node";
import { $isTableNode } from "./nodes/table-node";

function collectReferenceRaws(node: LexicalNode, raws: string[] = []): string[] {
  if ($isReferenceNode(node)) {
    raws.push(node.getRaw());
    return raws;
  }
  if ($isElementNode(node)) {
    for (const child of node.getChildren()) {
      collectReferenceRaws(child, raws);
    }
  }
  return raws;
}

function importedReferenceRaws(markdown: string): string[] {
  const editor = createHeadlessCoflatEditor();
  setLexicalMarkdown(editor, markdown);
  return editor.getEditorState().read(() => collectReferenceRaws($getRoot()));
}

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

  it("imports frontmatter as a structured raw block", () => {
    const editor = createHeadlessCoflatEditor();
    const markdown = [
      "---",
      "title: Test Document",
      "---",
      "",
      "# Intro",
    ].join("\n");

    setLexicalMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const firstChild = $getRoot().getFirstChild();
      expect($isRawBlockNode(firstChild)).toBe(true);
      if (!$isRawBlockNode(firstChild)) {
        return;
      }
      expect(firstChild.getVariant()).toBe("frontmatter");
      expect(firstChild.getRaw()).toBe(["---", "title: Test Document", "---"].join("\n"));
    });

    expect(getLexicalMarkdown(editor)).toBe(markdown);
  });

  it("round-trips inline math in both supported delimiter styles", () => {
    const markdown = "Inline $e^{i\\pi}+1=0$ and \\(x^2 + y^2\\).";
    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips Pandoc dollar math delimiter edge cases", () => {
    const cases = [
      "Costs are $20 and $30 today.",
      "Spaced dollars stay literal: $ x$ and $x $.",
      "Escaped dollars stay literal: \\$x$.",
      "Even escaped backslashes still allow math: \\\\$x$.",
      "Valid tight math stays math: $x_1 + y$.",
    ];

    for (const markdown of cases) {
      expect(roundTripMarkdown(markdown)).toBe(markdown);
    }
  });

  it("round-trips inline math inside formatted text spans", () => {
    const markdown = "A **$k$-hitting set** and *\\(x\\)-axis*.";
    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips citations and footnote refs inside formatted text spans", () => {
    const markdown = "**[@cormen2009] reference** and *[^note] footnote*.";
    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("imports reference tokens with the shared grammar", () => {
    const markdown =
      "See @sec:intro/motivation, @o'brien2020, [@thm:main; @eq:sum; @fig:plot], [@doe2020, p. 12; @roe2021, ch. 3], @fig:plot. and @sec:results:.";

    expect(importedReferenceRaws(markdown)).toEqual([
      "@sec:intro/motivation",
      "@o'brien2020",
      "[@thm:main; @eq:sum; @fig:plot]",
      "[@doe2020, p. 12; @roe2021, ch. 3]",
      "@fig:plot",
      "@sec:results",
    ]);
    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("does not import narrative references inside malformed bracket clusters", () => {
    const markdown = "No [see @id] or [@id; see @other], yes [@id].";

    expect(importedReferenceRaws(markdown)).toEqual(["[@id]"]);
    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips raw LaTeX equation blocks with labels", () => {
    const markdown = [
      "\\begin{equation}\\label{eq:gaussian}",
      "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
      "\\end{equation}",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips canonical pandoc-crossref equation labels", () => {
    const markdown = [
      "$$",
      "\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}",
      "$$ {#eq:gaussian}",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("round-trips fenced div blocks verbatim", () => {
    const markdown = [
      '::::: {#thm:main .theorem title="Main Result"}',
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

  it("keeps a blank line between an exited list and following paragraph", () => {
    const markdown = [
      "- one",
      "- two",
      "",
      "after",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("does not inject blank lines before source-owned display math inside lists", () => {
    const markdown = [
      "1. First item with inline math $O(n \\log n)$",
      "2. Display math in list:",
      "   $$",
      "   T(n) = 2T(n/2) + O(n)",
      "   $$",
      "3. Backslash display math in list:",
      "   \\[",
      "   f(x) = \\sum_{i=0}^n a_i x^i",
      "   \\]",
      "4. Simple text item",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("normalizes imported blank separators before source-owned blocks inside lists", () => {
    const markdown = [
      "1. First item",
      "2. Display math in list:",
      "",
      "   $$",
      "   T(n) = 2T(n/2) + O(n)",
      "   $$",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe([
      "1. First item",
      "2. Display math in list:",
      "   $$",
      "   T(n) = 2T(n/2) + O(n)",
      "   $$",
    ].join("\n"));
  });

  it("does not inject list separators inside fenced code blocks", () => {
    const markdown = [
      "```",
      "- not a list item",
      "next code line",
      "```",
      "",
      "after",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
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

  it("round-trips table cells with pipes inside math and code spans", () => {
    const markdown = [
      "| Dollar | Paren | Code |",
      "|---|---|---|",
      "| $a | b$ | \\(a \\| b\\) | `a | b` |",
    ].join("\n");

    expect(roundTripMarkdown(markdown)).toBe(markdown);
  });

  it("preserves pandoc grid tables as source-owned table blocks", () => {
    const editor = createHeadlessCoflatEditor();
    const markdown = [
      "+-------+------------------+",
      "| Input | Output           |",
      "+=======+==================+",
      "| graph | first paragraph  |",
      "|       |                  |",
      "|       | second paragraph |",
      "+-------+------------------+",
    ].join("\n");

    setLexicalMarkdown(editor, markdown);

    editor.getEditorState().read(() => {
      const firstChild = $getRoot().getFirstChild();
      expect($isRawBlockNode(firstChild)).toBe(true);
      if (!$isRawBlockNode(firstChild)) {
        return;
      }
      expect(firstChild.getVariant()).toBe("grid-table");
    });

    expect(getLexicalMarkdown(editor)).toBe(markdown);
  });

  it("imports legacy line blockquotes but exports canonical fenced blockquotes", () => {
    expect(roundTripMarkdown("> Quoted $x$ and [@sec:intro].")).toBe([
      "::: {.blockquote}",
      "Quoted $x$ and [@sec:intro].",
      ":::",
    ].join("\n"));
  });

  it("keeps the legacy line blockquote transformer import-only for shortcuts", () => {
    const quoteTransformer = coflatMarkdownTransformers.find(
      (transformer): transformer is ElementTransformer =>
        transformer.type === "element"
        && transformer.dependencies.includes(QuoteNode)
        && transformer.regExp.test("> "),
    );
    expect(quoteTransformer).toBeDefined();

    const editor = createHeadlessCoflatEditor();
    editor.update(() => {
      expect(quoteTransformer?.replace($createParagraphNode(), [], ["> "], false)).toBe(false);
    }, { discrete: true });
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
