import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "@lexical/headless";
import { ParagraphNode, TextNode } from "lexical";

import { getActiveEditor, setActiveEditor } from "./active-editor-tracker";

function createTestEditor(namespace: string) {
  return createHeadlessEditor({
    namespace,
    nodes: [ParagraphNode, TextNode],
    onError(error) {
      throw error;
    },
  });
}

describe("active-editor-tracker", () => {
  it("returns null before any editor is set", () => {
    expect(getActiveEditor()).toBeNull();
  });

  it("returns the last editor that was set", () => {
    const editorA = createTestEditor("editor-a");
    const editorB = createTestEditor("editor-b");

    setActiveEditor(editorA);
    expect(getActiveEditor()).toBe(editorA);

    setActiveEditor(editorB);
    expect(getActiveEditor()).toBe(editorB);
  });
});
