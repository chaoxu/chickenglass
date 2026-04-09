/**
 * Regression tests for document-to-document scroll restoration (#326),
 * large-scroll viewport recovery (#463), and Zustand migration (#465).
 *
 * useEditorScroll writes scrollTop / viewportFrom to the Zustand
 * editorTelemetryStore — no React useState. These tests verify:
 *  1. Scroll position is written to the Zustand store when the user scrolls.
 *  2. resetScroll() zeroes both scrollTop and viewportFrom in the store.
 *  3. A fresh view starts at scroll 0 in the store.
 *  4. Large scrolls trigger requestMeasure() for viewport recovery (#463).
 *  5. Rapid scroll events are coalesced via rAF debouncing (#463).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, type FC } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import {
  computeScrollGuardPadding,
  guardReverseScrollRemap,
  useEditorScroll,
  type UseEditorScrollReturn,
} from "./use-editor-scroll";
import { useEditorTelemetryStore } from "../stores/editor-telemetry-store";

// ── Minimal EditorView stub ─────────────────────────────────────────────────
// We need `scrollDOM` (a real DOM element), `lineBlockAtHeight`, and
// `requestMeasure` (added for #463 large-scroll viewport recovery).

interface MockView {
  scrollDOM: HTMLDivElement;
  contentDOM: HTMLDivElement;
  lineBlockAtHeight: (h: number) => { from: number };
  requestMeasure: () => void;
}

function createMockView(): MockView {
  const scrollDOM = document.createElement("div");
  const contentDOM = document.createElement("div");
  scrollDOM.appendChild(contentDOM);
  Object.defineProperty(scrollDOM, "scrollHeight", {
    configurable: true,
    writable: true,
    value: 3000,
  });
  Object.defineProperty(scrollDOM, "clientHeight", {
    configurable: true,
    writable: true,
    value: 600,
  });
  return {
    scrollDOM,
    contentDOM,
    lineBlockAtHeight: vi.fn((h: number) => ({ from: Math.floor(h) })),
    requestMeasure: vi.fn(),
  };
}

/** Read current scroll telemetry from the Zustand store. */
function getStoredScroll() {
  const state = useEditorTelemetryStore.getState();
  return { scrollTop: state.scrollTop, viewportFrom: state.viewportFrom };
}

/**
 * Dispatch a scroll event and flush the rAF callback so the hook's
 * debounced store update is applied synchronously in the test.
 */
function dispatchScrollAndFlush(scrollDOM: HTMLDivElement): void {
  scrollDOM.dispatchEvent(new Event("scroll"));
  // The hook defers updates to requestAnimationFrame.
  // In jsdom, rAF callbacks run asynchronously. We advance fake timers
  // to flush the rAF callback.
  vi.advanceTimersByTime(16);
}

// ── Harness component ────────────────────────────────────────────────────────
// Renders useEditorScroll and exposes the return value + an imperative setter
// so the test can swap the view (simulating a document switch).

interface HarnessRef {
  result: UseEditorScrollReturn;
  setView: (v: MockView | null) => void;
}

function createHarness(): { Harness: FC; ref: HarnessRef } {
  const ref: HarnessRef = {
    result: { resetScroll: () => {} },
    setView: () => {},
  };

  const Harness: FC = () => {
    const [view, setView] = useState<MockView | null>(null);
    // Cast is safe: the hook only accesses scrollDOM, lineBlockAtHeight, and requestMeasure.
    const hookReturn = useEditorScroll(view as unknown as import("@codemirror/view").EditorView | null);
    ref.result = hookReturn;
    ref.setView = setView;
    return null;
  };

  return { Harness, ref };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("useEditorScroll — document-to-document scroll restoration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    useEditorTelemetryStore.getState().reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("writes scroll position to Zustand store when the user scrolls", () => {
    const { Harness, ref } = createHarness();
    const mockView = createMockView();

    act(() => root.render(createElement(Harness)));
    act(() => ref.setView(mockView));

    mockView.scrollDOM.scrollTop = 250;
    act(() => {
      dispatchScrollAndFlush(mockView.scrollDOM);
    });

    expect(getStoredScroll().scrollTop).toBe(250);
    expect(getStoredScroll().viewportFrom).toBe(250);
  });

  it("resets to 0 when switching documents via resetScroll", () => {
    const { Harness, ref } = createHarness();
    const mockView = createMockView();

    act(() => root.render(createElement(Harness)));
    act(() => ref.setView(mockView));

    mockView.scrollDOM.scrollTop = 400;
    act(() => {
      dispatchScrollAndFlush(mockView.scrollDOM);
    });
    expect(getStoredScroll().scrollTop).toBe(400);

    act(() => ref.result.resetScroll());

    expect(getStoredScroll().scrollTop).toBe(0);
    expect(getStoredScroll().viewportFrom).toBe(0);
  });

  it("switching to a new view starts at scroll 0", () => {
    const { Harness, ref } = createHarness();
    const viewA = createMockView();
    const viewB = createMockView();

    act(() => root.render(createElement(Harness)));

    act(() => ref.setView(viewA));
    viewA.scrollDOM.scrollTop = 300;
    act(() => {
      dispatchScrollAndFlush(viewA.scrollDOM);
    });
    expect(getStoredScroll().scrollTop).toBe(300);

    // Reset + swap view, mirroring useEditor's document-switch path.
    act(() => ref.result.resetScroll());
    act(() => ref.setView(viewB));
    expect(getStoredScroll().scrollTop).toBe(0);
    expect(getStoredScroll().viewportFrom).toBe(0);
  });

  it("tracks scroll independently after switching views", () => {
    const { Harness, ref } = createHarness();
    const viewA = createMockView();
    const viewB = createMockView();

    act(() => root.render(createElement(Harness)));

    act(() => ref.setView(viewA));
    viewA.scrollDOM.scrollTop = 500;
    act(() => {
      dispatchScrollAndFlush(viewA.scrollDOM);
    });
    expect(getStoredScroll().scrollTop).toBe(500);

    act(() => ref.result.resetScroll());
    act(() => ref.setView(viewB));
    viewB.scrollDOM.scrollTop = 120;
    act(() => {
      dispatchScrollAndFlush(viewB.scrollDOM);
    });
    expect(getStoredScroll().scrollTop).toBe(120);
    expect(getStoredScroll().viewportFrom).toBe(120);

    // Old view's listener was cleaned up — scrolling it must be a no-op.
    viewA.scrollDOM.scrollTop = 999;
    act(() => {
      dispatchScrollAndFlush(viewA.scrollDOM);
    });
    expect(getStoredScroll().scrollTop).toBe(120);
  });

  it("handles null view without errors", () => {
    const { Harness, ref } = createHarness();

    act(() => root.render(createElement(Harness)));

    expect(getStoredScroll().scrollTop).toBe(0);
    expect(getStoredScroll().viewportFrom).toBe(0);

    const mockView = createMockView();
    act(() => ref.setView(mockView));
    mockView.scrollDOM.scrollTop = 100;
    act(() => {
      dispatchScrollAndFlush(mockView.scrollDOM);
    });
    expect(getStoredScroll().scrollTop).toBe(100);

    // Setting view to null does NOT auto-reset — useEditor calls resetScroll explicitly.
    act(() => ref.setView(null));
    expect(getStoredScroll().scrollTop).toBe(100);
  });

  // ── #463 regression tests ─────────────────────────────────────────────────

  it("calls requestMeasure after a large scroll jump (#463)", () => {
    const { Harness, ref } = createHarness();
    const mockView = createMockView();

    act(() => root.render(createElement(Harness)));
    act(() => ref.setView(mockView));

    // Small scroll — should NOT trigger requestMeasure.
    mockView.scrollDOM.scrollTop = 100;
    act(() => {
      dispatchScrollAndFlush(mockView.scrollDOM);
    });
    expect(mockView.requestMeasure).not.toHaveBeenCalled();

    // Large scroll (delta >= 2000px) — MUST trigger requestMeasure.
    mockView.scrollDOM.scrollTop = 3000;
    act(() => {
      dispatchScrollAndFlush(mockView.scrollDOM);
    });
    expect(mockView.requestMeasure).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid scroll events via rAF debouncing (#463)", () => {
    const { Harness, ref } = createHarness();
    const mockView = createMockView();

    act(() => root.render(createElement(Harness)));
    act(() => ref.setView(mockView));

    act(() => {
      // Fire multiple scroll events before the rAF callback runs.
      mockView.scrollDOM.scrollTop = 100;
      mockView.scrollDOM.dispatchEvent(new Event("scroll"));
      mockView.scrollDOM.scrollTop = 200;
      mockView.scrollDOM.dispatchEvent(new Event("scroll"));
      mockView.scrollDOM.scrollTop = 300;
      mockView.scrollDOM.dispatchEvent(new Event("scroll"));

      // Now flush — only the last position should be captured.
      vi.advanceTimersByTime(16);
    });

    // lineBlockAtHeight should only be called once (for the final position),
    // not three times.
    expect(mockView.lineBlockAtHeight).toHaveBeenCalledTimes(1);
    expect(getStoredScroll().scrollTop).toBe(300);
  });

  it("guards a wheel-driven reverse remap after a large height correction", () => {
    const { Harness, ref } = createHarness();
    const mockView = createMockView();

    act(() => root.render(createElement(Harness)));
    act(() => ref.setView(mockView));

    mockView.scrollDOM.scrollTop = 1400;
    act(() => {
      dispatchScrollAndFlush(mockView.scrollDOM);
    });
    expect(getStoredScroll().scrollTop).toBe(1400);

    mockView.scrollDOM.dispatchEvent(new WheelEvent("wheel", { deltaY: 90 }));
    Object.defineProperty(mockView.scrollDOM, "scrollHeight", {
      configurable: true,
      writable: true,
      value: 2400,
    });
    mockView.scrollDOM.scrollTop = 1000;
    act(() => {
      dispatchScrollAndFlush(mockView.scrollDOM);
    });

    expect(mockView.scrollDOM.scrollTop).toBe(1490);
    expect(getStoredScroll().scrollTop).toBe(1490);
    expect(mockView.requestMeasure).toHaveBeenCalledTimes(1);
  });
});

describe("guardReverseScrollRemap", () => {
  it("returns a corrected forward target plus preserved runway for reversed downward drift", () => {
    expect(guardReverseScrollRemap({
      previousTop: 1400,
      previousHeight: 3000,
      currentTop: 1000,
      currentHeight: 2400,
      clientHeight: 600,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
    })).toEqual({
      correctedTop: 1490,
      paddingBottom: 600,
      preservedMaxScrollTop: 2400,
      observedMaxScrollTop: 1800,
    });
  });

  it("returns null for ordinary forward scroll", () => {
    expect(guardReverseScrollRemap({
      previousTop: 1400,
      previousHeight: 3000,
      currentTop: 1490,
      currentHeight: 3000,
      clientHeight: 600,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
    })).toBeNull();
  });

  it("returns null without a large height correction", () => {
    expect(guardReverseScrollRemap({
      previousTop: 1400,
      previousHeight: 3000,
      currentTop: 1000,
      currentHeight: 2850,
      clientHeight: 600,
      wheelDeltaY: 90,
      wheelAgeMs: 20,
      preservedMaxScrollTop: null,
    })).toBeNull();
  });
});

describe("computeScrollGuardPadding", () => {
  it("preserves prior runway until raw height catches up", () => {
    expect(computeScrollGuardPadding(2400, 600, 2400)).toBe(600);
    expect(computeScrollGuardPadding(3000, 600, 2400)).toBe(0);
  });
});
