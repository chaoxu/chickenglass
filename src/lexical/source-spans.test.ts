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
import { createSourceSpanIndex } from "./source-spans";

describe("source spans", () => {
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
      if (!$isTextNode(text)) throw new Error("expected second repeated text node");
      text.select(2, 2);
    }, { discrete: true });

    expect(readSourceSelectionFromLexicalSelection(editor, { markdown: doc })).toEqual({
      anchor: doc.lastIndexOf("same") + 2,
      focus: doc.lastIndexOf("same") + 2,
      from: doc.lastIndexOf("same") + 2,
      to: doc.lastIndexOf("same") + 2,
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
