import { $getRoot, $isElementNode, type LexicalNode } from "lexical";
import { describe, expect, it } from "vitest";

import { createHeadlessCoflatEditor, setLexicalMarkdown } from "./markdown";
import { $isRawBlockNode } from "./nodes/raw-block-node";
import { readRawBlockSourcePosition } from "./structure-source-selection";

describe("structure source selection", () => {
  it("maps duplicate raw blocks by node span instead of raw text equality", () => {
    const raw = "::: {.theorem}\nSame\n:::";
    const doc = `${raw}\n\n${raw}`;
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, doc);

    const secondKey = editor.getEditorState().read(() => {
      const keys: string[] = [];
      const visit = (node: LexicalNode) => {
        if ($isRawBlockNode(node)) {
          keys.push(node.getKey());
          return;
        }
        if ($isElementNode(node)) {
          for (const child of node.getChildren()) visit(child);
        }
      };
      visit($getRoot());
      return keys[1];
    });

    expect(readRawBlockSourcePosition(editor, secondKey)).toBe(doc.lastIndexOf(raw));
  });
});
