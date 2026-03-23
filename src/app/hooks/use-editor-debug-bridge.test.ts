import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

const { helpers, createDebugHelpersMock } = vi.hoisted(() => {
  const debugHelpers = {
    tree: vi.fn(),
    treeString: vi.fn(),
    fences: vi.fn(),
    line: vi.fn(),
    dump: vi.fn(),
    toggleTreeView: vi.fn(),
  };

  return {
    helpers: debugHelpers,
    createDebugHelpersMock: vi.fn(() => debugHelpers),
  };
});

vi.mock("../../editor/debug-helpers", () => ({
  createDebugHelpers: createDebugHelpersMock,
}));

import { attachDebugView, clearDebugView } from "./use-editor-debug-bridge";

describe("useEditorDebugBridge helpers", () => {
  beforeEach(() => {
    clearDebugView();
    createDebugHelpersMock.mockClear();
  });

  it("attaches debug globals for the active view", () => {
    const view = { id: "view-a" } as unknown as EditorView;

    attachDebugView(view);

    expect(createDebugHelpersMock).toHaveBeenCalledWith(view);
    expect(window.__cmView).toBe(view);
    expect(window.__cmDebug).toBe(helpers);
  });

  it("only clears debug globals for the matching view", () => {
    const viewA = { id: "view-a" } as unknown as EditorView;
    const viewB = { id: "view-b" } as unknown as EditorView;

    attachDebugView(viewA);
    clearDebugView(viewB);
    expect(window.__cmView).toBe(viewA);

    clearDebugView(viewA);
    expect(window.__cmView).toBeUndefined();
    expect(window.__cmDebug).toBeUndefined();
  });
});
