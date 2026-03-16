import { EditorView, Decoration, type DecorationSet, WidgetType } from "@codemirror/view";
import { type EditorState, type Range, type Extension, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

/** Check whether any selection range overlaps [from, to] in the given state. */
export function selectionOverlaps(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  for (const range of state.selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

/** Check whether the cursor (or any part of a selection) overlaps [from, to]. */
export function cursorInRange(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  if (!view.hasFocus) return false;
  return selectionOverlaps(view.state, from, to);
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
 * Build a DecorationSet from an array of decoration ranges.
 * Sorts by position before building (RangeSetBuilder requires sorted input).
 */
export function buildDecorations(
  items: ReadonlyArray<Range<Decoration>>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...items].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of sorted) {
    builder.add(item.from, item.to, item.value);
  }
  return builder.finish();
}

/** Data attribute name used to store source position on widget DOM elements. */
const SOURCE_FROM_ATTR = "data-source-from";

/**
 * Base class for render widgets.
 *
 * Subclasses implement `createDOM()` to build the widget element.
 * The base `toDOM()` stamps a `data-source-from` attribute onto
 * the result so the global click handler can move the cursor into
 * the replaced source range when the widget is clicked.
 *
 * Set `sourceFrom` before the widget is added to a decoration.
 */
export abstract class RenderWidget extends WidgetType {
  /** Document offset of the start of the source range this widget replaces. */
  sourceFrom = -1;

  /** Subclasses build their DOM element here. */
  abstract createDOM(): HTMLElement;

  toDOM(): HTMLElement {
    const el = this.createDOM();
    if (this.sourceFrom >= 0) {
      el.setAttribute(SOURCE_FROM_ATTR, String(this.sourceFrom));
    }
    return el;
  }
}

/**
 * CM6 extension that handles clicks on rendered widgets.
 *
 * When the user clicks a widget element that carries a `data-source-from`
 * attribute, the cursor is moved to that source position so the raw
 * markup is revealed for editing.
 */
export const widgetClickHandler: Extension = EditorView.domEventHandlers({
  mousedown(event: MouseEvent, view: EditorView): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;

    const el = target.closest(`[${SOURCE_FROM_ATTR}]`) as HTMLElement | null;
    if (!el) return false;

    const fromStr = el.getAttribute(SOURCE_FROM_ATTR);
    if (fromStr === null) return false;

    const from = parseInt(fromStr, 10);
    if (isNaN(from) || from < 0 || from > view.state.doc.length) return false;

    event.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
    return true;
  },
});
