import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  observeBlockWidgetHeight,
  type BlockWidgetHeightBinding,
} from "./block-widget-height";

describe("observeBlockWidgetHeight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stops retrying detached containers after a bounded number of frames", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const binding: BlockWidgetHeightBinding = {
      resizeObserver: null,
      resizeMeasureFrame: null,
    };
    const container = document.createElement("div");

    observeBlockWidgetHeight(
      binding,
      container,
      {} as EditorView,
      new Map(),
      "detached",
    );

    for (let index = 0; index < 16; index += 1) {
      const callback = callbacks.shift();
      if (!callback) break;
      callback(performance.now());
    }

    expect(callbacks).toHaveLength(0);
    expect(binding.resizeMeasureFrame).toBeNull();
  });
});
