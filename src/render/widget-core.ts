import { type EditorView, WidgetType } from "@codemirror/view";
import { activateStructureEditAt } from "../editor/structure-edit-state";

/**
 * Serialize macros to a stable string for use in widget equality checks.
 * Returns an empty string when there are no macros.
 *
 * Results are cached per macro object identity via WeakMap so that
 * repeated calls within the same update cycle (widgets, change-detection)
 * pay the sort+join cost only once.
 */
const macroKeyCache = new WeakMap<Record<string, string>, string>();

export function serializeMacros(macros: Record<string, string>): string {
  const cached = macroKeyCache.get(macros);
  if (cached !== undefined) return cached;

  const keys = Object.keys(macros);
  if (keys.length === 0) {
    macroKeyCache.set(macros, "");
    return "";
  }
  keys.sort();
  const result = keys.map((key) => `${key}=${macros[key]}`).join("\0");
  macroKeyCache.set(macros, result);
  return result;
}

/**
 * Maps live widget DOM elements to their owning RenderWidget instance.
 *
 * Search-highlight reads `sourceFrom`/`sourceTo` from the widget instance
 * via this map rather than from DOM `data-source-from`/`data-source-to`
 * attributes, which can become stale when CM6 maps decoration positions
 * without calling `toDOM()` again.
 */
export const widgetSourceMap = new WeakMap<HTMLElement, RenderWidget>();

/**
 * Base class for render widgets.
 *
 * Subclasses implement `createDOM()` to build the widget element.
 * `toDOM(view)` attaches a mousedown handler that moves the cursor
 * inside the replaced range when clicked, because CM6 places the
 * cursor at the boundary of Decoration.replace, not inside.
 *
 * Set `sourceFrom` before the widget is added to a decoration.
 */
export abstract class RenderWidget extends WidgetType {
  /** Document offset of the start of the source range this widget replaces. */
  sourceFrom = -1;

  /** Document offset of the end of the source range this widget replaces. */
  sourceTo = -1;

  /**
   * Whether this widget participates in stable-shell surface measurement.
   *
   * Most widgets are ordinary inline/render surfaces and should stay invisible
   * to shell measurement. Block/frontmatter/code-shell widgets opt in.
   */
  includeInShellSurface = false;

  /** Document offset range used by shell-surface measurement for opted-in widgets. */
  shellSurfaceFrom = -1;
  shellSurfaceTo = -1;

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

  protected setSourceRangeAttrs(el: HTMLElement): void {
    if (this.sourceFrom >= 0) {
      el.dataset.sourceFrom = String(this.sourceFrom);
    }
    if (this.sourceTo >= 0) {
      el.dataset.sourceTo = String(this.sourceTo);
    }
    if (this.includeInShellSurface && this.shellSurfaceFrom >= 0) {
      el.dataset.shellFrom = String(this.shellSurfaceFrom);
    }
    if (this.includeInShellSurface && this.shellSurfaceTo >= 0) {
      el.dataset.shellTo = String(this.shellSurfaceTo);
    }
    widgetSourceMap.set(el, this);
  }

  /**
   * Update the source range after a position-mapping operation.
   *
   * When a decoration set is mapped through document changes instead of
   * rebuilt, the widget instances are reused at shifted positions. This
   * patches `sourceFrom`/`sourceTo` so that click-to-edit handlers and
   * search-highlight remain correct.
   */
  updateSourceRange(from: number, to: number): void {
    const previousFrom = this.sourceFrom;
    const previousTo = this.sourceTo;
    this.sourceFrom = from;
    this.sourceTo = to;
    if (this.includeInShellSurface) {
      if (this.shellSurfaceFrom === previousFrom || this.shellSurfaceFrom < 0) {
        this.shellSurfaceFrom = from;
      }
      if (this.shellSurfaceTo === previousTo || this.shellSurfaceTo < 0) {
        this.shellSurfaceTo = to;
      }
    }
  }

  protected bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
  ): void {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.focus();
      if (this.sourceFrom >= 0 && activateStructureEditAt(view, this.sourceFrom)) {
        return;
      }
      let pos: number;
      try {
        pos = view.posAtDOM(el);
      } catch (_error) {
        pos = this.sourceFrom;
      }
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    });
  }

  toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.setSourceRangeAttrs(el);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    return el;
  }

  /**
   * Return true so CM6 does NOT also process mouse events on this widget.
   * Our mousedown handler in toDOM() handles cursor placement exclusively.
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

/** Shared spec for text-only render widgets. */
export interface SimpleTextRenderSpec {
  readonly tagName: string;
  readonly className: string;
  readonly text: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

function serializeSimpleTextAttrs(
  attrs: Readonly<Record<string, string>> | undefined,
): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}\0${value}`)
    .join("\0\0");
}

/**
 * Parameterized RenderWidget for the common "single text node + optional attrs"
 * pattern used by citations, labels, and small chrome widgets.
 */
export class SimpleTextRenderWidget extends RenderWidget {
  private readonly attrsKey: string;

  constructor(protected readonly spec: SimpleTextRenderSpec) {
    super();
    this.attrsKey = serializeSimpleTextAttrs(spec.attrs);
  }

  createDOM(): HTMLElement {
    const el = makeTextElement(
      this.spec.tagName,
      this.spec.className,
      this.spec.text,
    );
    if (this.spec.attrs) {
      for (const [name, value] of Object.entries(this.spec.attrs)) {
        el.setAttribute(name, value);
      }
    }
    return el;
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof SimpleTextRenderWidget &&
      this.spec.tagName === other.spec.tagName &&
      this.spec.className === other.spec.className &&
      this.spec.text === other.spec.text &&
      this.attrsKey === other.attrsKey
    );
  }
}

/**
 * Base class for widgets whose identity depends on math macro state.
 */
export abstract class MacroAwareWidget extends RenderWidget {
  protected readonly macrosKey: string;

  constructor(macros: Record<string, string>) {
    super();
    this.macrosKey = serializeMacros(macros);
  }
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
