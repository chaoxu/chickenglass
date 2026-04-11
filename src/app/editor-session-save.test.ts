import { describe, expect, it } from "vitest";

import {
  createEditorDocumentText,
  editorDocumentToString,
  emptyEditorDocument,
} from "../lib/editor-doc-change";
import { applySaveAsResult } from "./editor-session-save";
import { createEditorSessionState } from "./editor-session-model";

describe("applySaveAsResult", () => {
  it("renames the active session path and clears dirty state", () => {
    const buffers = new Map([["draft.md", createEditorDocumentText("new content")]]);
    const liveDocs = new Map([["draft.md", createEditorDocumentText("new content")]]);
    const state = createEditorSessionState({
      path: "draft.md",
      name: "draft.md",
      dirty: true,
    });

    const next = applySaveAsResult({
      state,
      buffers,
      liveDocs,
      oldPath: "draft.md",
      newPath: "notes/final.md",
      doc: createEditorDocumentText("new content"),
    });

    expect(next.currentDocument).toEqual({
      path: "notes/final.md",
      name: "final.md",
      dirty: false,
    });
    expect(buffers.has("draft.md")).toBe(false);
    expect(liveDocs.has("draft.md")).toBe(false);
    expect(editorDocumentToString(buffers.get("notes/final.md") ?? emptyEditorDocument)).toBe("new content");
    expect(editorDocumentToString(liveDocs.get("notes/final.md") ?? emptyEditorDocument)).toBe("new content");
  });

  it("clears dirty state when saving in place", () => {
    const buffers = new Map([["notes/final.md", createEditorDocumentText("new content")]]);
    const liveDocs = new Map([["notes/final.md", createEditorDocumentText("new content")]]);
    const state = createEditorSessionState({
      path: "notes/final.md",
      name: "final.md",
      dirty: true,
    });

    const next = applySaveAsResult({
      state,
      buffers,
      liveDocs,
      oldPath: "notes/final.md",
      newPath: "notes/final.md",
      doc: createEditorDocumentText("new content"),
    });

    expect(next.currentDocument?.dirty).toBe(false);
    expect(editorDocumentToString(buffers.get("notes/final.md") ?? emptyEditorDocument)).toBe("new content");
    expect(editorDocumentToString(liveDocs.get("notes/final.md") ?? emptyEditorDocument)).toBe("new content");
  });
});
