import { type EditorView, WidgetType } from "@codemirror/view";

/**
 * Generic base class for render widgets.
 *
 * Subclasses implement `createDOM()` to build the widget element. Source
 * tracking and shell participation live in focused owner modules.
 */
export abstract class BaseRenderWidget extends WidgetType {
  /** Pristine DOM snapshot used to avoid rebuilding expensive widgets on scroll. */
  private cachedDOM: HTMLElement | null = null;

  /**
   * Subclasses build their DOM element here.
   *
   * Called by the default `toDOM()` implementation. Widgets that override
   * `toDOM()` entirely (for example widgets needing the view parameter for
   * custom event handling) do not need to implement this method.
   */
  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  /**
   * Build the widget DOM once, then clone that pristine snapshot on later calls.
   *
   * Use this only for widgets whose structure is fully determined by their
   * constructor state. Event listeners that depend on the live EditorView should
   * still be attached in `toDOM()` after the clone is returned.
   */
  protected createCachedDOM(build: () => HTMLElement): HTMLElement {
    if (this.cachedDOM) {
      return cloneRenderedHTMLElement(this.cachedDOM);
    }

    const el = build();
    this.cachedDOM = cloneRenderedHTMLElement(el);
    return el;
  }

  toDOM(_view?: EditorView): HTMLElement {
    return this.createDOM();
  }

  /**
   * Return true so CM6 does NOT also process mouse events on this widget.
   * Interactive widgets override this or attach their own event handling.
   */
  ignoreEvent(): boolean {
    return true;
  }
}

function collectCanvasNodes(root: HTMLElement): HTMLCanvasElement[] {
  const canvases = [...root.querySelectorAll("canvas")];
  return root instanceof HTMLCanvasElement ? [root, ...canvases] : canvases;
}

function copyCanvasBitmap(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
): void {
  target.width = source.width;
  target.height = source.height;

  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
}

/**
 * Deep-clone rendered DOM, preserving canvas bitmap contents.
 *
 * `cloneNode(true)` copies element structure but not canvas pixels, so widgets
 * that embed canvases need an explicit bitmap copy on the cloned nodes.
 */
export function cloneRenderedHTMLElement<T extends HTMLElement>(source: T): T {
  const clone = source.cloneNode(true) as T;
  const sourceCanvases = collectCanvasNodes(source);
  if (sourceCanvases.length === 0) {
    return clone;
  }

  const cloneCanvases = collectCanvasNodes(clone);
  const count = Math.min(sourceCanvases.length, cloneCanvases.length);
  for (let i = 0; i < count; i++) {
    copyCanvasBitmap(sourceCanvases[i], cloneCanvases[i]);
  }
  return clone;
}

/**
 * Create a simple text element shared by RenderWidget.createDOM() implementations.
 */
export function makeTextElement(
  tagName: string,
  className: string,
  text: string,
): HTMLElement {
  const el = document.createElement(tagName);
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Factory that creates a lightweight WidgetType instance for simple text spans.
 */
export function createSimpleTextWidget(
  tagName: string,
  className: string,
  text: string,
): WidgetType {
  class SimpleTextWidget extends WidgetType {
    toDOM(): HTMLElement {
      const el = document.createElement(tagName);
      el.className = className;
      el.textContent = text;
      return el;
    }

    eq(other: WidgetType): boolean {
      return other instanceof SimpleTextWidget;
    }
  }

  return new SimpleTextWidget();
}
