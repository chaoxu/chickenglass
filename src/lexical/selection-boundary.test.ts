import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  ParagraphNode,
  TextNode,
} from "lexical";

import { $createInlineMathNode, $isInlineMathNode, InlineMathNode } from "./nodes/inline-math-node";
import {
  $findAdjacentNodeAtSelectionBoundary,
  $findAdjacentTopLevelSiblingFromSelection,
} from "./selection-boundary";

function createSelectionBoundaryTestEditor() {
  return createHeadlessEditor({
    namespace: "coflat-selection-boundary-test",
    nodes: [ParagraphNode, TextNode, InlineMathNode],
    onError(error) {
      throw error;
    },
  });
}

describe("selection boundary helpers", () => {
  it("finds adjacent inline nodes from a text boundary", () => {
    const editor = createSelectionBoundaryTestEditor();
    let matchedKey: string | null = null;
    let expectedKey = "";

    editor.update(() => {
      const root = $getRoot();
      const paragraph = new ParagraphNode();
      const before = new TextNode("before");
      const math = $createInlineMathNode("$x$", "dollar");
      expectedKey = math.getKey();
      paragraph.append(before, math, new TextNode("after"));
      root.append(paragraph);

      before.selectEnd();
      matchedKey = $findAdjacentNodeAtSelectionBoundary(false, $isInlineMathNode)?.getKey() ?? null;
    }, { discrete: true });

    expect(matchedKey).toBe(expectedKey);
  });

  it("finds adjacent inline nodes from an element boundary", () => {
    const editor = createSelectionBoundaryTestEditor();
    let matchedKey: string | null = null;
    let expectedKey = "";

    editor.update(() => {
      const root = $getRoot();
      const paragraph = new ParagraphNode();
      const math = $createInlineMathNode("$x$", "dollar");
      expectedKey = math.getKey();
      paragraph.append(new TextNode("before"), math, new TextNode("after"));
      root.append(paragraph);

      const selection = $createRangeSelection();
      selection.anchor.set(paragraph.getKey(), 1, "element");
      selection.focus.set(paragraph.getKey(), 1, "element");
      $setSelection(selection);

      matchedKey = $findAdjacentNodeAtSelectionBoundary(false, $isInlineMathNode)?.getKey() ?? null;
    }, { discrete: true });

    expect(matchedKey).toBe(expectedKey);
  });

  it("returns null when the caret is not on the requested boundary", () => {
    const editor = createSelectionBoundaryTestEditor();
    let matchedKey: string | null = null;

    editor.update(() => {
      const root = $getRoot();
      const paragraph = new ParagraphNode();
      const before = new TextNode("before");
      paragraph.append(before, $createInlineMathNode("$x$", "dollar"));
      root.append(paragraph);

      before.select(2, 2);
      matchedKey = $findAdjacentNodeAtSelectionBoundary(false, $isInlineMathNode)?.getKey() ?? null;
    }, { discrete: true });

    expect(matchedKey).toBeNull();
  });

  it("finds adjacent top-level decorator siblings from the current block", () => {
    const editor = createSelectionBoundaryTestEditor();
    let matchedKey: string | null = null;
    let expectedKey = "";

    editor.update(() => {
      const root = $getRoot();
      const paragraph = new ParagraphNode();
      const before = new TextNode("before");
      paragraph.append(before);

      const nextParagraph = new ParagraphNode();
      nextParagraph.append(new TextNode("after"));

      const blockDecorator = $createInlineMathNode("$x$", "dollar");
      expectedKey = blockDecorator.getKey();
      root.append(paragraph, blockDecorator, nextParagraph);

      before.selectEnd();
      matchedKey = $findAdjacentTopLevelSiblingFromSelection("forward", $isInlineMathNode)?.getKey() ?? null;
    }, { discrete: true });

    expect(matchedKey).toBe(expectedKey);
  });
});
