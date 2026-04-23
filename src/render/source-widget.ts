import { type EditorView, WidgetType } from "@codemirror/view";
import { CSS } from "../constants/css-classes";
import { activeFencedDepthAtRange } from "../state/shell-ownership";
import { activateStructureEditAt } from "../state/cm-structure-edit";
import {
  BaseRenderWidget,
  makeTextElement,
} from "./widget-core";

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

export interface WidgetSourceRange {
  readonly from: number;
  readonly to: number;
}

function readAppliedFenceDepth(el: HTMLElement): number {
  const raw = Number(el.dataset.activeFenceDepth ?? "");
  return Number.isInteger(raw) && raw > 0 ? raw : 0;
}

export function clearActiveFenceGuideClasses(el: HTMLElement): void {
  const depth = readAppliedFenceDepth(el);
  if (!el.classList.contains("cf-fence-guide") && depth === 0) {
    return;
  }
  el.classList.remove("cf-fence-guide");
  if (depth > 0) {
    el.classList.remove(CSS.fenceDepth(Math.min(depth, 6)));
  }
  delete el.dataset.activeFenceDepth;
}

export function syncActiveFenceGuideClasses(
  el: HTMLElement,
  view: EditorView | undefined,
  from: number,
  to: number,
): void {
  const nextDepth = view && typeof view.state?.field === "function"
    ? activeFencedDepthAtRange(view.state, from, to)
    : 0;
  const previousDepth = readAppliedFenceDepth(el);
  const normalizedDepth = Math.min(nextDepth, 6);
  const previousNormalizedDepth = Math.min(previousDepth, 6);

  if (nextDepth <= 0) {
    clearActiveFenceGuideClasses(el);
    return;
  }

  if (
    previousDepth === nextDepth
    && el.classList.contains("cf-fence-guide")
    && el.dataset.activeFenceGuides === "true"
  ) {
    return;
  }

  if (previousDepth > 0 && previousNormalizedDepth !== normalizedDepth) {
    el.classList.remove(CSS.fenceDepth(previousNormalizedDepth));
  }

  el.classList.add("cf-fence-guide", CSS.fenceDepth(normalizedDepth));
  el.dataset.activeFenceDepth = String(nextDepth);
}

export function resolveLiveWidgetSourceRange(
  view: EditorView,
  el: HTMLElement,
): WidgetSourceRange | null {
  const widget = widgetSourceMap.get(el);
  const fallbackFrom = widget ? widget.sourceFrom : Number(el.dataset.sourceFrom);
  const fallbackTo = widget ? widget.sourceTo : Number(el.dataset.sourceTo);
  if (Number.isNaN(fallbackFrom) || Number.isNaN(fallbackTo) || fallbackFrom < 0 || fallbackTo < fallbackFrom) {
    return null;
  }

  if (widget && !widget.useLiveSourceRange) {
    return { from: fallbackFrom, to: fallbackTo };
  }

  const sourceLength = fallbackTo - fallbackFrom;
  try {
    const liveFrom = view.posAtDOM(el, 0);
    if (Number.isInteger(liveFrom) && liveFrom >= 0) {
      return {
        from: liveFrom,
        to: Math.min(view.state.doc.length, liveFrom + sourceLength),
      };
    }
  } catch (_error) {
    // Fall through to the last known source range.
  }

  return { from: fallbackFrom, to: fallbackTo };
}

/**
 * Base class for render widgets that replace document source.
 *
 * Subclasses get source-range metadata, click-to-source/source-reveal binding,
 * and remapped source-range updates. Shell-surface participation lives in
 * `shell-widget.ts`.
 */
export abstract class RenderWidget extends BaseRenderWidget {
  /** Document offset of the start of the source range this widget replaces. */
  sourceFrom = -1;

  /** Document offset of the end of the source range this widget replaces. */
  sourceTo = -1;

  /**
   * Whether live DOM positions should override the declared source range.
   *
   * Inline replacement widgets usually want this. Widgets rendered away from
   * their source should turn it off and rely on their declared range.
   */
  useLiveSourceRange = true;

  protected setSourceRangeAttrs(el: HTMLElement): void {
    if (this.sourceFrom >= 0) {
      el.dataset.sourceFrom = String(this.sourceFrom);
    }
    if (this.sourceTo >= 0) {
      el.dataset.sourceTo = String(this.sourceTo);
    }
    widgetSourceMap.set(el, this);
  }

  protected syncWidgetAttrs(
    el: HTMLElement,
  ): void {
    this.setSourceRangeAttrs(el);
  }

  protected syncFenceGuideOptIn(
    el: HTMLElement,
    enabled: boolean,
    view?: EditorView,
  ): void {
    if (!enabled) {
      delete el.dataset.activeFenceGuides;
      clearActiveFenceGuideClasses(el);
      return;
    }
    el.dataset.activeFenceGuides = "true";
    syncActiveFenceGuideClasses(el, view, this.sourceFrom, this.sourceTo);
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
    this.sourceFrom = from;
    this.sourceTo = to;
  }

  protected bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
  ): void {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.focus();
      const liveRange = resolveLiveWidgetSourceRange(view, el);
      const targetPos = liveRange?.from ?? this.sourceFrom;
      if (targetPos >= 0 && activateStructureEditAt(view, targetPos)) {
        return;
      }
      let pos = targetPos;
      try {
        pos = view.posAtDOM(el, 0);
      } catch (_error) {
        pos = targetPos;
      }
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
    });
  }

  override toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    this.syncWidgetAttrs(el);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    return el;
  }
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
