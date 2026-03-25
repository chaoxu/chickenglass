import { act, createElement, type FC, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockEditorView } from "../../test-utils";

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

import {
  attachDebugView,
  clearDebugView,
  useEditorDebugBridge,
} from "./use-editor-debug-bridge";

describe("useEditorDebugBridge helpers", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    clearDebugView();
    createDebugHelpersMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("attaches debug globals for the active view", () => {
    const view = createMockEditorView();

    attachDebugView(view);

    expect(createDebugHelpersMock).toHaveBeenCalledWith(view);
    expect(window.__cmView).toBe(view);
    expect(window.__cmDebug).toBe(helpers);
  });

  it("only clears debug globals for the matching view", () => {
    const viewA = createMockEditorView();
    const viewB = createMockEditorView();

    attachDebugView(viewA);
    clearDebugView(viewB);
    expect(window.__cmView).toBe(viewA);

    clearDebugView(viewA);
    expect(window.__cmView).toBeUndefined();
    expect(window.__cmDebug).toBeUndefined();
  });

  it("returns a stable bridge object across rerenders", () => {
    const seen: unknown[] = [];
    let rerender!: () => void;

    const Harness: FC = () => {
      const bridge = useEditorDebugBridge();
      const [, setTick] = useState(0);
      seen.push(bridge);
      rerender = () => setTick((value) => value + 1);
      return null;
    };

    act(() => root.render(createElement(Harness)));
    const firstBridge = seen.at(-1);

    act(() => rerender());

    expect(seen.at(-1)).toBe(firstBridge);
  });
});
