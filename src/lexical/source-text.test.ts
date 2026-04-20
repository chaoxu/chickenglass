import { createHeadlessEditor } from "@lexical/headless";
import { describe, expect, it } from "vitest";

import {
  getSourceTextSelection,
  setSourceText,
  setSourceTextSelection,
} from "./source-text";

function createHeadlessSourceTextEditor() {
  return createHeadlessEditor({
    namespace: "coflat-source-text-test",
    onError(error: Error) {
      throw error;
    },
    nodes: [],
  });
}

describe("source-text lexical selection bridge", () => {
  it("reads a range selection after replacing the whole document", () => {
    const editor = createHeadlessSourceTextEditor();

    setSourceText(editor, "Alpha Beta\n");
    setSourceTextSelection(editor, 6, 10);
    setSourceText(editor, "Alpha **Beta**\n");
    setSourceTextSelection(editor, 8, 12);

    expect(getSourceTextSelection(editor)).toEqual({
      anchor: 8,
      focus: 12,
      from: 8,
      to: 12,
    });
  });

  it("reads the end-of-document caret without throwing", () => {
    const editor = createHeadlessSourceTextEditor();

    setSourceText(editor, "Alpha\nBeta\n");
    setSourceTextSelection(editor, "Alpha\nBeta\n".length);

    expect(getSourceTextSelection(editor)).toEqual({
      anchor: 11,
      focus: 11,
      from: 11,
      to: 11,
    });
  });
});
