import { describe, expect, it } from "vitest";

import {
  clearSessionDocument,
  markSessionDocumentDirty,
  renameSessionDocument,
  setCurrentSessionDocument,
} from "./editor-session-actions";
import { createEditorSessionState } from "./editor-session-model";

function document(path: string, dirty = false) {
  return {
    path,
    name: path,
    dirty,
  };
}

describe("editor session actions", () => {
  it("sets the current document", () => {
    const state = createEditorSessionState();

    const next = setCurrentSessionDocument(state, document("draft.md"));

    expect(next.currentDocument).toEqual(document("draft.md"));
  });

  it("marks the current document dirty when paths match", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = markSessionDocumentDirty(state, "draft.md", true);

    expect(next.currentDocument).toEqual(document("draft.md", true));
  });

  it("ignores dirty updates for a different path", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = markSessionDocumentDirty(state, "other.md", true);

    expect(next).toBe(state);
  });

  it("renames the current document atomically", () => {
    const state = createEditorSessionState(document("old.md", true));

    const next = renameSessionDocument(state, "old.md", "new.md", "new.md");

    expect(next.currentDocument).toEqual({
      path: "new.md",
      name: "new.md",
      dirty: true,
    });
  });

  it("clears the current document", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = clearSessionDocument(state, "draft.md");

    expect(next.currentDocument).toBeNull();
  });

  it("does not clear a different document path", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = clearSessionDocument(state, "other.md");

    expect(next).toBe(state);
  });
});
