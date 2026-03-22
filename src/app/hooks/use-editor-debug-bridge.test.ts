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

interface DebugWindow extends Window {
  __cmView?: EditorView;
  __cmDebug?: unknown;
}

describe("useEditorDebugBridge helpers", () => {
  beforeEach(() => {
    clearDebugView();
    createDebugHelpersMock.mockClear();
  });

  it("attaches debug globals for the active view", () => {
    const view = { id: "view-a" } as unknown as EditorView;
    const debugWindow = window as unknown as DebugWindow;

    attachDebugView(view);

    expect(createDebugHelpersMock).toHaveBeenCalledWith(view);
    expect(debugWindow.__cmView).toBe(view);
    expect(debugWindow.__cmDebug).toBe(helpers);
  });

  it("only clears debug globals for the matching view", () => {
    const viewA = { id: "view-a" } as unknown as EditorView;
    const viewB = { id: "view-b" } as unknown as EditorView;
    const debugWindow = window as unknown as DebugWindow;

    attachDebugView(viewA);
    clearDebugView(viewB);
    expect(debugWindow.__cmView).toBe(viewA);

    clearDebugView(viewA);
    expect(debugWindow.__cmView).toBeUndefined();
    expect(debugWindow.__cmDebug).toBeUndefined();
  });
});
