import type { EditorView, WidgetType } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LazyWidgetBase,
  type LazyWidgetHeightSpec,
} from "./lazy-widget-base";

class TestLazyWidget extends LazyWidgetBase {
  constructor(
    private readonly blockShell: boolean,
    private readonly spec: LazyWidgetHeightSpec = {
      cache: new Map<string, number>(),
      key: "test",
      fallbackHeight: 42,
    },
  ) {
    super();
  }

  protected get usesLazyBlockShell(): boolean {
    return this.blockShell;
  }

  createDOM(): HTMLElement {
    return document.createElement(this.blockShell ? "div" : "span");
  }

  eq(other: WidgetType): boolean {
    return other instanceof TestLazyWidget
      && this.blockShell === other.blockShell;
  }

  syncAttrsForTest(
    el: HTMLElement,
    activeFenceGuides: boolean,
    view?: EditorView,
  ): void {
    this.syncLazyWidgetAttrs(el, view, activeFenceGuides);
  }

  observeHeightForTest(el: HTMLElement, view: EditorView): void {
    this.observeLazyWidgetHeight(el, view, this.spec);
  }

  estimatedHeightForTest(): number {
    return this.estimatedLazyWidgetHeight(this.spec);
  }
}

describe("LazyWidgetBase", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps lazy inline widgets out of shell-surface measurement", () => {
    const widget = new TestLazyWidget(false);
    widget.updateSourceRange(8, 16);

    const el = widget.toDOM();

    expect(el.dataset.sourceFrom).toBe("8");
    expect(el.dataset.sourceTo).toBe("16");
    expect(el.dataset.shellFrom).toBeUndefined();
    expect(el.dataset.shellTo).toBeUndefined();
  });

  it("syncs source attrs and fence-guide opt-in together", () => {
    const widget = new TestLazyWidget(true);
    widget.updateSourceRange(3, 12);
    const el = document.createElement("div");

    widget.syncAttrsForTest(el, true);

    expect(el.dataset.sourceFrom).toBe("3");
    expect(el.dataset.sourceTo).toBe("12");
    expect(el.dataset.shellFrom).toBe("3");
    expect(el.dataset.shellTo).toBe("12");
    expect(el.dataset.activeFenceGuides).toBe("true");

    widget.syncAttrsForTest(el, false);

    expect(el.dataset.activeFenceGuides).toBeUndefined();
  });

  it("shares cached height estimates and destroy cleanup", () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const cache = new Map<string, number>();
    const widget = new TestLazyWidget(true, {
      cache,
      key: "height-key",
      fallbackHeight: 42,
    });
    const el = document.createElement("div");

    expect(widget.estimatedHeightForTest()).toBe(42);
    cache.set("height-key", 64);
    expect(widget.estimatedHeightForTest()).toBe(64);

    widget.observeHeightForTest(el, {} as EditorView);
    expect(callbacks).toHaveLength(1);

    widget.destroy(el);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });
});
