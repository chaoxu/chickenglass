import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  type LexicalNode,
  type TextNode,
} from "lexical";
import { describe, expect, it } from "vitest";

import {
  OPEN_CURSOR_REVEAL_COMMAND,
  type CursorRevealOpenRequest,
} from "./cursor-reveal-controller";
import { createHeadlessCoflatEditor, setLexicalMarkdown } from "./markdown";
import { $isInlineMathNode } from "./nodes/inline-math-node";
import { readSourceSelectionFromLexicalSelection, selectSourceOffsetsInRichLexicalRoot } from "./source-selection";
import { createNodeSourceSpanIndex, createSourceSpanIndex } from "./source-spans";

function collectElementNodesByText(node: LexicalNode, text: string): LexicalNode[] {
  if (!$isElementNode(node)) {
    return [];
  }
  const matches: LexicalNode[] = node.getTextContent() === text ? [node] : [];
  for (const child of node.getChildren()) {
    matches.push(...collectElementNodesByText(child, text));
  }
  return matches;
}

function findFirstTextNode(node: LexicalNode): TextNode | null {
  if ($isTextNode(node)) {
    return node;
  }
  if (!$isElementNode(node)) {
    return null;
  }
  for (const child of node.getChildren()) {
    const text = findFirstTextNode(child);
    if (text) {
      return text;
    }
  }
  return null;
}

describe("source spans", () => {
  it("creates a node-scoped index shifted to global offsets for duplicate blocks", () => {
    const block = "Repeated block text";
    const doc = `${block}\n\n${block}\n\n${block}`;
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const blocks = collectElementNodesByText($getRoot(), block);
      const scopedNode = blocks[1];
      if (!scopedNode) throw new Error("expected second duplicate block node");
      const textNode = findFirstTextNode(scopedNode);
      if (!textNode) throw new Error("expected scoped block text node");

      const sourceOffset = doc.indexOf(block, block.length);
      const index = createNodeSourceSpanIndex(scopedNode, block, sourceOffset);
      const caretOffset = "Repeated ".length;
      const location = index.findNearestLocation(sourceOffset + caretOffset);

      expect(index.spans).toHaveLength(1);
      expect(index.getNodeStart(scopedNode)).toBe(sourceOffset);
      expect(index.getNodeEnd(scopedNode)).toBe(sourceOffset + block.length);
      expect(index.getTextNodeOffset(textNode, caretOffset)).toBe(sourceOffset + caretOffset);
      expect(location).toMatchObject({
        kind: "text",
        offset: caretOffset,
      });
      expect(location?.span.from).toBe(sourceOffset);
      expect(location?.span.to).toBe(sourceOffset + block.length);
    });
  });

  it("keeps scoped formatted spans global when duplicate block text appears earlier", () => {
    const block = "Repeat **same** block";
    const doc = `${block}\n\n${block}`;
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const blocks = collectElementNodesByText($getRoot(), "Repeat same block");
      const scopedNode = blocks[1];
      if (!scopedNode) throw new Error("expected second formatted duplicate block node");
      const sourceOffset = doc.lastIndexOf(block);
      const index = createNodeSourceSpanIndex(scopedNode, block, sourceOffset);

      const delimiterLocation = index.findNearestLocation(sourceOffset + block.indexOf("**"));
      expect(delimiterLocation).toMatchObject({
        adapterId: "text-format",
        kind: "reveal",
        offset: 0,
        source: "**same**",
      });
      expect(delimiterLocation?.span.from).toBe(sourceOffset + block.indexOf("**"));

      const textLocation = index.findNearestLocation(sourceOffset + block.indexOf("same") + 2);
      expect(textLocation).toMatchObject({
        kind: "text",
        offset: 2,
      });
      expect(textLocation?.span.from).toBe(sourceOffset + block.indexOf("same"));
    });
  });

  it("uses nested link-label spans before falling back to the whole link reveal", () => {
    const doc = 'Alpha [**rich** link](https://example.com/path "A title") omega.';
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const index = createSourceSpanIndex(doc);
      const labelLocation = index.findNearestLocation(doc.indexOf("rich") + 1);
      expect(labelLocation).toMatchObject({
        kind: "text",
        offset: 1,
      });
      expect(labelLocation?.kind === "text" ? labelLocation.node.getTextContent() : null).toBe("rich");

      const delimiterLocation = index.findNearestLocation(doc.indexOf("**"));
      expect(delimiterLocation).toMatchObject({
        adapterId: "text-format",
        kind: "reveal",
        offset: 0,
        source: "**rich**",
      });

      const titleLocation = index.findNearestLocation(doc.indexOf("title") + 2);
      expect(titleLocation).toMatchObject({
        adapterId: "link",
        kind: "reveal",
        offset: doc.indexOf("title") + 2 - doc.indexOf("[**rich** link]"),
        source: '[**rich** link](https://example.com/path "A title")',
      });
    });
  });

  it("maps combined formatted text through the authored delimiter span", () => {
    const doc = "Alpha _**both**_ omega.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const index = createSourceSpanIndex(doc);
      const delimiterLocation = index.findNearestLocation(doc.indexOf("_**"));
      expect(delimiterLocation).toMatchObject({
        adapterId: "text-format",
        kind: "reveal",
        offset: 0,
        source: "_**both**_",
      });

      const textLocation = index.findNearestLocation(doc.indexOf("both") + 2);
      expect(textLocation).toMatchObject({
        kind: "text",
        offset: 2,
      });
      expect(textLocation?.kind === "text" ? textLocation.node.getTextContent() : null).toBe("both");
    });
  });

  it("maps repeated visible text through the selected node span", () => {
    const doc = "- same alpha\n- same beta";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.update(() => {
      let text: TextNode | null = null;
      const visit = (node: LexicalNode) => {
        if ($isTextNode(node) && node.getTextContent().includes("same beta")) {
          text = node;
          return;
        }
        if ($isElementNode(node)) {
          for (const child of node.getChildren()) {
            visit(child);
            if (text) return;
          }
        }
      };
      visit($getRoot());
      if (text === null) throw new Error("expected second repeated text node");
      const selectedText = text as TextNode;
      selectedText.select(2, 2);
    }, { discrete: true });

    expect(readSourceSelectionFromLexicalSelection(editor, { markdown: doc })).toEqual({
      anchor: doc.lastIndexOf("same") + 2,
      focus: doc.lastIndexOf("same") + 2,
      from: doc.lastIndexOf("same") + 2,
      to: doc.lastIndexOf("same") + 2,
    });
  });

  it("maps text after an inline token inside a formatted run", () => {
    const doc = "A **$k$-hitting set** B";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const index = createSourceSpanIndex(doc);
      const mathLocation = index.findNearestLocation(doc.indexOf("$k$") + 1);
      expect(mathLocation).toMatchObject({
        adapterId: "inline-math",
        kind: "reveal",
        offset: 1,
        source: "$k$",
      });

      const textLocation = index.findNearestLocation(doc.indexOf("-hitting") + 3);
      expect(textLocation).toMatchObject({
        kind: "text",
        offset: 3,
      });
      expect(textLocation?.kind === "text" ? textLocation.node.getTextContent() : null).toBe("-hitting set");
    });
  });

  it("reads formatted text selections after preceding plain title text", () => {
    const marker = "NestedTitleEditNeedle";
    const doc = `Hover Preview Stress Test **${marker}**`;
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.update(() => {
      let text: TextNode | null = null;
      const visit = (node: LexicalNode) => {
        if ($isTextNode(node) && node.getTextContent() === marker) {
          text = node;
          return;
        }
        if ($isElementNode(node)) {
          for (const child of node.getChildren()) {
            visit(child);
            if (text) return;
          }
        }
      };
      visit($getRoot());
      if (text === null) throw new Error("expected formatted marker text node");
      const selectedText = text as TextNode;
      selectedText.select(0, marker.length);
    }, { discrete: true });

    expect(readSourceSelectionFromLexicalSelection(editor, { markdown: doc })).toEqual({
      anchor: doc.indexOf(marker),
      focus: doc.indexOf(marker) + marker.length,
      from: doc.indexOf(marker),
      to: doc.indexOf(marker) + marker.length,
    });
  });

  it("maps duplicate link labels through the selected link token", () => {
    const doc = "[same](https://one.example) and [same](https://two.example)";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const index = createSourceSpanIndex(doc);
      const location = index.findNearestLocation(doc.lastIndexOf("same") + 2);
      expect(location).toMatchObject({
        kind: "text",
        offset: 2,
      });
      expect(location?.kind === "text" ? location.node.getTextContent() : null).toBe("same");
      expect(location?.kind === "text" ? location.node.getParent()?.getTextContent() : null).toBe("same");
      expect(location?.span.from).toBe(doc.lastIndexOf("same"));
    });
  });

  it("maps inline math inside table cells from the parsed cell span", () => {
    const doc = "| H | I |\n|---|---|\n| $x$ | $x$ |";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const index = createSourceSpanIndex(doc);
      const secondMath = doc.lastIndexOf("$x$");
      const location = index.findNearestLocation(secondMath + 1);
      expect(location).toMatchObject({
        adapterId: "inline-math",
        kind: "reveal",
        offset: 1,
        source: "$x$",
      });
      expect(location?.span.from).toBe(secondMath);
    });
  });

  it("maps heading attributes through their parsed source span", () => {
    const doc = "# Intro {#sec:intro}\n\nBody\n";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const index = createSourceSpanIndex(doc);
      const location = index.findNearestLocation(doc.indexOf("sec:intro") + 4);
      expect(location).toMatchObject({
        adapterId: "heading-attribute",
        kind: "reveal",
        offset: " {#sec:".length,
        source: " {#sec:intro}",
      });
    });
  });

  it("uses importer-owned footnote definition ranges including the terminating blank", () => {
    const doc = "Alpha\n\n[^n]: Footnote body.\n\nOmega";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    editor.getEditorState().read(() => {
      const index = createSourceSpanIndex(doc);
      const location = index.findNearestLocation(doc.indexOf("Footnote body") + 3);
      expect(location).toMatchObject({
        adapterId: "raw-block",
        kind: "reveal",
        offset: "[^n]: Foo".length,
        source: "[^n]: Footnote body.\n",
      });
    });
  });

  it("opens reveal on the second identical inline token from its source span", () => {
    const doc = "First $x$ and second $x$.";
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);
    let request: CursorRevealOpenRequest | null = null;
    const unregister = editor.registerCommand(
      OPEN_CURSOR_REVEAL_COMMAND,
      (nextRequest) => {
        request = nextRequest;
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );

    try {
      const secondMathKey = editor.getEditorState().read(() => {
        const keys: string[] = [];
        const visit = (node: LexicalNode) => {
          if (!$isElementNode(node)) {
            return;
          }
          for (const child of node.getChildren()) {
            if ($isInlineMathNode(child)) {
              keys.push(child.getKey());
            }
            if ($isElementNode(child)) {
              visit(child);
            }
          }
        };
        visit($getRoot());
        return keys[1];
      });

      expect(selectSourceOffsetsInRichLexicalRoot(editor, doc, doc.lastIndexOf("$x$") + 1)).toBe(true);
      expect(request).toMatchObject({
        adapterId: "inline-math",
        caretOffset: 1,
        nodeKey: secondMathKey,
        source: "$x$",
      });
    } finally {
      unregister();
    }
  });
});
