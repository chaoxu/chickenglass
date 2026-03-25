import {
  Decoration,
  type DecorationSet,
  EditorView,
  type PluginSpec,
  type PluginValue,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type StateEffectType,
  type Transaction,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNodeRef } from "@lezer/common";

/**
 * Check whether the primary cursor is contained within [from, to].
 *
 * Accepts either an EditorView or EditorState:
 * - EditorView: also checks view.hasFocus (returns false when unfocused)
 * - EditorState: pure position check with no focus guard
 *
 * Uses containment (cursor.from >= from && cursor.to <= to) rather than
 * overlap so that clicking *near* a widget places the cursor outside the
 * replaced range and keeps the widget rendered.
 */
export function cursorInRange(
  viewOrState: EditorView | EditorState,
  from: number,
  to: number,
): boolean {
  if ("state" in viewOrState) {
    // EditorView path — guard on focus
    if (!viewOrState.hasFocus) return false;
    const cursor = viewOrState.state.selection.main;
    return cursor.from >= from && cursor.to <= to;
  }
  // EditorState path — no focus guard
  const cursor = viewOrState.selection.main;
  return cursor.from >= from && cursor.to <= to;
}

/** Result of collecting renderable nodes from the syntax tree. */
export interface RenderableNode {
  readonly type: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Walk the syntax tree and collect nodes matching the given type names.
 * Accepts either an EditorView or EditorState.
 */
export function collectNodes(
  viewOrState: EditorView | EditorState,
  types: ReadonlySet<string>,
): RenderableNode[] {
  const state = "state" in viewOrState ? viewOrState.state : viewOrState;
  const results: RenderableNode[] = [];
  const tree = syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (types.has(node.type.name)) {
        results.push({
          type: node.type.name,
          from: node.from,
          to: node.to,
        });
      }
    },
  });
  return results;
}

/**
 * Serialize macros to a stable string for use in widget equality checks.
 * Returns an empty string when there are no macros.
 */
export function serializeMacros(macros: Record<string, string>): string {
  const keys = Object.keys(macros);
  if (keys.length === 0) return "";
  keys.sort();
  return keys.map((k) => `${k}=${macros[k]}`).join("\0");
}

/** Shared Decoration.mark that visually hides source markers via CSS while keeping them in the DOM. */
export const decorationHidden = Decoration.mark({ class: "cf-hidden" });

/**
 * Heading-like marker replacement pattern.
 *
 * Both ATX headings and fenced div block headers follow the same principle:
 *
 *   1. A syntactic marker (# or ::: {.class}) is hidden/replaced when cursor is outside.
 *   2. Content text AFTER the marker stays as normal editable document content.
 *   3. Inline render plugins (math, bold, italic) handle the content naturally.
 *   4. When cursor enters the marker area, the marker becomes source.
 *
 * THIS IS CRITICAL — DO NOT "simplify" by replacing the full line with a single widget.
 * Doing so kills inline rendering of content text (e.g., $x^2$ won't render as KaTeX
 * in source mode). This has regressed 3+ times. See CLAUDE.md "Block headers must
 * behave like headings."
 *
 * @param markerFrom  Start of syntactic marker (# position, or ::: position)
 * @param markerTo    End of marker (before content text, e.g., titleFrom or openFenceTo)
 * @param cursorInside  True when cursor is in the marker's "source zone" (marker stays visible)
 * @param widget      Widget to show when marker is hidden. Null = hide without replacement (headings).
 *                    Widget must extend RenderWidget (sourceFrom will be set automatically).
 * @param items       Decoration range accumulator
 */
export function addMarkerReplacement(
  markerFrom: number,
  markerTo: number,
  cursorInside: boolean,
  widget: RenderWidget | null,
  items: Range<Decoration>[],
): void {
  if (cursorInside) return; // marker visible as source — nothing to replace
  if (markerFrom >= markerTo) return; // degenerate range

  if (widget) {
    widget.sourceFrom = markerFrom;
    widget.sourceTo = markerTo;
    items.push(Decoration.replace({ widget }).range(markerFrom, markerTo));
  } else {
    items.push(decorationHidden.range(markerFrom, markerTo));
  }
}

/** Check whether an array of ranges is already sorted by (from, to). */
function isSorted(items: ReadonlyArray<Range<Decoration>>): boolean {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    if (prev.from > curr.from || (prev.from === curr.from && prev.to > curr.to)) {
      return false;
    }
  }
  return true;
}

/**
 * Build a DecorationSet from an array of decoration ranges.
 * Sorts by position before building (RangeSetBuilder requires sorted input).
 * Skips the sort when items are already in order.
 */
export function buildDecorations(
  items: ReadonlyArray<Range<Decoration>>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const ordered = isSorted(items) ? items : [...items].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of ordered) {
    builder.add(item.from, item.to, item.value);
  }
  return builder.finish();
}

/**
 * Base class for render widgets.
 *
 * Subclasses implement `createDOM()` to build the widget element.
 * `toDOM(view)` attaches a mousedown handler that moves the cursor
 * inside the replaced range when clicked — necessary because CM6
 * places cursor at the boundary of Decoration.replace, not inside.
 *
 * Set `sourceFrom` before the widget is added to a decoration.
 */
export abstract class RenderWidget extends WidgetType {
  /** Document offset of the start of the source range this widget replaces. */
  sourceFrom = -1;

  /** Document offset of the end of the source range this widget replaces. */
  sourceTo = -1;

  /**
   * Subclasses build their DOM element here.
   *
   * Called by the default `toDOM()` implementation. Widgets that override
   * `toDOM()` entirely (e.g. widgets needing the view parameter for custom
   * event handling) do not need to implement this method.
   */
  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  protected setSourceRangeAttrs(el: HTMLElement): void {
    if (this.sourceFrom >= 0) {
      el.dataset.sourceFrom = String(this.sourceFrom);
    }
    if (this.sourceTo >= 0) {
      el.dataset.sourceTo = String(this.sourceTo);
    }
  }

  protected bindSourceReveal(
    el: HTMLElement,
    view: EditorView,
    from = this.sourceFrom,
  ): void {
    el.style.cursor = "pointer";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // Focus first so the focus state field is updated before
      // the selection dispatch triggers decoration rebuilding.
      view.focus();
      view.dispatch({ selection: { anchor: from }, scrollIntoView: false });
    });
  }

  toDOM(view?: EditorView): HTMLElement {
    const el = this.createDOM();
    // Store source range as data attributes for search-highlight plugin
    this.setSourceRangeAttrs(el);
    if (this.sourceFrom >= 0 && view) {
      this.bindSourceReveal(el, view);
    }
    return el;
  }

  /**
   * Return true so CM6 does NOT also process mouse events on this widget.
   * Our mousedown handler in toDOM() handles cursor placement exclusively.
   * If CM6 also processes the event, it places cursor at the widget boundary
   * (outside the replaced range), overriding our handler.
   */
  ignoreEvent(): boolean {
    return true;
  }
}

/** StateEffect dispatched when the editor gains or loses focus. */
export const focusEffect = StateEffect.define<boolean>();

/**
 * Build a boolean StateField controlled solely by a matching StateEffect.
 *
 * The field preserves its previous value unless the transaction contains the
 * given effect, in which case it adopts the effect's boolean payload.
 */
export function createBooleanToggleField(
  effect: StateEffectType<boolean>,
  initialValue = false,
): StateField<boolean> {
  return StateField.define<boolean>({
    create() {
      return initialValue;
    },
    update(value, tr) {
      for (const candidate of tr.effects) {
        if (candidate.is(effect)) return candidate.value;
      }
      return value;
    },
  });
}

/**
 * Shared StateField that tracks whether the editor is focused.
 *
 * Used by StateField-based renderers (math, block plugins) that need
 * to know focus state to decide whether to show source or rendered view.
 */
export const editorFocusField = createBooleanToggleField(focusEffect);

/**
 * Extension that dispatches focus-change effects when the editor
 * gains or loses focus.
 */
export const focusTracker: Extension = EditorView.domEventHandlers({
  focus(_event, view) {
    view.dispatch({ effects: focusEffect.of(true) });
  },
  blur(_event, view) {
    view.dispatch({ effects: focusEffect.of(false) });
  },
});

/**
 * Push a widget replacement decoration, setting source range for click-to-edit.
 *
 * Common pattern: create a RenderWidget, set its sourceFrom/sourceTo, and push
 * a Decoration.replace into an accumulator array. Consolidates the 3-step
 * boilerplate into a single call.
 */
export function pushWidgetDecoration(
  items: Range<Decoration>[],
  widget: RenderWidget,
  from: number,
  to: number,
): void {
  widget.sourceFrom = from;
  widget.sourceTo = to;
  items.push(Decoration.replace({ widget }).range(from, to));
}

/**
 * Default update predicate for render ViewPlugins.
 *
 * Returns true when any of the five standard conditions hold:
 * docChanged, selectionSet, viewportChanged, focusChanged, or syntaxTree changed.
 */
export function defaultShouldUpdate(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged ||
    update.focusChanged ||
    syntaxTree(update.state) !== syntaxTree(update.startState)
  );
}

/**
 * Factory that creates a CM6 ViewPlugin producing DecorationSet.
 *
 * Eliminates the repeated boilerplate of:
 *   class Foo implements PluginValue {
 *     decorations: DecorationSet;
 *     constructor(view) { this.decorations = buildFn(view); }
 *     update(u) { if (shouldUpdate(u)) this.decorations = buildFn(u.view); }
 *   }
 *   ViewPlugin.fromClass(Foo, { decorations: v => v.decorations })
 *
 * @param buildFn  Pure function that computes the DecorationSet from the view.
 * @param options  Optional overrides:
 *   - shouldUpdate: custom predicate (defaults to the standard 5-condition check).
 *   - pluginSpec: additional PluginSpec fields (e.g., eventHandlers) merged with
 *     the decorations accessor.
 */
export function createSimpleViewPlugin(
  buildFn: (view: EditorView) => DecorationSet,
  options?: {
    shouldUpdate?: (update: ViewUpdate) => boolean;
    pluginSpec?: Omit<PluginSpec<PluginValue>, "decorations">;
  },
): Extension {
  const shouldUpdate = options?.shouldUpdate ?? defaultShouldUpdate;

  class SimpleViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFn(view);
    }

    update(update: ViewUpdate): void {
      if (shouldUpdate(update)) {
        this.decorations = buildFn(update.view);
      }
    }
  }

  return ViewPlugin.fromClass(SimpleViewPlugin, {
    ...options?.pluginSpec,
    decorations: (v) => v.decorations,
  });
}

/**
 * Default rebuild predicate for StateField-based decoration providers.
 *
 * Returns true when any of the four standard conditions hold:
 * docChanged, selection changed, focusEffect dispatched, or syntaxTree changed.
 *
 * This mirrors the most common pattern across fence-guide, math-render,
 * frontmatter-state, and sidenote-render fields.
 */
export function defaultShouldRebuild(tr: Transaction): boolean {
  return (
    tr.docChanged ||
    tr.selection !== undefined ||
    tr.effects.some((e) => e.is(focusEffect)) ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
  );
}

/**
 * Factory that creates a CM6 StateField providing DecorationSet.
 *
 * Eliminates the repeated boilerplate of:
 *   StateField.define<DecorationSet>({
 *     create(state) { return builder(state); },
 *     update(value, tr) {
 *       if (shouldRebuild(tr)) return builder(tr.state);
 *       return value;
 *     },
 *     provide: f => EditorView.decorations.from(f),
 *   })
 *
 * @param builder         Pure function that computes the DecorationSet from state.
 * @param shouldRebuild   Predicate that decides when to rebuild (defaults to
 *                        docChanged || selection || focusEffect || tree changed).
 */
export function createDecorationsField(
  builder: (state: EditorState) => DecorationSet,
  shouldRebuild?: (tr: Transaction) => boolean,
): StateField<DecorationSet> {
  const predicate = shouldRebuild ?? defaultShouldRebuild;

  return StateField.define<DecorationSet>({
    create(state) {
      return builder(state);
    },

    update(value, tr) {
      if (predicate(tr)) {
        return builder(tr.state);
      }
      return value;
    },

    provide(field) {
      return EditorView.decorations.from(field);
    },
  });
}

/**
 * Iterate the syntax tree within visible ranges, skip nodes where the
 * cursor is inside, and call `buildItem` for each remaining match.
 *
 * Consolidates the repeated pattern of:
 *   for (const { from, to } of view.visibleRanges) {
 *     syntaxTree(view.state).iterate({ from, to, enter(node) {
 *       if (nodeTypes.has(node.name)) return;
 *       if (cursorInRange(view, node.from, node.to)) return;
 *       buildItem(node, items);
 *     }});
 *   }
 *
 * Returns the accumulated decoration ranges. The caller can pass them
 * to `buildDecorations()` or `Decoration.set(items, true)`.
 *
 * @param view        The editor view (used for visible ranges and cursor).
 * @param nodeTypes   Set of Lezer node type names to match.
 * @param buildItem   Callback invoked for each matching node outside the cursor.
 *                    Receives the SyntaxNodeRef and the accumulator array.
 *                    Return false to prevent descending into children.
 */
export function collectNodeRangesExcludingCursor(
  view: EditorView,
  nodeTypes: ReadonlySet<string>,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  buildItem: (node: SyntaxNodeRef, items: Range<Decoration>[]) => false | void,
): Range<Decoration>[] {
  const items: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!nodeTypes.has(node.type.name)) return;
        if (cursorInRange(view, node.from, node.to)) return false;
        return buildItem(node, items);
      },
    });
  }

  return items;
}

/**
 * Create a simple text element — shared DOM helper for RenderWidget.createDOM().
 *
 * Many widgets produce a single element whose only properties are tag, class,
 * and text content. This helper extracts that 3-line pattern into a single
 * call so widget createDOM() bodies stay concise.
 *
 * Unlike createSimpleTextWidget (which produces a singleton WidgetType), this
 * function is a plain DOM builder. The calling widget class still owns eq().
 *
 * @param tagName   HTML element tag (e.g. "span", "sup").
 * @param className CSS class for the element.
 * @param text      Text content of the element.
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
 *
 * Widgets whose identity depends on math macros (MathWidget, BlockHeaderWidget)
 * cache `serializeMacros(macros)` in a `macrosKey` field and include it
 * in `eq()`. This base class captures that pattern so subclasses only
 * need to store the `macros` object and pass it here — the key is
 * computed once and available via `this.macrosKey`.
 *
 * Subclasses must still implement `createDOM()` and their own `eq()`,
 * calling `this.macrosKey` rather than re-computing it.
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
 *
 * Many render plugins need identical single-element widgets that differ only
 * in their tag, CSS class, and text content. This factory eliminates the
 * repeated boilerplate of defining a class with toDOM() and eq().
 *
 * Each call creates a unique class capturing the parameters in its closure.
 * Two instances produced by the same factory call are always equal (same DOM).
 * Instances from different factory calls are never equal (different classes).
 * This matches the typical use-case where widgets are module-level singletons.
 *
 * @param tagName   HTML tag for the element (e.g. "span").
 * @param className CSS class applied to the element.
 * @param text      Text content of the element.
 * @returns A WidgetType instance whose DOM matches the given parameters.
 *
 * @example
 * const openParenWidget = createSimpleTextWidget("span", "cf-block-title-paren", "(");
 */
export function createSimpleTextWidget(
  tagName: string,
  className: string,
  text: string,
): WidgetType {
  // Each factory call creates a unique class so cross-call eq() always returns
  // false (instances with different parameters are never confused as equal).
  class SimpleTextWidget extends WidgetType {
    toDOM(): HTMLElement {
      const el = document.createElement(tagName);
      el.className = className;
      el.textContent = text;
      return el;
    }

    // Two instances of the same SimpleTextWidget class are always equal:
    // the captured (tagName, className, text, title) are identical by construction.
    eq(other: WidgetType): boolean {
      return other instanceof SimpleTextWidget;
    }
  }

  return new SimpleTextWidget();
}
