import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
  type TextNode,
} from "lexical";
import { describe, expect, it } from "vitest";

import { createHeadlessCoflatEditor, setLexicalMarkdown } from "./markdown";
import {
  $findVisibleTextLocation,
  $getVisibleTextLength,
  $getVisibleTextOffset,
} from "./visible-source-traversal";

function findTextNode(root: LexicalNode, text: string): TextNode {
  const visit = (node: LexicalNode): TextNode | null => {
    if ($isTextNode(node) && node.getTextContent() === text) {
      return node;
    }
    if (!$isElementNode(node)) {
      return null;
    }
    for (const child of node.getChildren()) {
      const found = visit(child);
      if (found) {
        return found;
      }
    }
    return null;
  };

  const found = visit(root);
  if (!found) {
    throw new Error(`Text node not found: ${text}`);
  }
  return found;
}

describe("visible source traversal", () => {
  it("maps visible offsets through formatted text", () => {
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, "alpha **beta** gamma");

    editor.getEditorState().read(() => {
      const root = $getRoot();
      const beta = findTextNode(root, "beta");
      expect($getVisibleTextOffset(root, beta, 2)).toBe("alpha be".length);

      const location = $findVisibleTextLocation(root, "alpha be".length, "backward");
      expect(location?.node.getTextContent()).toBe("beta");
      expect(location?.offset).toBe(2);
    });
  });

  it("reports the same visible length Lexical exposes for the root", () => {
    const editor = createHeadlessCoflatEditor();
    setLexicalMarkdown(editor, "alpha $x$ [@doe] gamma");

    editor.getEditorState().read(() => {
      const root = $getRoot();
      expect($getVisibleTextLength(root)).toBe(root.getTextContent().length);
    });
  });
});
