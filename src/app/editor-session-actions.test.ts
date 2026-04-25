import { describe, expect, it } from "vitest";

import {
  clearExternalDocumentConflict,
  clearSessionDocument,
  renameSessionDocument,
  setCurrentSessionDocument,
  setExternalDocumentConflict,
} from "./editor-session-actions";
import { setSessionPathDirty } from "./editor-session-dirty-state";
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
    const state = createEditorSessionState(null, { kind: "modified", path: "draft.md" });

    const next = setCurrentSessionDocument(state, document("draft.md"));

    expect(next.currentDocument).toEqual(document("draft.md"));
    expect(next.externalConflict).toEqual({ kind: "modified", path: "draft.md" });
  });

  it("marks the current document dirty when paths match", () => {
    const state = createEditorSessionState(document("draft.md"), {
      kind: "modified",
      path: "draft.md",
    });

    const next = setSessionPathDirty(state, "draft.md", true);

    expect(next.currentDocument).toEqual(document("draft.md", true));
    expect(next.externalConflict).toEqual({ kind: "modified", path: "draft.md" });
  });

  it("ignores dirty updates for a different path", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = setSessionPathDirty(state, "other.md", true);

    expect(next).toBe(state);
  });

  it("renames the current document atomically and clears a conflict on the old path", () => {
    const state = createEditorSessionState(document("old.md", true), {
      kind: "modified",
      path: "old.md",
    });

    const next = renameSessionDocument(state, "old.md", "new.md", "new.md");

    expect(next.currentDocument).toEqual({
      path: "new.md",
      name: "new.md",
      dirty: true,
    });
    expect(next.externalConflict).toBeNull();
  });

  it("clears the current document", () => {
    const state = createEditorSessionState(document("draft.md"), {
      kind: "modified",
      path: "draft.md",
    });

    const next = clearSessionDocument(state, "draft.md");

    expect(next.currentDocument).toBeNull();
    expect(next.externalConflict).toBeNull();
  });

  it("does not clear a different document path", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = clearSessionDocument(state, "other.md");

    expect(next).toBe(state);
  });

  it("sets an external document conflict", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = setExternalDocumentConflict(state, { kind: "modified", path: "draft.md" });

    expect(next.externalConflict).toEqual({ kind: "modified", path: "draft.md" });
    expect(next.currentDocument).toEqual(document("draft.md"));
  });

  it("clears an external document conflict by path", () => {
    const state = createEditorSessionState(document("draft.md"), {
      kind: "modified",
      path: "draft.md",
    });

    const next = clearExternalDocumentConflict(state, "draft.md");

    expect(next.externalConflict).toBeNull();
    expect(next.currentDocument).toEqual(document("draft.md"));
  });

  it("does not clear an external document conflict for another path", () => {
    const state = createEditorSessionState(document("draft.md"), {
      kind: "modified",
      path: "draft.md",
    });

    const next = clearExternalDocumentConflict(state, "other.md");

    expect(next).toBe(state);
  });
});
