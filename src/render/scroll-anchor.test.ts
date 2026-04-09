import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  captureScrollAnchor,
  mutateWithScrollStabilizedMeasure,
  requestScrollStabilizedMeasure,
  restoreScrollAnchor,
} from "./scroll-anchor";

describe("scroll-stabilized measures", () => {
  type ScrollTestView = EditorView & {
    lineBlockAtHeight: ReturnType<typeof vi.fn>;
    requestMeasure: ReturnType<typeof vi.fn>;
    setAnchorTop: (value: number | null) => void;
  };

  function createScrollView(options: {
    anchorFrom?: number;
    anchorTop?: number | null;
    scrollTop?: number;
    isConnected?: boolean;
    onMeasure?: () => void;
  } = {}): ScrollTestView {
    const {
      anchorFrom = 12,
      anchorTop = 80,
      scrollTop = 40,
      isConnected = true,
      onMeasure,
    } = options;

    let currentTop = anchorTop;
    const view = {
      dom: { isConnected } as HTMLElement,
      scrollDOM: { scrollTop } as HTMLElement,
      lineBlockAtHeight: vi.fn(() => ({ from: anchorFrom })),
      coordsAtPos: vi.fn(() => (
        currentTop === null
          ? null
          : {
              top: currentTop,
            }
      )),
      requestMeasure: vi.fn((spec: { read?: () => unknown; write?: (value: unknown) => void }) => {
        onMeasure?.();
        const measured = spec.read?.();
        spec.write?.(measured);
      }),
      setAnchorTop(value: number | null) {
        currentTop = value;
      },
    };

    return view as unknown as ScrollTestView;
  }

  it("captures the visible line anchor from the current scroll position", () => {
    const view = createScrollView({ anchorFrom: 27, anchorTop: 145, scrollTop: 64 });

    expect(captureScrollAnchor(view)).toEqual({
      pos: 27,
      top: 145,
    });
    expect(view.lineBlockAtHeight).toHaveBeenCalledWith(64);
  });

  it("restores scrollTop when the anchor shifts after a layout change", () => {
    const view = createScrollView({ anchorTop: 120, scrollTop: 50 });
    const anchor = captureScrollAnchor(view);
    view.setAnchorTop(156);

    restoreScrollAnchor(view, anchor);

    expect(view.scrollDOM.scrollTop).toBe(86);
  });

  it("requests a measure and compensates scroll drift in the write phase", () => {
    const view = createScrollView({
      anchorTop: 90,
      scrollTop: 30,
      onMeasure: () => {
        view.setAnchorTop(118);
      },
    });

    requestScrollStabilizedMeasure(view);

    expect(view.requestMeasure).toHaveBeenCalledTimes(1);
    expect(view.scrollDOM.scrollTop).toBe(58);
  });

  it("wraps DOM mutations with the same scroll compensation", () => {
    const view = createScrollView({ anchorTop: 75, scrollTop: 25 });

    mutateWithScrollStabilizedMeasure(view, () => {
      view.setAnchorTop(101);
    });

    expect(view.requestMeasure).toHaveBeenCalledTimes(1);
    expect(view.scrollDOM.scrollTop).toBe(51);
  });

  it("falls back to a plain mutation when the view is disconnected", () => {
    const view = createScrollView({ isConnected: false });

    mutateWithScrollStabilizedMeasure(view, () => {
      view.setAnchorTop(110);
    });

    expect(view.requestMeasure).not.toHaveBeenCalled();
    expect(view.scrollDOM.scrollTop).toBe(40);
  });
});
