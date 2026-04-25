import { describe, expect, it } from "vitest";

import { createEditorSessionState } from "./editor-session-model";
import {
  hasDirtySessionDocument,
  isSessionPathDirty,
  setSessionPathDirty,
} from "./editor-session-dirty-state";

function document(path: string, dirty = false) {
  return {
    path,
    name: path,
    dirty,
  };
}

describe("editor session dirty state", () => {
  it("owns dirty reads and writes for the active session document", () => {
    const state = createEditorSessionState(document("draft.md"));

    const dirty = setSessionPathDirty(state, "draft.md", true);

    expect(hasDirtySessionDocument(dirty)).toBe(true);
    expect(isSessionPathDirty(dirty, "draft.md")).toBe(true);
    expect(isSessionPathDirty(dirty, "other.md")).toBe(false);
  });

  it("ignores stale dirty writes for inactive paths", () => {
    const state = createEditorSessionState(document("draft.md"));

    const next = setSessionPathDirty(state, "other.md", true);

    expect(next).toBe(state);
    expect(hasDirtySessionDocument(next)).toBe(false);
  });
});
