import { describe, expect, it } from "vitest";

import type { Tab } from "./tab-bar";
import {
  activateSessionTab,
  closeSessionTab,
  closeSessionTabs,
  markSessionTabDirty,
  openSessionTab,
  pinSessionTab,
  renameSessionTab,
  reorderSessionTabs,
} from "./editor-session-actions";
import { createEditorSessionState } from "./editor-session-model";

function tab(path: string, overrides: Partial<Tab> = {}): Tab {
  return {
    path,
    name: path,
    dirty: false,
    preview: false,
    ...overrides,
  };
}

describe("editor session actions", () => {
  it("keeps at most one preview tab by replacing the existing preview slot", () => {
    const state = createEditorSessionState([
      tab("a.md"),
      tab("b.md", { preview: true }),
    ], "b.md");

    const next = openSessionTab(state, tab("c.md", { preview: true }));

    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[1].path).toBe("c.md");
    expect(next.tabs.filter((entry) => entry.preview)).toHaveLength(1);
    expect(next.activePath).toBe("c.md");
  });

  it("pins a preview tab when it becomes dirty", () => {
    const state = createEditorSessionState([
      tab("draft.md", { preview: true }),
    ], "draft.md");

    const next = markSessionTabDirty(state, "draft.md", true);

    expect(next.tabs[0].dirty).toBe(true);
    expect(next.tabs[0].preview).toBe(false);
  });

  it("pins an existing preview tab when reopened persistently", () => {
    const state = createEditorSessionState([
      tab("draft.md", { preview: true }),
    ], "draft.md");

    const next = openSessionTab(state, tab("draft.md"));

    expect(next.tabs[0].preview).toBe(false);
    expect(next.activePath).toBe("draft.md");
  });

  it("renames the active path atomically", () => {
    const state = createEditorSessionState([
      tab("old.md"),
      tab("other.md"),
    ], "old.md");

    const next = renameSessionTab(state, "old.md", "new.md", "new.md");

    expect(next.activePath).toBe("new.md");
    expect(next.tabs[0].path).toBe("new.md");
  });

  it("chooses the next active tab deterministically on close", () => {
    const state = createEditorSessionState([
      tab("a.md"),
      tab("b.md"),
      tab("c.md"),
    ], "b.md");

    const next = closeSessionTab(state, "b.md");

    expect(next.tabs.map((entry) => entry.path)).toEqual(["a.md", "c.md"]);
    expect(next.activePath).toBe("c.md");
  });

  it("keeps the current active tab when closing a different tab", () => {
    const state = createEditorSessionState([
      tab("a.md"),
      tab("b.md"),
    ], "b.md");

    const next = closeSessionTab(state, "a.md");

    expect(next.activePath).toBe("b.md");
  });

  it("keeps active path stable across reorders", () => {
    const state = createEditorSessionState([
      tab("a.md"),
      tab("b.md"),
      tab("c.md"),
    ], "b.md");

    const next = reorderSessionTabs(state, [
      tab("c.md"),
      tab("a.md"),
      tab("b.md"),
    ]);

    expect(next.tabs.map((entry) => entry.path)).toEqual(["c.md", "a.md", "b.md"]);
    expect(next.activePath).toBe("b.md");
  });

  it("can activate an already-open tab explicitly", () => {
    const state = createEditorSessionState([
      tab("a.md"),
      tab("b.md"),
    ], "a.md");

    const next = activateSessionTab(state, "b.md");

    expect(next.activePath).toBe("b.md");
  });

  it("pins preview tabs explicitly", () => {
    const state = createEditorSessionState([
      tab("draft.md", { preview: true }),
    ], "draft.md");

    const next = pinSessionTab(state, "draft.md");

    expect(next.tabs[0].preview).toBe(false);
  });

  it("closes multiple affected tabs with a stable fallback active tab", () => {
    const state = createEditorSessionState([
      tab("folder/a.md"),
      tab("folder/b.md"),
      tab("keep.md"),
    ], "folder/a.md");

    const next = closeSessionTabs(state, new Set(["folder/a.md", "folder/b.md"]));

    expect(next.tabs.map((entry) => entry.path)).toEqual(["keep.md"]);
    expect(next.activePath).toBe("keep.md");
  });
});
