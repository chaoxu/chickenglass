import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import {
  observeBlockWidgetHeight,
  type BlockWidgetHeightBinding,
} from "./block-widget-height";

describe("observeBlockWidgetHeight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      reconnectObserver: null,
      detachedMeasureWarned: false,
    };
    const container = document.createElement("div");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

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
    expect(warn).toHaveBeenCalledOnce();
    expect(binding.detachedMeasureWarned).toBe(true);
  });

  it("re-arms measurement when a detached container reconnects", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const binding: BlockWidgetHeightBinding = {
      resizeObserver: null,
      resizeMeasureFrame: null,
      reconnectObserver: null,
      detachedMeasureWarned: false,
    };
    const container = document.createElement("div");
    const view = {
      dom: document.createElement("div"),
    } as EditorView;
    const cache = new Map<string, number>([["detached", 24]]);

    observeBlockWidgetHeight(binding, container, view, cache, "detached");

    for (let index = 0; index < 16; index += 1) {
      const callback = callbacks.shift();
      if (!callback) break;
      callback(performance.now());
    }

    expect(warn).toHaveBeenCalledOnce();
    expect(binding.reconnectObserver).not.toBeNull();

    document.body.append(container);
    document.documentElement.append(document.createElement("span"));
    await Promise.resolve();

    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(performance.now());
    expect(binding.reconnectObserver).toBeNull();
  });
});
