import { createHeadlessEditor } from "@lexical/headless";
import { describe, expect, it } from "vitest";

import {
  getPlainTextSelection,
  setPlainText,
  setPlainTextSelection,
} from "./plain-text";

function createHeadlessPlainTextEditor() {
  return createHeadlessEditor({
    namespace: "coflat-plain-text-test",
    onError(error: Error) {
      throw error;
    },
    nodes: [],
  });
}

describe("plain-text lexical selection bridge", () => {
  it("reads a range selection after replacing the whole document", () => {
    const editor = createHeadlessPlainTextEditor();

    setPlainText(editor, "Alpha Beta\n");
    setPlainTextSelection(editor, 6, 10);
    setPlainText(editor, "Alpha **Beta**\n");
    setPlainTextSelection(editor, 8, 12);

    expect(getPlainTextSelection(editor)).toEqual({
      anchor: 8,
      focus: 12,
      from: 8,
      to: 12,
    });
  });

  it("reads the end-of-document caret without throwing", () => {
    const editor = createHeadlessPlainTextEditor();

    setPlainText(editor, "Alpha\nBeta\n");
    setPlainTextSelection(editor, "Alpha\nBeta\n".length);

    expect(getPlainTextSelection(editor)).toEqual({
      anchor: 11,
      focus: 11,
      from: 11,
      to: 11,
    });
  });
});
