import { describe, expect, it } from "vitest";

import {
  applyEditorDocumentChanges,
  createEditorDocumentText,
  editorDocumentToString,
} from "./editor-doc-change";

describe("editor-doc-change", () => {
  it("applies sorted document changes without flattening the whole doc first", () => {
    const doc = createEditorDocumentText("alpha\nbeta\ngamma");

    const next = applyEditorDocumentChanges(doc, [
      { from: 0, to: 5, insert: "Alpha" },
      { from: 6, to: 10, insert: "Beta!" },
      { from: 16, to: 16, insert: "\nomega" },
    ]);

    expect(editorDocumentToString(next)).toBe("Alpha\nBeta!\ngamma\nomega");
  });

  it("round-trips empty strings and trailing newlines exactly", () => {
    expect(editorDocumentToString(createEditorDocumentText(""))).toBe("");
    expect(editorDocumentToString(createEditorDocumentText("line\n"))).toBe("line\n");
    expect(editorDocumentToString(createEditorDocumentText("\n"))).toBe("\n");
  });
});
